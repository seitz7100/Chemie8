/* ============================================================
   AB-Engine — gemeinsame Logik für alle Arbeitsblätter
   ============================================================
   Aufruf:
     window.ABEngine.init({
       modulKey: 'ab.dingsbums.v1',  // eindeutiger Storage-Key
       aufgabenAnzahl: 4,            // wie viele Aufgaben gibt es?
       quizPool: window.GRUNDWISSEN_POOL,
       sims: { name: simObj, ... }   // optional: Sim-Objekte mit { play, reset } für PDF-Export
     });
   Die Engine erwartet im DOM:
     - .canvas-wrap[data-canvas="..."] für jede Schreibfläche
     - .aufgabe-block[data-aufgabe="N"] für jede Aufgabe (N = 1..aufgabenAnzahl)
     - .aufgabe-fertig-row mit button[data-workflow="fertig"][data-aufgabe="N"]
     - #quiz-panel mit #quiz-frage, #quiz-antworten, #quiz-feedback,
       #quiz-counter, #btn-naechste-frage, #btn-verbesserung
     - #naechste-panel mit #btn-naechste-aufgabe
     - .hint-btn[data-hint="ID"] und .hint-content#ID
     - #btn-clear-all, #btn-export-pdf, #btn-finish (optional)
*/
(function() {
'use strict';

// ============================================================
// PLATTFORM-DETECTION
// ============================================================
const IST_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ============================================================
// CANVAS-SYSTEM (Smooth-Pencil v2)
// ============================================================
const CANVAS_HEIGHT_DEFAULT = 240;
const PEN_CLICK_BLOCK_MS = 150;
const TOUCH_VERZOEGERUNG_MS = 100;
const MIN_PUNKT_ABSTAND_QUAD = 0.6 * 0.6;

const canvasStates = {};
let aktivePenZeichner = 0;
let lastPenActivityTs = 0;
let stiftFarbe = '#1A3A5C';

// Pencil/Eingabegerät-Erkennung — Cross-Browser:
// iOS: nur Apple Pencil (Tilt/Altitude). Sonst: alles durchlassen.
function isPen(e) {
  if (e.pointerType === 'pen') return true;
  if (!IST_IOS) {
    if (e.pointerType === 'mouse' || e.pointerType === 'touch') return true;
  }
  if (e.pointerType === 'touch') {
    if ((e.tiltX && e.tiltX !== 0) || (e.tiltY && e.tiltY !== 0)) return true;
    if (typeof e.altitudeAngle === 'number' && e.altitudeAngle > 0 && e.altitudeAngle < Math.PI/2 - 0.01) return true;
    if (lastPenActivityTs && (performance.now() - lastPenActivityTs) < 2000) return true;
  }
  return false;
}

function druckZuBreite(pressure, prev) {
  const p = (pressure && pressure > 0) ? pressure : 0.5;
  if (stiftFarbe === '#FFFFFF') {
    const ziel = 8 + p * 6;
    return prev * 0.7 + ziel * 0.3;
  }
  const ziel = 0.6 + p * 1.4;
  return prev * 0.85 + ziel * 0.15;
}

function catmullRomToBezier(p0, p1, p2, p3) {
  return {
    cp1x: p1.x + (p2.x - p0.x) / 6,
    cp1y: p1.y + (p2.y - p0.y) / 6,
    cp2x: p2.x - (p3.x - p1.x) / 6,
    cp2y: p2.y - (p3.y - p1.y) / 6
  };
}

function setupCanvas(wrap) {
  const id = wrap.dataset.canvas;
  const canvas = wrap.querySelector('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  const toolbar = wrap.querySelector('.canvas-toolbar');
  if (toolbar && !wrap.querySelector('.pen-puffer')) {
    const puffer = document.createElement('div');
    puffer.className = 'pen-puffer';
    wrap.insertBefore(puffer, toolbar);
  }

  // Offscreen-Canvas, auf dem nur die Stift-Striche liegen. Eraser-Striche
  // arbeiten dort mit destination-out, sodass darunterliegende Stift-Striche
  // wirklich entfernt werden — und nicht die Karo-Linien des Hintergrunds
  // mit überpinselt werden. Komposition: Hintergrund (weiß+Karo) + Marks.
  const marksCanvas = document.createElement('canvas');
  const marksCtx = marksCanvas.getContext('2d', { willReadFrequently: false });

  const state = {
    canvas, ctx,
    marksCanvas, marksCtx,
    drawing: false,
    activePointerId: null,
    lastWidth: 1.0,
    height: CANVAS_HEIGHT_DEFAULT,
    paths: [],
    currentPath: null,
    pendingPoints: [],
    rafId: null,
  };
  canvasStates[id] = state;

  function zeichneKaroHintergrund(w, h) {
    const KARO = 20;
    ctx.save();
    ctx.strokeStyle = '#E0E6ED';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = KARO; x < w; x += KARO) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = KARO; y < h; y += KARO) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function resize() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = wrap.clientWidth || 600;
    canvas.style.height = state.height + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(state.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    marksCanvas.width = canvas.width;
    marksCanvas.height = canvas.height;
    marksCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    marksCtx.lineCap = 'round';
    marksCtx.lineJoin = 'round';

    redraw();
  }

  function zeichneHintergrund() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    zeichneKaroHintergrund(w, h);
  }

  function compositeMarks() {
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(marksCanvas, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.restore();
  }

  function clearMarksLayer() {
    const dpr = window.devicePixelRatio || 1;
    marksCtx.save();
    marksCtx.setTransform(1, 0, 0, 1, 0, 0);
    marksCtx.clearRect(0, 0, marksCanvas.width, marksCanvas.height);
    marksCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    marksCtx.restore();
  }

  function isErase(path) {
    return path && path.color === '#FFFFFF';
  }

  function redraw() {
    clearMarksLayer();
    const mctx = marksCtx;
    mctx.lineCap = 'round';
    mctx.lineJoin = 'round';
    state.paths.forEach(path => {
      if (!path || path.length < 1) return;
      if (isErase(path)) {
        mctx.globalCompositeOperation = 'destination-out';
        mctx.strokeStyle = '#000';
        mctx.fillStyle = '#000';
      } else {
        mctx.globalCompositeOperation = 'source-over';
        mctx.strokeStyle = path.color || '#1A3A5C';
        mctx.fillStyle = path.color || '#1A3A5C';
      }
      if (path.length === 1) {
        mctx.beginPath();
        mctx.arc(path[0].x, path[0].y, path[0].w / 2, 0, Math.PI * 2);
        mctx.fill();
        return;
      }
      const n = path.length;
      for (let i = 1; i < n; i++) {
        const relPos = i / (n - 1);
        let taper = 1.0;
        if (relPos < 0.15) taper = 0.55 + (relPos / 0.15) * 0.45;
        else if (relPos > 0.85) taper = 0.55 + ((1 - relPos) / 0.15) * 0.45;
        mctx.lineWidth = path[i].w * taper;
        mctx.beginPath();
        if (i === 1) {
          mctx.moveTo(path[0].x, path[0].y);
          if (n >= 3) {
            const m = { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2 };
            mctx.lineTo(m.x, m.y);
          } else {
            mctx.lineTo(path[1].x, path[1].y);
          }
        } else if (i === n - 1) {
          const m = { x: (path[i-1].x + path[i-2].x) / 2, y: (path[i-1].y + path[i-2].y) / 2 };
          mctx.moveTo(m.x, m.y);
          mctx.quadraticCurveTo(path[i-1].x, path[i-1].y, path[i].x, path[i].y);
        } else {
          const m1 = { x: (path[i-2].x + path[i-1].x) / 2, y: (path[i-2].y + path[i-1].y) / 2 };
          const m2 = { x: (path[i-1].x + path[i].x) / 2, y: (path[i-1].y + path[i].y) / 2 };
          mctx.moveTo(m1.x, m1.y);
          mctx.quadraticCurveTo(path[i-1].x, path[i-1].y, m2.x, m2.y);
        }
        mctx.stroke();
      }
    });
    mctx.globalCompositeOperation = 'source-over';

    zeichneHintergrund();
    compositeMarks();
  }

  function flushFrame() {
    state.rafId = null;
    if (!state.currentPath) return;
    const path = state.currentPath;
    const erase = isErase(path);
    if (erase) {
      marksCtx.globalCompositeOperation = 'destination-out';
      marksCtx.strokeStyle = '#000';
    } else {
      marksCtx.globalCompositeOperation = 'source-over';
      marksCtx.strokeStyle = path.color || stiftFarbe;
    }
    let veraendert = false;
    while (state.pendingPoints.length > 0) {
      const punkt = state.pendingPoints.shift();
      path.push(punkt);
      const n = path.length;
      if (n === 2) {
        const p0 = path[0], p1 = path[1];
        marksCtx.beginPath();
        marksCtx.lineWidth = p1.w;
        marksCtx.moveTo(p0.x, p0.y);
        marksCtx.lineTo(p1.x, p1.y);
        marksCtx.stroke();
        veraendert = true;
      } else if (n === 3) {
        const m1 = { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2 };
        const m2 = { x: (path[1].x + path[2].x) / 2, y: (path[1].y + path[2].y) / 2 };
        marksCtx.beginPath();
        marksCtx.lineWidth = path[1].w;
        marksCtx.moveTo(m1.x, m1.y);
        marksCtx.quadraticCurveTo(path[1].x, path[1].y, m2.x, m2.y);
        marksCtx.stroke();
        veraendert = true;
      } else if (n >= 4) {
        const cp = catmullRomToBezier(path[n-4], path[n-3], path[n-2], path[n-1]);
        marksCtx.beginPath();
        marksCtx.lineWidth = path[n-2].w;
        marksCtx.moveTo(path[n-3].x, path[n-3].y);
        marksCtx.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, path[n-2].x, path[n-2].y);
        marksCtx.stroke();
        veraendert = true;
      }
    }
    marksCtx.globalCompositeOperation = 'source-over';
    if (veraendert) {
      zeichneHintergrund();
      compositeMarks();
    }
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    // Eingabe in interne CSS-Einheiten skalieren — falls die Canvas-Anzeige
    // nicht exakt der zuletzt für resize() benutzten wrap.clientWidth
    // entspricht (z. B. bei Layout-Shift / SCORM-iFrame-Skalierung).
    const dpr = window.devicePixelRatio || 1;
    const cssCanvasW = canvas.width / dpr;
    const cssCanvasH = canvas.height / dpr;
    const sx = rect.width  > 0 ? (cssCanvasW / rect.width)  : 1;
    const sy = rect.height > 0 ? (cssCanvasH / rect.height) : 1;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top)  * sy
    };
  }

  function start(e) {
    if (!isPen(e)) return;
    if (e.preventDefault) e.preventDefault();

    if (state.drawing) {
      state.drawing = false;
      state.activePointerId = null;
      state.currentPath = null;
      state.pendingPoints = [];
      if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; }
      aktivePenZeichner = Math.max(0, aktivePenZeichner - 1);
    }

    state.drawing = true;
    state.activePointerId = e.pointerId;
    state.pendingPoints = [];

    aktivePenZeichner++;
    lastPenActivityTs = performance.now();
    document.body.classList.add('pen-aktiv');

    const pos = getPos(e);
    state.lastWidth = druckZuBreite(e.pressure, 1.0);
    state.currentPath = [{x: pos.x, y: pos.y, w: state.lastWidth}];
    state.currentPath.color = stiftFarbe;

    if (isErase(state.currentPath)) {
      marksCtx.globalCompositeOperation = 'destination-out';
      marksCtx.fillStyle = '#000';
    } else {
      marksCtx.globalCompositeOperation = 'source-over';
      marksCtx.fillStyle = stiftFarbe;
    }
    marksCtx.beginPath();
    marksCtx.arc(pos.x, pos.y, state.lastWidth / 2, 0, Math.PI * 2);
    marksCtx.fill();
    marksCtx.globalCompositeOperation = 'source-over';
    zeichneHintergrund();
    compositeMarks();
  }

  function move(e) {
    if (!state.drawing) return;
    if (e.pointerId !== state.activePointerId) return;
    if (!isPen(e)) return;
    if (e.preventDefault) e.preventDefault();

    const events = (typeof e.getCoalescedEvents === 'function')
      ? e.getCoalescedEvents()
      : [e];
    if (events.length === 0) events.push(e);

    const path = state.currentPath;
    const buffer = state.pendingPoints;
    let letzterPunkt = buffer.length > 0
      ? buffer[buffer.length - 1]
      : (path && path.length > 0 ? path[path.length - 1] : null);

    for (const ev of events) {
      const pos = getPos(ev);
      if (letzterPunkt) {
        const dx = pos.x - letzterPunkt.x;
        const dy = pos.y - letzterPunkt.y;
        if (dx * dx + dy * dy < MIN_PUNKT_ABSTAND_QUAD) continue;
      }
      state.lastWidth = druckZuBreite(ev.pressure, state.lastWidth);
      const punkt = {x: pos.x, y: pos.y, w: state.lastWidth};
      buffer.push(punkt);
      letzterPunkt = punkt;
    }

    if (state.currentPath && (state.currentPath.length + buffer.length) < 4) {
      if (state.rafId !== null) { cancelAnimationFrame(state.rafId); state.rafId = null; }
      flushFrame();
    } else if (state.rafId === null && buffer.length > 0) {
      state.rafId = requestAnimationFrame(flushFrame);
    }
    lastPenActivityTs = performance.now();
  }

  function end(e) {
    if (!state.drawing) return;
    if (e && e.pointerId !== state.activePointerId) return;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    flushFrame();

    if (state.currentPath && state.currentPath.length >= 3) {
      const path = state.currentPath;
      const n = path.length;
      const p1 = path[n-2];
      const p2 = path[n-1];
      const m1 = { x: (path[n-3].x + p1.x) / 2, y: (path[n-3].y + p1.y) / 2 };
      const erase = isErase(path);
      if (erase) {
        marksCtx.globalCompositeOperation = 'destination-out';
        marksCtx.strokeStyle = '#000';
      } else {
        marksCtx.globalCompositeOperation = 'source-over';
        marksCtx.strokeStyle = path.color || stiftFarbe;
      }
      marksCtx.beginPath();
      marksCtx.lineWidth = p2.w;
      marksCtx.moveTo(m1.x, m1.y);
      marksCtx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      marksCtx.stroke();
      marksCtx.globalCompositeOperation = 'source-over';
      zeichneHintergrund();
      compositeMarks();
    }

    state.drawing = false;
    state.activePointerId = null;
    state.pendingPoints = [];

    if (state.currentPath && state.currentPath.length >= 1) {
      state.paths.push(state.currentPath);
      aktualisiereUndoButton(id);
      Storage._scheduleSave();
    }
    state.currentPath = null;

    aktivePenZeichner = Math.max(0, aktivePenZeichner - 1);
    lastPenActivityTs = performance.now();
    if (aktivePenZeichner === 0) {
      document.body.classList.remove('pen-aktiv');
    }
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function touchToPointerLike(t) {
    return {
      pointerId: 1000 + (t.identifier || 0),
      pointerType: 'pen',
      clientX: t.clientX,
      clientY: t.clientY,
      pressure: t.force || 0.5,
      tiltX: 0, tiltY: 0,
      preventDefault: () => {},
      getCoalescedEvents: () => []
    };
  }
  function istStylusTouch(t) { return t && t.touchType === 'stylus'; }
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (!istStylusTouch(t)) continue;
      if (state.drawing) continue;
      start(touchToPointerLike(t));
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (!istStylusTouch(t)) continue;
      if (!state.drawing) continue;
      const fakeId = 1000 + (t.identifier || 0);
      if (state.activePointerId !== fakeId) continue;
      move(touchToPointerLike(t));
    }
  }, { passive: false });
  function touchEndHandler(e) {
    for (const t of e.changedTouches) {
      if (!istStylusTouch(t)) continue;
      const fakeId = 1000 + (t.identifier || 0);
      if (state.activePointerId !== fakeId) continue;
      end({ pointerId: fakeId });
    }
  }
  canvas.addEventListener('touchend', touchEndHandler, { passive: true });
  canvas.addEventListener('touchcancel', touchEndHandler, { passive: true });

  state.resize = resize;
  state.redraw = redraw;
  resize();
}

['pointerup', 'pointercancel
