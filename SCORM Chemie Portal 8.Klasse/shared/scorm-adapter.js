/**
 * SCORM 1.2 Adapter mit High-Level Storage
 *
 * Die Storage-API speichert Daten primär in cmi.suspend_data, das von
 * mebis pro Schüler:in serverseitig erhalten bleibt — auch über SCORM-
 * Updates hinweg, solange die Manifest-Identifier gleich bleiben.
 * Fällt automatisch auf localStorage zurück, wenn keine SCORM-API
 * verfügbar ist (z.B. lokales Testen).
 *
 * Mehrere Module nutzen denselben suspend_data-Slot, deshalb wird der
 * Inhalt als JSON-Objekt mit Modul-Keys organisiert.
 */
(function() {
  let api = null;
  let active = false;

  function findAPI(win) {
    let tries = 0;
    while (win && win.API === undefined && win.parent && win.parent !== win && tries < 10) {
      win = win.parent;
      tries++;
    }
    return win.API || null;
  }

  function locateAPI() {
    if (window.API) return window.API;
    if (window.parent && window.parent !== window) {
      const a = findAPI(window.parent);
      if (a) return a;
    }
    if (window.opener) {
      const a = findAPI(window.opener);
      if (a) return a;
    }
    return null;
  }

  const SCORM = {
    init() {
      if (active) return true;
      api = locateAPI();
      if (!api) {
        console.info('[SCORM] Keine API gefunden – läuft im Standalone-Modus.');
        return false;
      }
      const ok = api.LMSInitialize('');
      active = (ok === 'true' || ok === true);
      if (active) console.info('[SCORM] Verbunden mit LMS.');
      return active;
    },
    isActive() { return active; },
    get(key) {
      if (!active) return '';
      try { return api.LMSGetValue(key); } catch (e) { return ''; }
    },
    set(key, value) {
      if (!active) return false;
      try {
        const r = api.LMSSetValue(key, String(value));
        return r === 'true' || r === true;
      } catch (e) { return false; }
    },
    commit() {
      if (!active) return false;
      try {
        const r = api.LMSCommit('');
        return r === 'true' || r === true;
      } catch (e) { return false; }
    },
    finish() {
      if (!active) return false;
      try {
        api.LMSFinish('');
        active = false;
        return true;
      } catch (e) { return false; }
    },
  };

  // ===========================================================
  // High-Level Storage
  // ===========================================================
  // Verwaltet einen JSON-Bag in cmi.suspend_data, der mehrere Module
  // gleichzeitig speichern kann.
  //
  //   Storage.init();                       // einmal pro Seite
  //   Storage.set('ab.reibung', {...});     // speichern (debounced)
  //   Storage.get('ab.reibung');            // laden
  //   Storage.flush();                      // sofort committen

  const LS_FALLBACK_KEY = 'chemiePortalStorage';
  let bag = null;
  let initialized = false;
  let flushTimer = null;

  function loadBag() {
    let raw = '';
    if (active) {
      raw = SCORM.get('cmi.suspend_data') || '';
    }
    if (!raw) {
      try { raw = localStorage.getItem(LS_FALLBACK_KEY) || ''; } catch(_) {}
    }
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch(e) {
      console.warn('[Storage] suspend_data konnte nicht geparst werden, starte leer.', e);
      return {};
    }
  }

  function persistBag() {
    const json = JSON.stringify(bag);
    if (active) {
      const lmsOk = SCORM.set('cmi.suspend_data', json);
      if (lmsOk) {
        try { SCORM.set('cmi.core.lesson_status', 'incomplete'); } catch(_) {}
        SCORM.commit();
      } else {
        console.warn('[Storage] suspend_data konnte nicht gespeichert werden (zu groß?).');
      }
    }
    // Immer ZUSÄTZLICH lokal sichern als Fallback
    try { localStorage.setItem(LS_FALLBACK_KEY, json); } catch(e) {
      console.warn('[Storage] localStorage voll', e);
    }
  }

  const Storage = {
    init() {
      if (initialized) return;
      if (!active) {
        try { SCORM.init(); } catch(_) {}
      }
      bag = loadBag();
      initialized = true;
      window.addEventListener('beforeunload', () => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        persistBag();
        try { SCORM.finish(); } catch(_) {}
      });
      window.addEventListener('pagehide', () => {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        persistBag();
      });
    },
    isReady() { return initialized; },
    get(modulKey) {
      if (!initialized) this.init();
      return bag[modulKey] || null;
    },
    set(modulKey, data) {
      if (!initialized) this.init();
      bag[modulKey] = data;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        persistBag();
      }, 500);
    },
    flush() {
      if (!initialized) return;
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      persistBag();
    },
    clear(modulKey) {
      if (!initialized) this.init();
      delete bag[modulKey];
      this.flush();
    },
    debugDump() {
      return JSON.parse(JSON.stringify(bag || {}));
    }
  };

  window.SCORM = SCORM;
  window.Storage = Storage;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Storage.init());
  } else {
    Storage.init();
  }
})();
