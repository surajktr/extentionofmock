// ─── Global State & Storage ──────────────────────────────────────────────────
let SUBJECTS = ["Math", "English", "GK/GS", "Reasoning"];
let currentSubject = "Math";
let _isBulkSaving = false; // Flag to pause polling during bulk save

const getStorage = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const setStorage = (vals) => new Promise(r => chrome.storage.local.set(vals, r));

// ─── Main Logic ──────────────────────────────────────────────────────────────
function checkWidgetVisibility() {
  const widget = document.getElementById('sm-floating-widget');
  if (!widget) return;
  
  // Only show on test portals or question-active pages
  const hasContent = !!document.querySelector(
    '.sol-question-section, .sol-section, .ans-solution, .solution-box, .solution-wrapper, .view-solution, .solution-sec, .solutiontxt, ' +
    '.qpip-inner.active, .qosblock, .question-holder, .question-container, .question-box, .q-item, [class*="question-detail"], .questionBody, .sol-questions, .question-wrap, ' +
    '.que-section, .qns-view-box, .test-interface, .ps-container, .aei-comprehension, .test-questions, .question-component'
  );

  const isTestranking = !!document.querySelector('table.table-pt') && !!document.querySelector('.p-1');

  if (hasContent || isTestranking) {
    widget.style.display = 'flex';
  } else {
    widget.style.display = 'none';
  }
}

async function init() {
  const result = await getStorage(['savemockSubjects', 'savemockSubject']);
  if (result.savemockSubjects) SUBJECTS = result.savemockSubjects;
  if (result.savemockSubject) currentSubject = result.savemockSubject;

  createFloatingWidget();

  // Re-check periodically — but skip during bulk save to avoid freezing the page.
  // Interval raised from 500ms to 3000ms to reduce DOM query overhead.
  setInterval(() => {
    if (_isBulkSaving) return; // Don't touch DOM while saving
    createFloatingWidget();
    checkWidgetVisibility();
  }, 3000);

  // Update when subjects/subject change in dashboard
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.savemockSubjects) {
      SUBJECTS = changes.savemockSubjects.newValue;
      updateAllMiniSelectors();
    }
    if (changes.savemockSubject) {
      currentSubject = changes.savemockSubject.newValue;
      updateAllMiniSelectors();
    }
  });

  keepAlive();
}

/**
 * Keeps the Service Worker alive for 5 minutes (resetting on each message).
 * We use a dedicated port to maintain a stable connection.
 */
function keepAlive() {
  let port = null;
  let intervalId = null;

  function isValid() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }

  function connect() {
    if (!isValid()) return; // Extension context invalidated, stop trying
    try {
      port = chrome.runtime.connect({ name: "keepAlive" });
      port.onDisconnect.addListener(() => {
        port = null;
        if (isValid()) setTimeout(connect, 1000);
      });
      // Trigger immediate activity
      port.postMessage({ type: "keepAlive" });
    } catch (_) {
      port = null;
      if (isValid()) setTimeout(connect, 5000);
    }
  }
  connect();

  // Regular interval to ensure SW is active
  intervalId = setInterval(() => {
    if (!isValid()) {
      clearInterval(intervalId);
      return;
    }
    if (port) {
      try {
        port.postMessage({ type: "keepAlive" });
      } catch (e) {
        port = null;
        connect();
      }
    } else {
      connect();
    }
    // Also send a logic-less message to trigger SW wake-up if port fails
    chrome.runtime.sendMessage({ type: "ping" }).catch(() => { });
  }, 20000);
}

function updateAllMiniSelectors() {
  document.querySelectorAll('.sm-mini-sel').forEach(sel => {
    // Clear and rebuild options
    const val = sel.value;
    sel.innerHTML = '';
    SUBJECTS.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
    // Restore value if still exists, or use global current
    if (SUBJECTS.includes(val)) sel.value = val;
    else sel.value = currentSubject;
  });
}

// ─── MathJax DOM-to-LaTeX converter ──────────────────────────────────────────
function decodeMathJax(clone) {
  const convertNode = (node) => {
    if (!node) return "";
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    const tag = node.tagName.toLowerCase();

    // Skip visual-only elements that don't contribute to LaTeX
    if (tag === "mjx-surd") return "";
    if (tag === "mjx-stretchy-h" || tag === "mjx-stretchy-v") {
      let hex = "";
      const firstC = node.querySelector("mjx-c");
      if (firstC) {
        const cls = Array.from(firstC.classList).find((c) => c.startsWith("mjx-c"));
        if (cls) hex = cls.replace("mjx-c", "").toUpperCase();
      }
      if (!hex) {
        const cAttr = node.getAttribute("c");
        if (cAttr) hex = cAttr.toUpperCase();
      }
      if (!hex) return "";
      
      const code = parseInt(hex, 16);
      if (!isNaN(code) && code < 128) {
         const char = String.fromCodePoint(code);
         if (["(", ")", "[", "]", "{", "}", "|"].includes(char)) {
            return char === "{" ? "\\{" : char === "}" ? "\\}" : char;
         }
      }
      
      const stretchyMap = {
        '239B': '(', '239C': '(', '239D': '(',
        '239E': ')', '239F': ')', '23A0': ')',
        '23A1': '[', '23A2': '[', '23A3': '[',
        '23A4': ']', '23A5': ']', '23A6': ']',
        '23A7': '\\{', '23A8': '\\{', '23A9': '\\{', '23AA': '|',
        '23AB': '\\}', '23AC': '\\}', '23AD': '\\}',
        '2320': '\\int', '2321': '\\int',
        '2223': '|', '2225': '\\|',
        '27E8': '\\langle', '27E9': '\\rangle'
      };
      if (stretchyMap[hex]) return stretchyMap[hex];
      return "";
    }
    // Skip assistive MathML duplicates — they contain nested mjx-container clones
    if (tag === "mjx-assistive-mml") return "";

    if (tag === "mjx-c") {
      const cls = Array.from(node.classList).find((c) => c.startsWith("mjx-c"));
      if (cls) {
        const hex = cls.replace("mjx-c", "");
        const code = parseInt(hex, 16);
        if (isNaN(code)) return "";
        // Skip non-breaking spaces — MathJax uses them as visual spacers, not math content
        if (code === 0xA0) return "";
        const char = String.fromCodePoint(code);
        if (["%", "$", "#", "_"].includes(char)) return "\\" + char;
        if (code >= 0x1D44E && code <= 0x1D467) return String.fromCharCode(97 + (code - 0x1D44E)); // a-z
        if (code >= 0x1D434 && code <= 0x1D44D) return String.fromCharCode(65 + (code - 0x1D434)); // A-Z
        return char;
      }
    }

    // Scoped query: finds sel under node, but skips any sel that is inside a nested mjx-frac
    const getInner = (sel) => {
      if (!sel) return Array.from(node.childNodes).map(convertNode).join("");
      const all = node.querySelectorAll(sel);
      for (const el of all) {
        // Walk up from el to node; if we cross another mjx-frac, skip this el
        let parent = el.parentNode;
        let nested = false;
        while (parent && parent !== node) {
          if (parent.tagName && parent.tagName.toLowerCase() === "mjx-frac") {
            nested = true;
            break;
          }
          parent = parent.parentNode;
        }
        if (!nested) return Array.from(el.childNodes).map(convertNode).join("");
      }
      return "";
    };

    const getBase = () => {
      const baseEl = node.querySelector("mjx-base");
      if (baseEl) return Array.from(baseEl.childNodes).map(convertNode).join("");
      return Array.from(node.childNodes)
        .filter(c => c.nodeType !== 1 || c.tagName.toLowerCase() !== "mjx-script")
        .map(c => convertNode(c))
        .join("");
    };

    if (tag === "mjx-frac") return `\\frac{${getInner("mjx-num")}}{${getInner("mjx-den")}}`;
    if (tag === "mjx-msup") {
      const script = getInner("mjx-script").trim();
      if (!script) return getBase(); // Skip empty superscript
      return `${getBase()}^{${script}}`;
    }
    if (tag === "mjx-msub") {
      const script = getInner("mjx-script").trim();
      if (!script) return getBase(); // Skip empty subscript
      return `${getBase()}_{${script}}`;
    }
    if (tag === "mjx-msubsup") {
      const base = getBase();
      const scripts = Array.from(node.children).filter((c) => c.tagName.toLowerCase() === "mjx-script");
      const sub = scripts[0] ? Array.from(scripts[0].childNodes).map(convertNode).join("").trim() : "";
      const sup = scripts[1] ? Array.from(scripts[1].childNodes).map(convertNode).join("").trim() : "";
      let result = base;
      if (sub) result += `_{${sub}}`;
      if (sup) result += `^{${sup}}`;
      return result;
    }
    if (tag === "mjx-mover") {
      const base = getBase();
      const over = node.querySelector("mjx-over");
      const html = over ? over.innerHTML : "";
      if (html.includes("mjx-cAF") || html.includes("\u00AF") || html.includes("mjx-c203E") || html.includes("mjx-stretchy-h")) {
        if (html.includes("mjx-c2192")) return `\\overrightarrow{${base}}`;
        return `\\overline{${base}}`;
      }
      return `\\overset{${getInner("mjx-over")}}{${base}}`;
    }
    // Handle mjx-menclose (used for recurring decimals with border-top)
    if (tag === "mjx-menclose") {
      const box = node.querySelector("mjx-box");
      const content = box ? Array.from(box.childNodes).map(convertNode).join("") : getInner();
      return `\\overline{${content}}`;
    }
    // Handle nth roots: in MathJax CHTML, mjx-mroot children are:
    //   children[0] = the degree/index element (e.g. "3" for cube root)
    //   children[1] = mjx-msqrt containing the radicand (e.g. "28")
    if (tag === "mjx-mroot") {
      const children = Array.from(node.children);
      const indexEl    = children[0]; // degree, e.g. 3
      const radicandEl = children[1]; // mjx-msqrt wrapping the radicand
      const index = indexEl ? Array.from(indexEl.childNodes).map(convertNode).join('').trim() : '';
      const radicand = radicandEl ? (() => {
        const innerBox = radicandEl.querySelector('mjx-box');
        if (innerBox) return Array.from(innerBox.childNodes).map(convertNode).join('');
        return Array.from(radicandEl.childNodes).map(convertNode).join('');
      })() : '';
      if (index) return `\\sqrt[${index}]{${radicand}}`;
      return `\\sqrt{${radicand}}`;
    }
    // Handle square roots — mjx-msqrt (outer) or mjx-sqrt (inner)
    if (tag === "mjx-msqrt" || tag === "mjx-sqrt") {
      const box = node.querySelector("mjx-box");
      if (box) return `\\sqrt{${Array.from(box.childNodes).map(convertNode).join("")}}`;
      return `\\sqrt{${getInner()}}`;
    }
    if (tag === "mjx-root") return `\\sqrt[${getInner("mjx-degree")}]{${getBase()}}`;
    // Passthrough containers
    if (tag === "mjx-math") return getInner();
    if (tag === "mjx-box") return getInner();
    if (tag === "mjx-mstyle") return getInner();
    // mjx-mfenced: process children directly (pipes, parens rendered via mjx-mo)
    if (tag === "mjx-mfenced") return Array.from(node.childNodes).map(convertNode).join("");

    return Array.from(node.childNodes).map(convertNode).join("");
  };

  // Remove assistive-mml wrappers first so nested containers don't get double-processed
  clone.querySelectorAll("mjx-assistive-mml").forEach((el) => el.remove());
  clone.querySelectorAll("mjx-container").forEach((container) => {
    const tex = convertNode(container).trim();
    if (tex) {
      const span = document.createElement("span");
      span.className = "math-tex";
      span.textContent = tex;
      container.replaceWith(span);
    } else {
      container.remove();
    }
  });

  clone.querySelectorAll(".math-tex").forEach((span) => {
    const scriptEl = span.querySelector('script[type="math/tex"]');
    if (scriptEl && scriptEl.textContent) {
      span.textContent = scriptEl.textContent.trim();
    }
  });

  clone.querySelectorAll(".MathJax_Preview, .MathJax, .MJX_Assistive_MathML").forEach((el) => el.remove());
}

// ─── Floating Draggable Widget ───────────────────────────────────────────────

async function updateButtonState() {
  // Logic removed: user wants only 'Save Q' button always visible
}

function createFloatingWidget() {
  if (document.getElementById('sm-floating-widget')) return;

  const widget = document.createElement('div');
  widget.id = 'sm-floating-widget';

  // Create a drag handle
  const dragHandle = document.createElement('div');
  dragHandle.innerHTML = '⋮⋮';
  Object.assign(dragHandle.style, {
    cursor: 'move',
    padding: '0 4px',
    color: '#94a3b8',
    fontSize: '18px',
    lineHeight: '1',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center'
  });

  Object.assign(widget.style, {
    position: 'fixed',
    top: '20px',
    right: '20px',
    zIndex: '2147483647',
    background: '#ffffff',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    padding: '6px 8px',
    display: 'flex', // Always visible for bulk extension
    alignItems: 'center',
    gap: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    fontFamily: 'system-ui, sans-serif'
  });

  // Drag logic
  let isDragging = false;
  let offsetX, offsetY;
  dragHandle.addEventListener('mousedown', e => {
    isDragging = true;
    offsetX = e.clientX - widget.getBoundingClientRect().left;
    offsetY = e.clientY - widget.getBoundingClientRect().top;
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    widget.style.left = `${e.clientX - offsetX}px`;
    widget.style.top = `${e.clientY - offsetY}px`;
    widget.style.right = 'auto'; // override default right:20px
  });
  document.addEventListener('mouseup', () => { isDragging = false; });




  let stopSavingRequested = false;

  const saveAllBtn = document.createElement('button');
  saveAllBtn.className = 'sm-save-all-btn';
  saveAllBtn.innerHTML = '📥 Save All Qs';
  Object.assign(saveAllBtn.style, {
    padding: '6px 12px', background: '#d946ef', color: '#ffffff',
    border: 'none', borderRadius: '5px', cursor: 'pointer',
    fontWeight: '700', fontSize: '14px', lineHeight: '1',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', gap: '4px'
  });

  const stopBtn = document.createElement('button');
  stopBtn.id = 'sm-stop-btn';
  stopBtn.innerHTML = '🛑 Stop';
  Object.assign(stopBtn.style, {
    padding: '6px 12px', background: '#ef4444', color: '#ffffff',
    border: 'none', borderRadius: '5px', cursor: 'pointer',
    fontWeight: '700', fontSize: '14px', lineHeight: '1',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)', display: 'none', alignItems: 'center', gap: '4px'
  });

  stopBtn.onclick = () => {
    stopSavingRequested = true;
    stopBtn.innerHTML = '⏳ Stopping...';
    stopBtn.style.background = '#991b1b';
  };

  saveAllBtn.onmouseover = () => { saveAllBtn.style.background = '#c026d3'; };
  saveAllBtn.onmouseout = () => { if (!saveAllBtn.dataset.saving) saveAllBtn.style.background = '#d946ef'; };

  saveAllBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (saveAllBtn.dataset.saving) return;

    const setName = prompt("Enter Set Name to save these questions under:", "Set 1");
    if (!setName) return;

    saveAllBtn.dataset.saving = 'true';
    _isBulkSaving = true; // Pause DOM polling
    stopSavingRequested = false;
    stopBtn.style.display = 'flex';
    stopBtn.innerHTML = '🛑 Stop';
    stopBtn.style.background = '#ef4444';
    
    // ── Pinnacle: uses a "Next" button (.sol-next) to paginate one question at a time ──
    const pinnacleNext = document.querySelector('button.sol-next, .sol-next');
    if (pinnacleNext) {
      // First: go back to Q1 by clicking Prev until it's gone/disabled
      saveAllBtn.innerHTML = '⏳ Going to Q1...';
      saveAllBtn.style.background = '#7c3aed';

      let rewound = false;
      for (let rewindTry = 0; rewindTry < 300; rewindTry++) {
        if (stopSavingRequested) break;
        const p = document.querySelector('button.sol-prev, .sol-prev');
        if (!p || p.disabled || getComputedStyle(p).display === 'none' || p.classList.contains('disabled') || p.getAttribute('disabled') !== null) {
          rewound = true;
          break;
        }
        p.click();
        await new Promise(r => setTimeout(r, 500));
      }
      
      if (!stopSavingRequested) {
        await new Promise(r => setTimeout(r, 800));

        let savedCount = 0;
        let qIndex = 0;

        // Now loop through all questions using Next
        while (true) {
          if (stopSavingRequested) break;
          saveAllBtn.innerHTML = `⏳ Saving Q${qIndex + 1}...`;

          let currentSub = 'Math';
          let isFirstInSection = false;
          if (qIndex < 30)       { currentSub = 'Math';      if (qIndex === 0)  isFirstInSection = true; }
          else if (qIndex < 60)  { currentSub = 'Reasoning'; if (qIndex === 30) isFirstInSection = true; }
          else if (qIndex < 90)  { currentSub = 'English';   if (qIndex === 60) isFirstInSection = true; }
          else                   { currentSub = 'GK/GS';     if (qIndex === 90) isFirstInSection = true; }

          try {
            const res = await extractAndSaveCurrentQuestion(setName, isFirstInSection ? currentSub : null);
            if (res === true) savedCount++;
          } catch (err) {
            console.warn(`Pinnacle bulk: error on Q${qIndex + 1}:`, err);
          }

          qIndex++;

          // Check if there's a next button still available
          const nextBtn = document.querySelector('button.sol-next, .sol-next');
          if (!nextBtn || nextBtn.disabled || getComputedStyle(nextBtn).display === 'none' || nextBtn.classList.contains('disabled') || nextBtn.getAttribute('disabled') !== null) {
            break; // No more questions
          }

          nextBtn.click();
          await new Promise(r => setTimeout(r, 1500)); // Wait for next question to load
        }

        saveAllBtn.innerHTML = stopSavingRequested ? `🛑 Stopped at ${qIndex} Qs` : `✅ Saved ${savedCount}/${qIndex} to ${setName}`;
      } else {
        saveAllBtn.innerHTML = '🛑 Stopped';
      }
      
      // Final flush of any remaining buffered questions
      await _flushBulkBuffer();
      _isBulkSaving = false; // Resume DOM polling
      
      saveAllBtn.style.background = stopSavingRequested ? '#f59e0b' : '#10b981';
      stopBtn.style.display = 'none';
      setTimeout(() => {
        saveAllBtn.innerHTML = '📥 Save All Qs';
        saveAllBtn.style.background = '#d946ef';
        delete saveAllBtn.dataset.saving;
      }, 3500);
      return;
    }

    const qButtons = Array.from(document.querySelectorAll('.map-qno, .q-no-box, .question-number, .number-item, .palette-item, .qno-btn, .btn-qno, [class*="q-no"]'));

    if (qButtons.length === 0) {
      // Fallback: other platforms with vertical layout
      let staticQuestions = Array.from(document.querySelectorAll(
        '.qpip-inner, .qosblock, .question-holder, .question-container, .question-box, .q-item'
      )).filter(c => c.offsetHeight > 20 && c.offsetWidth > 20);

      if (staticQuestions.length === 0) {
        saveAllBtn.innerHTML = '❌ No Qs Found';
        stopBtn.style.display = 'none';
        setTimeout(() => { saveAllBtn.innerHTML = '📥 Save All Qs'; delete saveAllBtn.dataset.saving; }, 1500);
        return;
      }

      let savedCount = 0;
      let i = 0;
      for (i = 0; i < staticQuestions.length; i++) {
        if (stopSavingRequested) break;
        saveAllBtn.innerHTML = `⏳ Saving... ${i + 1}/${staticQuestions.length}`;
        const container = staticQuestions[i];

        let currentSub = 'Math';
        let isFirstInSection = false;
        if (i < 30)       { currentSub = 'Math';      if (i === 0)  isFirstInSection = true; }
        else if (i < 60)  { currentSub = 'Reasoning'; if (i === 30) isFirstInSection = true; }
        else if (i < 90)  { currentSub = 'English';   if (i === 60) isFirstInSection = true; }
        else               { currentSub = 'GK/GS';    if (i === 90) isFirstInSection = true; }

        try {
          const res = await extractAndSaveCurrentQuestion(setName, isFirstInSection ? currentSub : null, container);
          if (res === true) savedCount++;
        } catch (err) {
          console.warn(`Bulk: error on Q${i + 1}:`, err);
        }
        await new Promise(r => setTimeout(r, 100));
      }

      saveAllBtn.innerHTML = stopSavingRequested ? `🛑 Stopped at ${i}/${staticQuestions.length}` : `✅ Saved ${savedCount}/${staticQuestions.length} to ${setName}`;
      // Final flush of remaining buffered questions
      await _flushBulkBuffer();
      _isBulkSaving = false;
      saveAllBtn.style.background = stopSavingRequested ? '#f59e0b' : '#10b981';
      stopBtn.style.display = 'none';
      setTimeout(() => {
        saveAllBtn.innerHTML = '📥 Save All Qs';
        saveAllBtn.style.background = '#d946ef';
        delete saveAllBtn.dataset.saving;
      }, 3500);
      return;
    }

    // ── Smart DOM-readiness polling helper ──
    const waitForDom = (conditionFn, maxMs = 2000, intervalMs = 50) =>
      new Promise(resolve => {
        const start = Date.now();
        const check = () => {
          if (conditionFn() || Date.now() - start >= maxMs) return resolve();
          setTimeout(check, intervalMs);
        };
        check();
      });

    let savedCount = 0;
    let i = 0;
    let prevQBlockText = ''; 

    for (i = 0; i < qButtons.length; i++) {
      if (stopSavingRequested) break;
      const qBtn = qButtons[i];
      saveAllBtn.innerHTML = `⏳ Saving... ${i + 1}/${qButtons.length}`;

      qBtn.click();

      await waitForDom(() => {
        const qb = document.querySelector('.qblock');
        const txt = qb ? qb.textContent.trim() : '';
        return txt.length > 0 && txt !== prevQBlockText;
      }, 2000, 50);
      if (stopSavingRequested) break;

      const qbNow = document.querySelector('.qblock');
      prevQBlockText = qbNow ? qbNow.textContent.trim() : '';

      const viewSolBtns = Array.from(document.querySelectorAll('.btn-viewsol, a[href^="#soltxt-"], .view-solution-btn, [onclick*="viewsolution"]'));
      const activeSolBtn = viewSolBtns.find(btn => btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0);
      if (activeSolBtn) {
        activeSolBtn.click();
        await waitForDom(() => {
          const sol = document.querySelector('.solutiontxt');
          return sol && sol.textContent.trim().length > 0 && sol.closest('.sblock')?.style.display !== 'none';
        }, 1500, 50);
      }
      if (stopSavingRequested) break;

      let currentSub = "Math";
      let isFirstInSection = false;

      if (i >= 0 && i < 30) { currentSub = "Math"; if (i === 0) isFirstInSection = true; }
      else if (i >= 30 && i < 60) { currentSub = "Reasoning"; if (i === 30) isFirstInSection = true; }
      else if (i >= 60 && i < 90) { currentSub = "English"; if (i === 60) isFirstInSection = true; }
      else if (i >= 90) { currentSub = "GK/GS"; if (i === 90) isFirstInSection = true; }

      const res = await extractAndSaveCurrentQuestion(setName, isFirstInSection ? currentSub : null);
      if (res === true) savedCount++;
    }

    saveAllBtn.innerHTML = stopSavingRequested ? `🛑 Stopped at ${i}/${qButtons.length}` : `✅ Saved ${savedCount} Qs to ${setName}`;
    // Final flush of remaining buffered questions
    await _flushBulkBuffer();
    _isBulkSaving = false;
    saveAllBtn.style.background = stopSavingRequested ? '#f59e0b' : '#10b981';
    stopBtn.style.display = 'none';
    setTimeout(() => {
      saveAllBtn.innerHTML = '📥 Save All Qs';
      saveAllBtn.style.background = '#d946ef';
      delete saveAllBtn.dataset.saving;
    }, 2000);
  });
  widget.appendChild(dragHandle);
  widget.appendChild(saveAllBtn);
  widget.appendChild(stopBtn);
  document.body.appendChild(widget);
}

init();

// ─── Bulk Save Buffer: flush accumulated questions to storage in one write ────
async function _flushBulkBuffer(subject) {
  if (!window._bulkSaveBuffer || !window._bulkSaveBufferDirty) return;
  try {
    await chrome.runtime.sendMessage({ type: "SAVE_BULK_LOCAL", buffer: window._bulkSaveBuffer });
    // Clear buffer after successful write
    if (subject) {
      delete window._bulkSaveBuffer[subject];
    } else {
      window._bulkSaveBuffer = {};
    }
    window._bulkSaveBufferDirty = false;
  } catch (err) {
    console.error('Bulk buffer flush failed:', err);
  }
}

// ─── Image Buffer with cache ─────────────────────────────────────────────────
const _imgCache = new Map();
const _IMG_CACHE_MAX = 100;

async function fetchImageBase64(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url });
    if (response && response.base64) {
      if (_imgCache.size >= _IMG_CACHE_MAX) {
        const oldest = _imgCache.keys().next().value;
        _imgCache.delete(oldest);
      }
      _imgCache.set(url, response.base64);
      return response.base64;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Fetch all images inside a cloned element IN PARALLEL
async function _fetchAllImagesParallel(clone) {
  const images = [];
  const imgEls = clone.querySelectorAll('img');
  const promises = [];
  for (const img of imgEls) {
    let src = img.getAttribute('data-src') ||
      img.getAttribute('data-original') ||
      img.getAttribute('lazy-src') ||
      img.getAttribute('src') ||
      img.src;
    if (src && !src.startsWith('data:')) {
      try { src = new URL(src, window.location.href).href; } catch (e) { }
      const capturedSrc = src;
      promises.push(fetchImageBase64(capturedSrc).then(b64 => ({ img, b64 })));
    } else if (src) {
      images.push(src);
    }
  }
  const results = await Promise.all(promises);
  for (const { img, b64 } of results) {
    if (b64) { img.setAttribute('src', b64); images.push(b64); }
  }
  return images;
}

// ─── Refactored Extractor Function ───────────────────────────────────────────
async function extractAndSaveCurrentQuestion(subject, sectionLabel, specificContainerElement = null) {
  const isTestranking = !!document.querySelector('table.table-pt') &&
    !!document.querySelector('.p-1') &&
    !document.querySelector('.sol-question-section') &&
    !document.querySelector('.qblock');

  let htmlToCopy = '';
  let images = [];

  if (isTestranking) {
    const allP1 = Array.from(document.querySelectorAll('.p-1'));
    const qP1 = allP1.find(el => {
      const p = el.querySelector('p');
      return p && p.textContent.trim().length > 40;
    });
    if (!qP1) return false;

    const optTables = Array.from(document.querySelectorAll('table.table-pt'))
      .filter(t => (t.querySelector('.q-opt-pt') || t.querySelector('label[for^="opt-"]') || t.querySelector('.q-no')) && t.querySelectorAll('table.table-pt').length === 0);
    const solSec = document.querySelector('.solution-sec');

    const qClone = qP1.cloneNode(true);
    decodeMathJax(qClone);
    let assembled = '<div class="p-1">' + qClone.innerHTML + '</div>';

    // Clone all options first, then fetch ALL images in parallel
    const optClones = [];
    for (const t of optTables) {
      const tClone = t.cloneNode(true);
      decodeMathJax(tClone);
      optClones.push({ clone: tClone, correctCls: t.classList.contains('opt-correct-pt') ? ' opt-correct-pt' : '' });
    }
    let sClone = null;
    if (solSec) {
      sClone = solSec.cloneNode(true);
      decodeMathJax(sClone);
    }

    // Fetch ALL images in parallel across all clones
    const allClones = [...optClones.map(o => o.clone), ...(sClone ? [sClone] : [])];
    const imgPromises = [];
    for (const cl of allClones) {
      for (const img of cl.querySelectorAll('img')) {
        let src = img.getAttribute('data-src') || img.getAttribute('src') || img.src;
        if (src && !src.startsWith('data:')) {
          try { src = new URL(src, window.location.href).href; } catch (e) { }
          const capturedSrc = src;
          imgPromises.push(fetchImageBase64(capturedSrc).then(b64 => ({ img, b64 })));
        }
      }
    }
    const imgResults = await Promise.all(imgPromises);
    for (const { img, b64 } of imgResults) {
      if (b64) { img.setAttribute('src', b64); images.push(b64); }
    }

    assembled += '<div class="w-100p"><table class="table-pt w-100p"><tbody>';
    for (const { clone: tClone, correctCls } of optClones) {
      assembled += '<tr class="pt-borders"><table class="table-pt' + correctCls + '">' + tClone.innerHTML + '</table></tr>';
    }
    assembled += '</tbody></table></div>';

    if (sClone) {
      assembled += '<div class="solution-sec">' + sClone.innerHTML + '</div>';
    }

    htmlToCopy = '<div class="testranking-wrapper">' + assembled + '</div>';

  } else {
    let sec = specificContainerElement;

    if (!sec) {
      const candidates = Array.from(document.querySelectorAll(
        '.sol-question-section, .qpip-inner.active, .qosblock, .question-holder, .question-container, .sol-section, .question-box, .q-item, [class*="question-detail"], .questionBody, .sol-questions, .question-wrap'
      ));

      for (let i = 0; i < candidates.length; i++) {
        let c = candidates[i];
        if (c.offsetHeight > 20 && c.offsetWidth > 20) {
          sec = c;
          break;
        }
      }
    }

    if (!sec) return false;

    const clone = sec.cloneNode(true);

    // Force inclusion of passage elements if they are outside the captured container
    // CRITICAL: SPA interfaces (like Oliveboard/Testbook) leave old passage nodes in the DOM.
    // We MUST check if they are actually visible on screen right now.
    const tbPassage = document.querySelector('.aei-comprehension');
    if (tbPassage && tbPassage.getBoundingClientRect().width > 0 && !clone.querySelector('.aei-comprehension')) {
      clone.insertBefore(tbPassage.cloneNode(true), clone.firstChild);
    }
    
    const obPassage = document.querySelector('.paneqcol.panetxt');
    const obIsComprehension = !!document.querySelector('.paneqcol.paner, .qblock.qos-col');
    if (obPassage && obPassage.getBoundingClientRect().width > 0 && obIsComprehension && !clone.querySelector('.paneqcol.panetxt')) {
      clone.insertBefore(obPassage.cloneNode(true), clone.firstChild);
    }

    clone.querySelectorAll('[ng-show*="isNumerical()"]').forEach(el => el.remove());
    decodeMathJax(clone);

    // Fetch ALL images in parallel (not sequential!)
    images = await _fetchAllImagesParallel(clone);

    htmlToCopy = clone.outerHTML;
  }

  try {
    const clean = SavemockParser.cleanMathJaxHtml(htmlToCopy);
    const parsed = SavemockParser.parseQuestionsFromHtml(clean);

    if (parsed.length > 0) {
      const hasSolution = parsed.some(q => q.solutionHtml && q.solutionHtml.trim().length > 0)
        || /ans-solution|solutiontxt|solution-sec/i.test(htmlToCopy);
      // Removed the strict hasSolution requirement so users can save from the test interface.

      if (sectionLabel && parsed.length > 0) {
        parsed[0].questionHtml = `<div style="padding: 4px 8px; background: #6366f1; color: white; display: inline-block; border-radius: 4px; font-weight: bold; margin-bottom: 10px;">${sectionLabel}</div>` + parsed[0].questionHtml;
      }

      // Buffer questions in memory for batched writes (every 5 questions or at end)
      if (!window._bulkSaveBuffer) window._bulkSaveBuffer = {};
      if (!window._bulkSaveBuffer[subject]) window._bulkSaveBuffer[subject] = [];
      window._bulkSaveBuffer[subject].push(...parsed);
      window._bulkSaveBufferDirty = true;

      // Flush to storage every 5 accumulated questions
      if (window._bulkSaveBuffer[subject].length % 5 === 0) {
        await _flushBulkBuffer(subject);
      }
      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.error('Save error:', err);
    return false;
  }
}

