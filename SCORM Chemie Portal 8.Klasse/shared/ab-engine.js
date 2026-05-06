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
  // Radierer (weiß): breiter Strich, damit man großzügig wegradieren kann.
  // Auch hier druckabhängig, aber auf höherem Niveau (8–14px).
  if (stiftFarbe === '#FFFFFF') {
    const ziel = 8 + p * 6;
    return prev * 0.7 + ziel * 0.3;
  }
  // Normaler Stift: feinere Linien als vorher (war 1.0 + p*2.5 → 1.0–3.5px).
  // Neu: 0.6 + p*1.4 → 0.6–2.0px. Sieht auf dem Pad deutlich präziser aus.
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
  // KEIN desynchronized: true — auf Windows/Chromium führt das oft zu
  // schwarzen Canvas, wenn die GPU-Optimierung scheitert. Lieber etwas
  // langsamer aber zuverlässig.
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  // Pen-Schutzrand zwischen Canvas und Toolbar einfügen
  const toolbar = wrap.querySelector('.canvas-toolbar');
  if (toolbar && !wrap.querySelector('.pen-puffer')) {
    const puffer = document.createElement('div');
    puffer.className = 'pen-puffer';
    wrap.insertBefore(puffer, toolbar);
  }

  const state = {
    canvas, ctx,
    drawing: false,
    activePointerId: null,
    lastWidth: 1.0,
    height: CANVAS_HEIGHT_DEFAULT,
    paths: [],          // gespeicherte Striche zum Wiederherstellen
    currentPath: null,
    pendingPoints: [],
    rafId: null,
  };
  canvasStates[id] = state;

  function zeichneKaroHintergrund(w, h) {
    // Karo-Muster im Heft-Stil: 5mm-Karos, sehr dezent grau.
    // Wird über den weißen Hintergrund gezeichnet, vor den Strichen.
    const KARO = 20; // px (entspricht ungefähr 5mm bei normalem Zoom)
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
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cssW, state.height);
    zeichneKaroHintergrund(cssW, state.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stiftFarbe;
    redraw();
  }

  function redraw() {
    const w = canvas.width / (window.devicePixelRatio || 1);
    const h = canvas.height / (window.devicePixelRatio || 1);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    zeichneKaroHintergrund(w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    state.paths.forEach(path => {
      if (!path || path.length < 1) return;
      ctx.strokeStyle = path.color || '#1A3A5C';
      if (path.length === 1) {
        ctx.fillStyle = path.color || '#1A3A5C';
        ctx.beginPath();
        ctx.arc(path[0].x, path[0].y, path[0].w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      // Pro Segment einen eigenen Stroke, damit lineWidth pro Segment greift
      // (vorher gingen die Druck-Variationen verloren beim Wieder-Zeichnen).
      // Tinten-Verjüngung: erste und letzte 15% des Strichs sind dünner.
      const n = path.length;
      for (let i = 1; i < n; i++) {
        // Tinten-Faktor: 0..1. An den Enden 0.5, in der Mitte 1.0.
        const relPos = i / (n - 1);
        let taper = 1.0;
        if (relPos < 0.15) taper = 0.55 + (relPos / 0.15) * 0.45;
        else if (relPos > 0.85) taper = 0.55 + ((1 - relPos) / 0.15) * 0.45;
        ctx.lineWidth = path[i].w * taper;
        ctx.beginPath();
        if (i === 1) {
          ctx.moveTo(path[0].x, path[0].y);
          // Erste Strecke: Bezier zum Mittelpunkt von p0 und p1
          if (n >= 3) {
            const m = { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2 };
            ctx.lineTo(m.x, m.y);
          } else {
            ctx.lineTo(path[1].x, path[1].y);
          }
        } else if (i === n - 1) {
          // Letztes Segment: vom Mittelpunkt vorletzter zum Endpunkt
          const m = { x: (path[i-1].x + path[i-2].x) / 2, y: (path[i-1].y + path[i-2].y) / 2 };
          ctx.moveTo(m.x, m.y);
          ctx.quadraticCurveTo(path[i-1].x, path[i-1].y, path[i].x, path[i].y);
        } else {
          // Mittlere Segmente: Catmull-Rom-Bezier zwischen Mittelpunkten
          const m1 = { x: (path[i-2].x + path[i-1].x) / 2, y: (path[i-2].y + path[i-1].y) / 2 };
          const m2 = { x: (path[i-1].x + path[i].x) / 2, y: (path[i-1].y + path[i].y) / 2 };
          ctx.moveTo(m1.x, m1.y);
          ctx.quadraticCurveTo(path[i-1].x, path[i-1].y, m2.x, m2.y);
        }
        ctx.stroke();
      }
    });
  }

  function flushFrame() {
    state.rafId = null;
    if (!state.currentPath) return;
    const path = state.currentPath;
    ctx.strokeStyle = path.color || stiftFarbe;
    while (state.pendingPoints.length > 0) {
      const punkt = state.pendingPoints.shift();
      path.push(punkt);
      const n = path.length;
      if (n === 2) {
        const p0 = path[0], p1 = path[1];
        ctx.beginPath();
        ctx.lineWidth = p1.w;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      } else if (n === 3) {
        // erstes Stück mit quadratic Bezier
        const m1 = { x: (path[0].x + path[1].x) / 2, y: (path[0].y + path[1].y) / 2 };
        const m2 = { x: (path[1].x + path[2].x) / 2, y: (path[1].y + path[2].y) / 2 };
        ctx.beginPath();
        ctx.lineWidth = path[1].w;
        ctx.moveTo(m1.x, m1.y);
        ctx.quadraticCurveTo(path[1].x, path[1].y, m2.x, m2.y);
        ctx.stroke();
      } else if (n >= 4) {
        const cp = catmullRomToBezier(path[n-4], path[n-3], path[n-2], path[n-1]);
        ctx.beginPath();
        ctx.lineWidth = path[n-2].w;
        ctx.moveTo(path[n-3].x, path[n-3].y);
        ctx.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, path[n-2].x, path[n-2].y);
        ctx.stroke();
      }
    }
  }

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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

    ctx.beginPath();
    ctx.fillStyle = stiftFarbe;
    ctx.arc(pos.x, pos.y, state.lastWidth / 2, 0, Math.PI * 2);
    ctx.fill();
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
      ctx.beginPath();
      ctx.lineWidth = p2.w;
      ctx.moveTo(m1.x, m1.y);
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
      ctx.stroke();
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

  // Pointer Events
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // Touch-Fallback (für iOS-Quirks bei Apple Pencil)
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

// Sicherheitsnetz für globale pointerup/cancel
['pointerup', 'pointercancel'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    if (e.pointerType !== 'pen' && IST_IOS) return;
    Object.entries(canvasStates).forEach(([id, s]) => {
      if (s.drawing && s.activePointerId === e.pointerId) {
        s.drawing = false;
        s.activePointerId = null;
        s.pendingPoints = [];
        if (s.rafId !== null) { cancelAnimationFrame(s.rafId); s.rafId = null; }
        if (s.currentPath && s.currentPath.length >= 1) {
          s.paths.push(s.currentPath);
          aktualisiereUndoButton(id);
          Storage._scheduleSave();
        }
        s.currentPath = null;
        aktivePenZeichner = Math.max(0, aktivePenZeichner - 1);
      }
    });
    lastPenActivityTs = performance.now();
    if (aktivePenZeichner === 0) {
      document.body.classList.remove('pen-aktiv');
    }
  });
});

// SELECTION-KILLER
document.addEventListener('selectstart', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t.isContentEditable))) return;
  e.preventDefault();
  return false;
}, true);

function clearCanvas(id) {
  const s = canvasStates[id];
  if (!s) return;
  s.paths = [];
  s.redraw();
  aktualisiereUndoButton(id);
  Storage._scheduleSave();
}

// Letzten Strich rückgängig machen.
function undoCanvas(id) {
  const s = canvasStates[id];
  if (!s) return;
  if (s.paths.length === 0) return;
  s.paths.pop();
  s.redraw();
  aktualisiereUndoButton(id);
  Storage._scheduleSave();
}

// Setzt den disabled-Zustand des Rückgängig-Buttons je nach paths.length.
function aktualisiereUndoButton(id) {
  const s = canvasStates[id];
  if (!s) return;
  const buttons = document.querySelectorAll(
    `[data-canvas-action="undo"][data-target="${id}"]`
  );
  buttons.forEach(btn => {
    btn.disabled = (s.paths.length === 0);
  });
}

function biggerCanvas(id) {
  const s = canvasStates[id];
  if (!s) return;
  s.height = Math.min(900, s.height + 100);
  s.resize();
  Storage._scheduleSave();
}

// ============================================================
// FARBPALETTE
// ============================================================
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.farb-btn');
  if (!btn) return;
  const farbe = btn.dataset.farbe;
  if (!farbe) return;
  stiftFarbe = farbe;
  document.querySelectorAll('.farbpalette').forEach(p => {
    p.querySelectorAll('.farb-btn').forEach(b => b.classList.toggle('aktiv', b.dataset.farbe === farbe));
  });
});

// ============================================================
// STORAGE (SCORM suspend_data + localStorage Fallback)
// Nutzt die globale window.Storage-API aus scorm-adapter.js,
// fällt auf localStorage zurück, falls die nicht da ist.
// ============================================================
let modulKey = null;
let workflowState = null;
let saveTimer = null;

const EngineStorage = {
  load() {
    try {
      if (window.Storage && window.Storage.get) {
        return window.Storage.get(modulKey);
      }
      const raw = localStorage.getItem(modulKey);
      return raw ? JSON.parse(raw) : null;
    } catch(e) { return null; }
  },
  save(data) {
    try {
      if (window.Storage && window.Storage.set) {
        window.Storage.set(modulKey, data);
      } else {
        localStorage.setItem(modulKey, JSON.stringify(data));
      }
    } catch(e) { console.warn('Save failed', e); }
  },
  _scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const canvasData = {};
      for (const [id, state] of Object.entries(canvasStates)) {
        canvasData[id] = { paths: state.paths, height: state.height };
      }
      const data = Object.assign({}, workflowState || {}, { canvas: canvasData });
      this.save(data);
    }, 300);
  },
  flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const canvasData = {};
    for (const [id, state] of Object.entries(canvasStates)) {
      canvasData[id] = { paths: state.paths, height: state.height };
    }
    this.save(Object.assign({}, workflowState || {}, { canvas: canvasData }));
  }
};
// Alias für Code, der noch "Storage" intern referenziert
const Storage = EngineStorage;

function loadCanvasData() {
  const data = workflowState;
  if (!data || !data.canvas) return;
  for (const [id, saved] of Object.entries(data.canvas)) {
    const state = canvasStates[id];
    if (!state) continue;
    state.paths = (saved.paths || []).map(p => {
      // Farbe pro Pfad ggf. wiederherstellen
      if (Array.isArray(p) && p.color === undefined) p.color = '#1A3A5C';
      return p;
    });
    if (saved.height) { state.height = saved.height; state.resize(); }
    else state.redraw();
    aktualisiereUndoButton(id);
  }
}

// ============================================================
// WORKFLOW (Aufgaben-Stepper + Quiz + Verbesserung)
// ============================================================
let aufgabenAnzahl = 4;
let quizPool = [];

function ensureWorkflow() {
  if (!workflowState) workflowState = {};
  if (!workflowState.workflow) {
    workflowState.workflow = {
      aktiveAufgabe: 1,
      modus: 'aufgabe',
      fertigeAufgaben: [],
      genutzteFragen: [],
      aktuelleFrageIdx: null,
      letzteAntwortRichtig: null
    };
  }
  return workflowState.workflow;
}

function persistWorkflow() {
  Storage._scheduleSave();
}

function zeigeAufgabe(nr) {
  const wf = ensureWorkflow();
  document.querySelectorAll('.aufgabe-block').forEach(b => {
    const aufNr = parseInt(b.dataset.aufgabe);
    const istFertig = wf.fertigeAufgaben && wf.fertigeAufgaben.includes(aufNr);
    const istAktuell = aufNr === nr;
    b.hidden = !(istFertig || istAktuell);
  });
  wf.aktiveAufgabe = nr;
  document.querySelectorAll('.aufgabe-fertig-row').forEach(row => {
    const block = row.closest('.aufgabe-block');
    if (!block) return;
    const aufNr = parseInt(block.dataset.aufgabe);
    row.style.display = (aufNr === nr) ? '' : 'none';
  });
  setTimeout(() => {
    document.querySelectorAll('.aufgabe-block:not([hidden])').forEach(block => {
      block.querySelectorAll('.canvas-wrap').forEach(wrap => {
        const id = wrap.dataset.canvas;
        const state = canvasStates[id];
        if (state && state.resize) state.resize();
      });
    });
    const aktiveBlock = document.querySelector(`.aufgabe-block[data-aufgabe="${nr}"]`);
    if (aktiveBlock) aktiveBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function startQuiz() {
  const wf = ensureWorkflow();
  wf.modus = 'quiz';
  wf.aktuelleFrageIdx = null;
  document.getElementById('quiz-panel').hidden = false;
  document.getElementById('naechste-panel').hidden = true;
  zeigeNaechsteFrage();
  persistWorkflow();
  setTimeout(() => {
    document.getElementById('quiz-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function zeigeNaechsteFrage() {
  const wf = ensureWorkflow();
  const verfuegbar = [];
  for (let i = 0; i < quizPool.length; i++) {
    if (!wf.genutzteFragen.includes(i)) verfuegbar.push(i);
  }
  if (verfuegbar.length === 0) {
    wf.genutzteFragen = [];
    for (let i = 0; i < quizPool.length; i++) verfuegbar.push(i);
  }
  const idx = verfuegbar[Math.floor(Math.random() * verfuegbar.length)];
  wf.aktuelleFrageIdx = idx;
  wf.genutzteFragen.push(idx);
  const f = quizPool[idx];

  document.getElementById('quiz-counter').textContent = `Frage ${wf.genutzteFragen.length}`;
  document.getElementById('quiz-frage').textContent = f.f;

  const antwortenDiv = document.getElementById('quiz-antworten');
  antwortenDiv.innerHTML = '';
  const idxs = f.a.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  idxs.forEach(originalIdx => {
    const btn = document.createElement('button');
    btn.className = 'quiz-antwort';
    btn.textContent = f.a[originalIdx];
    btn.dataset.idx = originalIdx;
    btn.addEventListener('click', () => antwortBeantwortet(originalIdx, btn));
    antwortenDiv.appendChild(btn);
  });

  document.getElementById('quiz-feedback').hidden = true;
  document.getElementById('btn-naechste-frage').hidden = true;
  persistWorkflow();
}

function antwortBeantwortet(gewaehlt, btn) {
  const wf = ensureWorkflow();
  const f = quizPool[wf.aktuelleFrageIdx];
  document.querySelectorAll('.quiz-antwort').forEach(b => {
    b.classList.add('disabled');
    const i = parseInt(b.dataset.idx);
    if (i === f.r) b.classList.add('richtig');
    else if (b === btn) b.classList.add('falsch');
  });
  const fb = document.getElementById('quiz-feedback');
  fb.hidden = false;
  if (gewaehlt === f.r) {
    fb.className = 'quiz-feedback richtig';
    fb.innerHTML = '<strong>✓ Richtig!</strong> ' + f.e;
  } else {
    fb.className = 'quiz-feedback falsch';
    fb.innerHTML = '<strong>✗ Leider falsch.</strong> Richtige Antwort: <em>'
      + escapeHtml(f.a[f.r]) + '</em><br>' + f.e;
  }
  document.getElementById('btn-naechste-frage').hidden = false;
  persistWorkflow();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function verbesserung() {
  const wf = ensureWorkflow();
  wf.modus = 'verbesserung';
  document.getElementById('quiz-panel').hidden = true;
  document.getElementById('naechste-panel').hidden = false;
  zeigeAufgabe(wf.aktiveAufgabe);
  persistWorkflow();
  setTimeout(() => {
    const block = document.querySelector(`.aufgabe-block[data-aufgabe="${wf.aktiveAufgabe}"]`);
    if (block) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function naechsteAufgabe() {
  const wf = ensureWorkflow();
  if (!wf.fertigeAufgaben.includes(wf.aktiveAufgabe)) {
    wf.fertigeAufgaben.push(wf.aktiveAufgabe);
  }
  const naechste = wf.aktiveAufgabe + 1;
  if (naechste > aufgabenAnzahl) {
    document.querySelectorAll('.aufgabe-block').forEach(b => b.hidden = false);
    document.getElementById('quiz-panel').hidden = true;
    document.getElementById('naechste-panel').hidden = true;
    const merke = document.getElementById('merke-final');
    if (merke) merke.hidden = false;
    const abschluss = document.getElementById('abschluss-panel');
    if (abschluss) abschluss.hidden = false;
    wf.modus = 'fertig';
    persistWorkflow();
    return;
  }
  wf.modus = 'aufgabe';
  document.getElementById('quiz-panel').hidden = true;
  document.getElementById('naechste-panel').hidden = true;
  zeigeAufgabe(naechste);
  persistWorkflow();
}

// ============================================================
// HINWEISE
// ============================================================
function setupHints() {
  document.querySelectorAll('.hint-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.hint;
      if (!id) return;
      const content = document.getElementById(id);
      if (!content) return;
      content.classList.toggle('aktiv');
      btn.classList.toggle('aktiv', content.classList.contains('aktiv'));
    });
  });
}

// ============================================================
// CANVAS-TOOLBAR-ACTIONS
// ============================================================
function setupCanvasActions() {
  document.querySelectorAll('[data-canvas-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.canvasAction;
      const target = btn.dataset.target;
      if (action === 'clear') clearCanvas(target);
      else if (action === 'bigger') biggerCanvas(target);
      else if (action === 'undo') undoCanvas(target);
    });
  });
}

// ============================================================
// PUBLIC API
// ============================================================
window.ABEngine = {
  init(opts) {
    modulKey = opts.modulKey;
    aufgabenAnzahl = opts.aufgabenAnzahl || 4;
    quizPool = opts.quizPool || [];
    if (opts.startfarbe) stiftFarbe = opts.startfarbe;

    workflowState = EngineStorage.load() || {};

    // Canvas einrichten
    document.querySelectorAll('.canvas-wrap').forEach(setupCanvas);
    loadCanvasData();
    window.addEventListener('resize', () => {
      Object.values(canvasStates).forEach(s => s.resize());
    });

    // Hint-Buttons + Canvas-Toolbar-Actions
    setupHints();
    setupCanvasActions();

    // Workflow-Buttons
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-workflow]');
      if (!target) return;
      if (target.dataset.workflow === 'fertig') startQuiz();
    });
    const naechsteFrageBtn = document.getElementById('btn-naechste-frage');
    if (naechsteFrageBtn) naechsteFrageBtn.addEventListener('click', zeigeNaechsteFrage);
    const verbesserungBtn = document.getElementById('btn-verbesserung');
    if (verbesserungBtn) verbesserungBtn.addEventListener('click', verbesserung);
    const naechsteAufgabeBtn = document.getElementById('btn-naechste-aufgabe');
    if (naechsteAufgabeBtn) naechsteAufgabeBtn.addEventListener('click', naechsteAufgabe);

    // Footer
    const clearAllBtn = document.getElementById('btn-clear-all');
    if (clearAllBtn) clearAllBtn.addEventListener('click', () => {
      if (!confirm('Wirklich alle Notizen löschen?')) return;
      Object.keys(canvasStates).forEach(clearCanvas);
    });

    // Initialer Workflow-State wiederherstellen
    const wf = ensureWorkflow();
    if (wf.modus === 'fertig') {
      document.querySelectorAll('.aufgabe-block').forEach(b => b.hidden = false);
      const merke = document.getElementById('merke-final');
      if (merke) merke.hidden = false;
      const abschluss = document.getElementById('abschluss-panel');
      if (abschluss) abschluss.hidden = false;
      document.getElementById('quiz-panel').hidden = true;
      document.getElementById('naechste-panel').hidden = true;
    } else {
      zeigeAufgabe(wf.aktiveAufgabe);
      if (wf.modus === 'quiz') {
        startQuiz();
      } else if (wf.modus === 'verbesserung') {
        document.getElementById('quiz-panel').hidden = true;
        document.getElementById('naechste-panel').hidden = false;
      }
    }

    // beforeunload: speichern
    window.addEventListener('beforeunload', () => Storage.flush());
    window.addEventListener('pagehide', () => Storage.flush());
  },

  // Für PDF-Export-Helper:
  getCanvasState(id) { return canvasStates[id]; },
  getAllCanvases() { return canvasStates; },
  getWorkflowState() { return workflowState; },
  flush() { Storage.flush(); }
};

})();
