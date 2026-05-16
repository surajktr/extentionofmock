// sync.js - Bridges extension chrome.storage → localStorage on localhost:5173
// This allows the React dashboard to read extension data instantly on page load.

(function () {
  'use strict';

  function writeToLocalStorage(db, subjects) {
    try {
      if (db) localStorage.setItem('savemockQuestions', JSON.stringify(db));
      if (subjects) localStorage.setItem('savemockSubjects', JSON.stringify(subjects));
    } catch (e) {
      console.error('[Savemock Sync] localStorage write error:', e);
    }
  }

  // ─── Step 1: Read from extension storage and write to localStorage ──────────
  // This runs before React mounts, so the data is ready when React reads it.
  chrome.storage.local.get(['savemockQuestions', 'savemockSubjects'], (res) => {
    const db = res.savemockQuestions;
    const subjects = res.savemockSubjects;

    writeToLocalStorage(db, subjects);
    console.log('[Savemock Sync] Initial sync done:', 
      Object.keys(db || {}).map(k => `${k}: ${(db[k] || []).length} Qs`).join(', '));

    // Also post a message for any already-mounted React components
    setTimeout(() => {
      window.postMessage({ type: 'SAVEMOCK_SYNC', db, subjects }, '*');
    }, 300);
  });

  // ─── Step 2: Watch for live changes (when user saves a new question) ─────────
  chrome.storage.onChanged.addListener((changes) => {
    const db = changes.savemockQuestions ? changes.savemockQuestions.newValue : null;
    const subjects = changes.savemockSubjects ? changes.savemockSubjects.newValue : null;

    writeToLocalStorage(db, subjects);

    // Notify React app in real-time
    window.postMessage({ type: 'SAVEMOCK_SYNC', db, subjects }, '*');
    console.log('[Savemock Sync] Live update received.');
  });

})();
