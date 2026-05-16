// ─── Global State & Storage ──────────────────────────────────────────────────
let SUBJECTS = ["Math", "English", "GK/GS", "Reasoning"];
let currentSubject = "Math";

const getStorage = (keys) => new Promise(r => chrome.storage.local.get(keys, r));
const setStorage = (vals) => new Promise(r => chrome.storage.local.set(vals, r));

// ─── Write-queue mutex ───────────────────────────────────────────────────────
// Chrome's storage.local serializes ALL operations through a single IPC channel.
// A heavy set(savemockQuestions) for Q1 will block even a tiny get(savemockFPIndex)
// for Q2. By chaining every background DB write onto this promise, we ensure
// each write completes before the next one starts — no racing, no blocking the
// foreground fingerprint reads.
let _saveQueue = Promise.resolve();
function _queueDbWrite(fn) {
  _saveQueue = _saveQueue.then(() => fn()).catch(err => console.error('[SaveQ] write error:', err));
  return _saveQueue;
}

// ─── Fast fingerprint for duplicate detection ────────────────────────────────
// Simple hash: strip HTML tags, collapse whitespace, take first 200 chars of
// question text + option count.  This is stored in a tiny index so we never
// need to load the full DB just to check for duplicates.
function _stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
}
function questionFingerprint(q) {
  const qText = _stripHtml(q.questionHtml).substring(0, 200);
  const optCount = (q.options || []).length;
  const optSnippet = (q.options || []).map(o => _stripHtml(o.html).substring(0, 40)).join('|');
  return qText + '::' + optCount + '::' + optSnippet;
}

// ─── In-memory fingerprint cache (instant duplicate guard) ───────────────────────────
const _savedFPs = new Set();
// Full in-memory mirror of savemockFPIndex — keeps the foreground save path
// 100% storage-read-free after the first save in a session. This means Q2
// never has to wait on a pending storage write from Q1's background task.
let _fpIndexCache = null;   // null = not yet loaded
let _fpIndexLoaded = false; // true after first load

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

  // Re-check periodically — raised from 500ms to 3000ms to avoid page lag.
  setInterval(() => {
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
    try { return !!(chrome.runtime && chrome.runtime.id); } catch(e) { return false; }
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
        // strip the surd shell and grab the box content
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
      // Wrap with \( \) delimiters so KaTeX can render it properly
      span.textContent = "\\(" + tex + "\\)";
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
    fontSize: '14px',
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
    borderRadius: '6px',
    padding: '3px 5px',
    display: 'none', // Hidden by default, shown only on solution pages
    alignItems: 'center',
    gap: '3px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
    fontFamily: 'system-ui, sans-serif',
    transition: 'transform 0.3s ease-in-out'
  });

  // Collapse Toggle Button
  const toggleBtn = document.createElement('div');
  toggleBtn.id = 'sm-widget-toggle';
  toggleBtn.innerHTML = '›'; // Default: point right to hide
  toggleBtn.title = 'Collapse/Expand';
  Object.assign(toggleBtn.style, {
    cursor: 'pointer',
    padding: '2px 6px',
    color: '#6366f1',
    fontSize: '18px', // Reduced from 26px
    fontWeight: 'bold',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: '1px solid #cbd5e1',
    marginRight: '1px',
    borderRadius: '4px 0 0 4px',
    transition: 'all 0.3s ease'
  });
  // Content Wrapper for everything else (to hide/disable when collapsed)
  const contentWrapper = document.createElement('div');
  Object.assign(contentWrapper.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '3px',
    transition: 'opacity 0.3s'
  });


  toggleBtn.onclick = (e) => {
    e.stopPropagation();
    const isCollapsed = widget.getAttribute('data-collapsed') === 'true';
    if (isCollapsed) {
      // Expand
      widget.style.transform = 'translateX(0)';
      widget.style.background = '#ffffff';
      widget.style.border = '1px solid #cbd5e1';
      widget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
      
      contentWrapper.style.opacity = '1';
      contentWrapper.style.pointerEvents = 'auto';
      
      toggleBtn.innerHTML = '›';
      toggleBtn.style.color = '#6366f1';
      toggleBtn.style.background = 'transparent';
      toggleBtn.style.borderRight = '1px solid #cbd5e1';
      
      widget.setAttribute('data-collapsed', 'false');
    } else {
      // Collapse
      const toggleWidth = toggleBtn.offsetWidth;
      // Use calc(100% - toggleWidth + 20px) to close the default 20px gap from the screen edge
      widget.style.transform = `translateX(calc(100% - ${toggleWidth}px + 20px))`;
      
      contentWrapper.style.opacity = '0';
      contentWrapper.style.pointerEvents = 'none';
      
      widget.style.background = 'transparent';
      widget.style.border = 'none';
      widget.style.boxShadow = 'none';
      
      toggleBtn.innerHTML = '‹';
      toggleBtn.style.color = '#ffffff';
      toggleBtn.style.background = '#4f46e5';
      toggleBtn.style.borderRadius = '6px 0 0 6px'; // Flush with edge
      toggleBtn.style.borderRight = 'none';
      toggleBtn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.25)';
      
      widget.setAttribute('data-collapsed', 'true');
    }
  };

  toggleBtn.onmouseover = () => { 
    if (widget.getAttribute('data-collapsed') !== 'true') {
      toggleBtn.style.background = '#f1f5f9'; 
    }
  };
  toggleBtn.onmouseout = () => { 
    if (widget.getAttribute('data-collapsed') !== 'true') {
      toggleBtn.style.background = 'transparent'; 
    }
  };




  // Drag logic
  let isDragging = false;
  let offsetX, offsetY;
  dragHandle.addEventListener('mousedown', e => {
    if (widget.getAttribute('data-collapsed') === 'true') return;
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

  // Inline mini subject selector
  const miniSel = document.createElement('select');
  miniSel.className = 'sm-mini-sel';
  Object.assign(miniSel.style, {
    padding: '1px 4px', borderRadius: '4px', fontSize: '11px',
    border: '1px solid #6366f1', background: '#1e1b4b', color: '#e0e7ff',
    cursor: 'pointer', outline: 'none', height: '24px'
  });
  SUBJECTS.forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    miniSel.appendChild(o);
  });
  miniSel.value = currentSubject;
  miniSel.addEventListener('change', async () => {
    currentSubject = miniSel.value;
    await setStorage({ savemockSubject: currentSubject });
    updateAllMiniSelectors();
  });

  // Copy+Save button
  const btn = document.createElement('button');
  btn.className = 'sm-copy-btn';
  btn.innerHTML = 'Save Q'; // Removed emoji to save space
  Object.assign(btn.style, {
    padding: '3px 8px', background: '#4f46e5', color: '#ffffff',
    border: 'none', borderRadius: '4px', cursor: 'pointer',
    fontWeight: '700', fontSize: '11px', lineHeight: '1',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', gap: '3px', height: '24px'
  });
  btn.onmouseover = () => { btn.style.background = '#4338ca'; };
  btn.onmouseout = () => { if (!btn.dataset.saving) btn.style.background = '#4f46e5'; };

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.saving) return;

    btn.dataset.saving = 'true';
    const originalText = btn.innerHTML;
    btn.innerHTML = '⏳ Saving...';
    btn.style.background = '#6366f1';

    // Outer try/finally guarantees button is ALWAYS unlocked, even if image
    // fetching throws (CORS, timeout) or any other unexpected error.
    try {

    // Wait 500ms for page to fully settle (MathJax render, SPA hydration)
    // before reading the DOM — prevents duplicate fingerprints from a still-loading page.
    await new Promise(r => setTimeout(r, 500));

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

    // Auto-open solution if available before extracting
    const allBtns = Array.from(document.querySelectorAll('button, a'));
    const viewSolBtns = Array.from(document.querySelectorAll('.btn-viewsol, a[href^="#soltxt-"], .view-solution-btn, [onclick*="viewsolution"], .sol-btn, .solution-btn'));
    
    // Add text-based matching for "Solution" or "View Solution"
    allBtns.forEach(b => {
      const txt = b.textContent.trim().toLowerCase();
      if ((txt === 'solution' || txt === 'view solution' || txt === 'solutions' || txt === 'show solution') && b.getBoundingClientRect().width > 0) {
        viewSolBtns.push(b);
      }
    });

    const activeSolBtn = viewSolBtns.find(btn => btn.getBoundingClientRect().width > 0 && btn.getBoundingClientRect().height > 0);
    if (activeSolBtn) {
      activeSolBtn.click();
      await waitForDom(() => {
        const sol = document.querySelector('.sol-question-section, .sol-section, .ans-solution, .solution-box, .solution-wrapper, .view-solution, .solution-sec, .solutiontxt');
        return sol !== null;
      }, 1500, 50);
    }

    // ── Testranking detection ────────────────────────────────────────────────
    // Testranking puts .p-1 inside <tr> tags; browsers hoist those divs to
    // <body>, so there is no single wrapper element that contains everything.
    // We detect this layout early and build the HTML manually.
    const isTestranking = !!document.querySelector('table.table-pt') &&
      !!document.querySelector('.p-1') &&
      !document.querySelector('.sol-question-section') &&
      !document.querySelector('.qblock');

    let htmlToCopy = '';
    const images = [];
    const subject = miniSel.value;

    if (isTestranking) {
      // Collect the question from the first .p-1 that is not a UI button
      const allP1 = Array.from(document.querySelectorAll('.p-1'));
      const qP1 = allP1.find(el => {
        // Real questions always have a <p> child with substantial text.
        // UI buttons (Zoom, Instructions, Switch Fullscreen) are short plain text.
        const p = el.querySelector('p');
        return p && p.textContent.trim().length > 40;
      });
      if (!qP1) {
        btn.innerHTML = '❌ No Q';
        btn.style.background = '#ef4444';
        setTimeout(() => { btn.innerHTML = 'Save Q'; btn.style.background = '#4f46e5'; delete btn.dataset.saving; }, 1200);
        return;
      }

      // Collect option tables and solution
      const optTables = Array.from(document.querySelectorAll('table.table-pt'))
        .filter(t => (t.querySelector('.q-opt-pt') || t.querySelector('label[for^="opt-"]') || t.querySelector('.q-no')) && t.querySelectorAll('table.table-pt').length === 0);
      const solSec = document.querySelector('.solution-sec');

      // Build a synthetic wrapper that the parser already understands
      const qClone = qP1.cloneNode(true);
      decodeMathJax(qClone);
      let assembled = '<div class="p-1">' + qClone.innerHTML + '</div>';

      // Clone all options and solution FIRST, then fetch all images in parallel
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

      // Collect ALL image fetch promises from options + solution
      const imgPromises = [];
      const allClones = [...optClones.map(o => o.clone), ...(sClone ? [sClone] : [])];
      for (const cl of allClones) {
        for (const img of cl.querySelectorAll('img')) {
          let src = img.getAttribute('data-src') || img.getAttribute('src') || img.src;
          if (src && !src.startsWith('data:')) {
            try { src = new URL(src, window.location.href).href; } catch(e){}
            const capturedSrc = src;
            imgPromises.push(fetchImageBase64(capturedSrc).then(b64 => ({ img, b64 })));
          }
        }
      }
      // Fetch all images in parallel
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
      // ── Non-Testranking: find the visible question container as before ────
      const candidates = Array.from(document.querySelectorAll(
        '.sol-question-section, .qpip-inner.active, .qosblock, .question-holder, .question-container, .sol-section, .question-box, .q-item, [class*="question-detail"], .questionBody, .sol-questions, .question-wrap'
      ));

      let sec = null;
      for (let i = 0; i < candidates.length; i++) {
        let c = candidates[i];
        if (c.offsetHeight > 20 && c.offsetWidth > 20) {
          sec = c;
          break;
        }
      }

      if (!sec) {
        btn.innerHTML = '❌ No Q';
        btn.style.background = '#ef4444';
        setTimeout(() => { btn.innerHTML = 'Save Q'; btn.style.background = '#4f46e5'; delete btn.dataset.saving; }, 1200);
        return;
      }

      const clone = sec.cloneNode(true);

      // Force inclusion of passage elements if they are outside the captured container
      // CRITICAL: SPA interfaces (like Oliveboard/Testbook) leave old passage nodes in the DOM.
      // We MUST check if they are actually visible on screen right now.
      const tbPassage = document.querySelector('.aei-comprehension');
      if (tbPassage && tbPassage.getBoundingClientRect().width > 0 && !clone.querySelector('.aei-comprehension')) {
        clone.insertBefore(tbPassage.cloneNode(true), clone.firstChild);
      }
      
      const obPassage = document.querySelector('.paneqcol.panetxt');
      if (obPassage && obPassage.getBoundingClientRect().width > 0 && !clone.querySelector('.paneqcol.panetxt')) {
        clone.insertBefore(obPassage.cloneNode(true), clone.firstChild);
      }

      clone.querySelectorAll('[ng-show*="isNumerical()"]').forEach(el => el.remove());

      // ── Oliveboard language detection ──────────────────────────────────
      // The page has both .eqt (English) and .hqt (Hindi) spans.
      // The toggle button img.change-lang tells us which is active:
      //   src="...lang-hindi.svg"   → English is currently shown
      //   src="...lang-english.svg" → Hindi is currently shown
      const langBtn = document.querySelector('img.change-lang');
      if (langBtn) {
        const langSrc = langBtn.getAttribute('src') || '';
        if (langSrc.includes('lang-hindi')) {
          // Hindi is active → remove English spans
          clone.querySelectorAll('.eqt').forEach(el => el.remove());
        } else {
          // English is active → remove Hindi spans
          clone.querySelectorAll('.hqt').forEach(el => el.remove());
        }
      }

      decodeMathJax(clone);

      // Fetch ALL images in parallel instead of sequentially
      const imgs = clone.querySelectorAll('img');
      const imgPromises = [];
      for (const img of imgs) {
        let src = img.getAttribute('data-src') ||
          img.getAttribute('data-original') ||
          img.getAttribute('lazy-src') ||
          img.getAttribute('src') ||
          img.src;
        if (src && !src.startsWith('data:')) {
          try { src = new URL(src, window.location.href).href; } catch (e) {}
          const capturedSrc = src;
          imgPromises.push(fetchImageBase64(capturedSrc).then(b64 => ({ img, b64 })));
        } else if (src) {
          images.push(src);
        }
      }
      const imgResults = await Promise.all(imgPromises);
      for (const { img, b64 } of imgResults) {
        if (b64) { img.setAttribute('src', b64); images.push(b64); }
      }

      htmlToCopy = clone.outerHTML;
    }

    //Work happens here
    try {
      // Parse FIRST (cheap, no I/O) — check solution before touching storage
      const clean = SavemockParser.cleanMathJaxHtml(htmlToCopy);
      const parsed = SavemockParser.parseQuestionsFromHtml(clean);

      if (parsed.length > 0) {
        // We allow saving even if solution is not present (e.g. during an ongoing test)
        const hasSolution = parsed.some(q => q.solutionHtml && q.solutionHtml.trim().length > 0);
        // Removed the strict hasSolution requirement so users can save from the test interface.

        // ── 1. Check in-memory cache first (zero latency, catches rapid double-clicks) ──
        const newFingerprints = parsed.map(q => questionFingerprint(q));
        const alreadyInMemory = newFingerprints.every(fp => _savedFPs.has(fp));
        if (alreadyInMemory) {
          btn.innerHTML = '✨ Already Saved';
          setTimeout(() => {
            btn.innerHTML = '💾 Save Q';
            btn.style.background = '#4f46e5';
            delete btn.dataset.saving;
          }, 800);
          return;
        }

        // ── 2. Check fingerprint index (in-memory cache, no storage read needed) ─
        const indexKey = 'savemockFPIndex';
        // Load fpIndex from storage only once per session (cold start).
        // After that, all reads use the in-memory mirror — zero blocking.
        if (!_fpIndexLoaded) {
          const idxResult = await chrome.storage.local.get([indexKey]);
          _fpIndexCache = idxResult[indexKey] || {};
          // Seed the in-memory FP set from storage so we detect old duplicates
          Object.values(_fpIndexCache).forEach(arr => arr.forEach(fp => _savedFPs.add(fp)));
          _fpIndexLoaded = true;
        }
        const fpIndex = _fpIndexCache;
        if (!fpIndex[subject]) fpIndex[subject] = [];

        const existingSet = new Set(fpIndex[subject]);

        const actualNew = [];
        const actualNewFPs = [];
        for (let i = 0; i < parsed.length; i++) {
          if (!existingSet.has(newFingerprints[i])) {
            actualNew.push(parsed[i]);
            actualNewFPs.push(newFingerprints[i]);
          }
        }

        if (actualNew.length > 0) {
          // ── Register in memory IMMEDIATELY (synchronous — no race possible)
          actualNewFPs.forEach(fp => _savedFPs.add(fp));
          // Update the in-memory index mirror right now so Q2 sees it instantly
          fpIndex[subject] = [...actualNewFPs, ...fpIndex[subject]];

          // Show "Saved!" immediately — no storage wait needed
          btn.innerHTML = '✅ Saved!';
          btn.style.background = '#10b981';
          setTimeout(() => {
            btn.innerHTML = '💾 Save Q';
            btn.style.background = '#4f46e5';
            delete btn.dataset.saving;
          }, 500);

          // ── BACKGROUND: all storage writes queued (index + questions DB) ─
          // Both writes are serialized so they never race each other.
          // Q2's foreground path is now 100% storage-read/write-free.
          _queueDbWrite(async () => {
            try {
              // 1. Direct Cloud Save (Concurrent with local save)
              actualNew.forEach(q => {
                chrome.runtime.sendMessage({
                  type: "SAVE_TO_SUPABASE",
                  question: {
                    fingerprint: questionFingerprint(q),
                    subject: subject,
                    question_html: q.questionHtml,
                    options: q.options,
                    answer: q.answer,
                    explanation: q.explanation,
                    notes: q.notes || "",
                    source: q.source || "Extension"
                  }
                });
              });

              // 2. Persist the fingerprint index (small, fast)
              await chrome.storage.local.set({ [indexKey]: fpIndex });
              // 3. Persist the full questions DB (large, slow — but queued)
              // Offloaded to background script to prevent freezing the web page main thread
              await chrome.runtime.sendMessage({ type: "SAVE_QUESTION_LOCAL", subject, actualNew });
            } catch (bgErr) {
              console.error('Background save failed:', bgErr);
              // Rollback in-memory index so user can retry
              actualNewFPs.forEach(fp => _savedFPs.delete(fp));
              fpIndex[subject] = fpIndex[subject].filter(fp => !actualNewFPs.includes(fp));
            }
          });
        } else {
          btn.innerHTML = '✨ Already Saved';
          setTimeout(() => {
            btn.innerHTML = '💾 Save Q';
            btn.style.background = '#4f46e5';
            delete btn.dataset.saving;
          }, 500);
        }
      } else {
        btn.innerHTML = '❌ Parse Failed';
        btn.style.background = '#ef4444';
        setTimeout(() => {
          btn.innerHTML = '💾 Save Q';
          btn.style.background = '#4f46e5';
          delete btn.dataset.saving;
        }, 500);
      }
    } catch (err) {
      console.error('Save error:', err);
      btn.innerHTML = '❌ Error';
      btn.style.background = '#ef4444';
      setTimeout(() => {
        btn.innerHTML = '💾 Save Q';
        btn.style.background = '#4f46e5';
        delete btn.dataset.saving;
      }, 500);
    }

    } catch (outerErr) {
      // Catches errors from image fetching, DOM cloning, or any other step
      // outside the inner try/catch (e.g. Promise.all throwing).
      console.error('Critical save error (outer):', outerErr);
      btn.innerHTML = '❌ Error';
      btn.style.background = '#ef4444';
      setTimeout(() => {
        btn.innerHTML = '💾 Save Q';
        btn.style.background = '#4f46e5';
        delete btn.dataset.saving;
      }, 1500);
    } finally {
      // Safety net — always ensure the saving lock is released.
      // Individual paths clear it themselves (for correct timing),
      // but this catches any path that slips through.
      setTimeout(() => { delete btn.dataset.saving; }, 4000);
    }
  });

  widget.appendChild(toggleBtn);
  contentWrapper.appendChild(dragHandle);
  contentWrapper.appendChild(miniSel);
  contentWrapper.appendChild(btn);
  widget.appendChild(contentWrapper);
  document.body.appendChild(widget);
}

init();

// ─── Image Buffer with in-memory cache ───────────────────────────────────────
const _imgCache = new Map();
const _IMG_CACHE_MAX = 100;

async function fetchImageBase64(url) {
  // Return cached result instantly
  if (_imgCache.has(url)) return _imgCache.get(url);
  try {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url });
    if (response && response.base64) {
      // Evict oldest entry if cache is full
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
