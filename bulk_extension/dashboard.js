let SUBJECTS = ["Math", "English", "GK/GS", "Reasoning"];
const OPT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed", "#0891b2"];

let db = { Math: [], English: [], "GK/GS": [], Reasoning: [] };
let currentSubject = "Math";
let lastLocalSave = 0;
let _initialCleanDone = false;  // Only auto-clean/dedup once on first load
let _renderTimer = null;        // Debounce timer for render()
let _cleanupCancelled = false;  // Set to true when external data arrives to abort stale cleanup

// Pagination state: tracks how many questions are displayed per subject
const QUESTIONS_PER_PAGE = 10;
let displayedCount = {}; // { subject: count }
let _renderingInProgress = false; // Guard against overlapping renders
let _lastRenderedSubject = '';    // Track what's currently shown
let _lastRenderedCount = 0;       // Track how many cards are shown

// ─── Fingerprint helpers (for duplicate detection) ───────────────────────────────────
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

function isExtensionValid() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
function init() {
  loadData(debouncedRender);

  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  const darkBtn = document.getElementById('btn-toggle-dark');
  if (darkBtn) {
    darkBtn.addEventListener('click', toggleDarkMode);
  }
  
  // Load dark mode preference
  chrome.storage.local.get(['darkMode'], (res) => {
    if (res.darkMode) {
      document.body.classList.add('dark-mode');
      if (darkBtn) darkBtn.textContent = '☀️';
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.savemockSubjects) {
      loadData(debouncedRender);
      return;
    }
    // We intentionally ignore changes.savemockQuestions here to avoid heavy JSON parsing.
    // Dashboard updates are handled via the NEW_QUESTION_SAVED message below.
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_QUESTION_SAVED" || msg.type === "BULK_QUESTION_SAVED") {
      const isBulk = msg.type === "BULK_QUESTION_SAVED";
      
      // Update in-memory DB incrementally
      if (isBulk) {
        const buffer = msg.buffer;
        if (!buffer) return;
        Object.keys(buffer).forEach(subject => {
          if (!db[subject]) db[subject] = [];
          db[subject] = [...buffer[subject], ...db[subject]];
          displayedCount[subject] = Math.max(displayedCount[subject] || QUESTIONS_PER_PAGE, QUESTIONS_PER_PAGE) + buffer[subject].length;
        });
      } else {
        const { subject, actualNew } = msg;
        if (!actualNew || actualNew.length === 0) return;
        if (!db[subject]) db[subject] = [];
        db[subject] = [...actualNew, ...db[subject]];
        displayedCount[subject] = Math.max(displayedCount[subject] || QUESTIONS_PER_PAGE, QUESTIONS_PER_PAGE) + actualNew.length;
      }
      
      // Update sidebar counts
      renderSidebar();
      
      // We rely on debouncedRender to incrementally update the view for bulk saves
      if (document.activeElement && document.activeElement.classList.contains('q-notes-editor')) {
        toast("Data updated in background.");
      } else {
        debouncedRender();
      }
    }
  });

  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) exportBtn.addEventListener('click', exportHtml);

  const backupBtn = document.getElementById('btn-backup');
  if (backupBtn) backupBtn.addEventListener('click', backupJson);

  const restoreBtn = document.getElementById('btn-restore');
  if (restoreBtn) restoreBtn.addEventListener('change', restoreJson);

  const clearSubBtn = document.getElementById('btn-clear-subject');
  if (clearSubBtn) clearSubBtn.addEventListener('click', clearSubject);
  const sortBtn = document.getElementById('btn-sort');
  if (sortBtn) sortBtn.addEventListener('click', sortSubject);
  
  const addSubBtn = document.getElementById('btn-add-subject');
  if (addSubBtn) {
    addSubBtn.addEventListener('click', addSubject);
  }

  // Manual refresh button — replaces auto-refresh to avoid lag
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.innerHTML = '⏳ Loading...';
      refreshBtn.disabled = true;
      _initialCleanDone = true; // Skip cleanup on manual refresh
      loadData(() => {
        // Call render() directly (no debounce delay) so cards appear immediately.
        // Restore the button label after the async card builder finishes.
        render();
        // _buildCardsAsync is async; poll for its completion to restore the button.
        const _restoreBtn = () => {
          if (_renderingInProgress) { setTimeout(_restoreBtn, 100); return; }
          refreshBtn.innerHTML = '🔄 Refresh';
          refreshBtn.disabled = false;
        };
        setTimeout(_restoreBtn, 50);
      });
    });
  }

  const takeTestBtn = document.getElementById('btn-take-test');
  if (takeTestBtn) {
    takeTestBtn.addEventListener('click', () => {
      if ((db[currentSubject] || []).length === 0) {
        alert("No questions in this section to take a test.");
        return;
      }
      window.open(`test.html?subject=${encodeURIComponent(currentSubject)}`, '_blank');
    });
  }

  const viewHistoryBtn = document.getElementById('btn-view-history');
  if (viewHistoryBtn) {
    viewHistoryBtn.addEventListener('click', renderHistoryView);
  }

  // ─── Image Lightbox Logic ───
  const lightbox = document.getElementById('image-lightbox');
  const lightboxImg = lightbox.querySelector('img');
  const lightboxClose = lightbox.querySelector('.close-btn');
  let lbScale = 1;
  let lbX = 0, lbY = 0;
  let lbDragging = false;
  let lbDragStart = { x: 0, y: 0 };
  let lbPanStart = { x: 0, y: 0 };

  const applyTransform = (transition = '0.1s ease') => {
    lightboxImg.style.transition = `transform ${transition}`;
    lightboxImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
    lightboxImg.style.cursor = lbScale > 1 ? (lbDragging ? 'grabbing' : 'grab') : 'zoom-in';
  };

  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.closest('.q-card, .q-notes-view, .q-notes-editor')) {
      lightboxImg.src = e.target.src;
      lbScale = 1; lbX = 0; lbY = 0;
      lightboxImg.style.transform = '';
      lightboxImg.style.transition = '';
      lightbox.classList.add('show');
      document.body.style.overflow = 'hidden';
    }
  });

  const closeLightbox = () => {
    lightbox.classList.remove('show');
    document.body.style.overflow = '';
    lbScale = 1; lbX = 0; lbY = 0;
    setTimeout(() => { lightboxImg.src = ''; lightboxImg.style.transform = ''; }, 300);
  };

  // ── Scroll to zoom ──
  lightbox.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    lbScale = Math.min(5, Math.max(0.5, lbScale + delta));
    if (lbScale <= 1) { lbX = 0; lbY = 0; }
    applyTransform();
  }, { passive: false });

  // ── Drag to pan ──
  lightboxImg.addEventListener('mousedown', (e) => {
    if (lbScale <= 1) return;
    e.preventDefault();
    lbDragging = true;
    lbDragStart = { x: e.clientX, y: e.clientY };
    lbPanStart = { x: lbX, y: lbY };
    lightboxImg.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!lbDragging) return;
    lbX = lbPanStart.x + (e.clientX - lbDragStart.x);
    lbY = lbPanStart.y + (e.clientY - lbDragStart.y);
    applyTransform('0s');
  });

  document.addEventListener('mouseup', () => {
    if (!lbDragging) return;
    lbDragging = false;
    applyTransform('0s');
  });

  // ── Click backdrop to close (not the image) ──
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightboxClose.addEventListener('click', closeLightbox);

  keepAlive();
}

/**
 * Dual-strategy keep-alive for the service worker:
 *  1) Persistent port connection (fast path)
 *  2) Periodic sendMessage ping (restart the SW if it was killed)
 */
function keepAlive() {
  let port = null;

  function connectPort() {
    if (!isExtensionValid()) return;
    if (port) return;
    try {
      port = chrome.runtime.connect({ name: "keepAlive" });
      port.onDisconnect.addListener(() => {
        port = null;
        if (isExtensionValid()) setTimeout(connectPort, 1000);
      });
      // Ping immediately upon connection
      port.postMessage({ type: "keepAlive" });
    } catch (_) {
      setTimeout(connectPort, 5000);
    }
  }

  connectPort();

  // Periodic pings:
  // 1. Over the port (resets port's 5min idle timer)
  // 2. Via sendMessage (restarts terminated SW)
  setInterval(() => {
    if (!isExtensionValid()) return;
    
    // Heartbeat via port
    if (port) {
      try {
        port.postMessage({ type: "keepAlive" });
      } catch (e) {
        port = null;
        connectPort();
      }
    } else {
      connectPort();
    }

    // Heartbeat via message (fallback & SW wake-up)
    chrome.runtime.sendMessage({ type: "ping" }, (response) => {
      if (chrome.runtime.lastError) {
        // SW might be restarting, ignore error but attempt port relink
        if (!port) connectPort();
      }
    });
  }, 20000);
}

function defaultDb() {
  return { Math: [], English: [], "GK/GS": [], Reasoning: [] };
}

function stripLeadingNumber(html) {
  if (!html) return "";
  try {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
    let node;
    let cleanedAny = false;
    
    while (node = walker.nextNode()) {
      const text = node.textContent;
      // Regex matches: start-of-string, followed by digits, dots, Q, colons, parens, brackets, or spaces.
      const match = text.match(/^\s*(?:Q\.?\s*)?\d+[\s]*[\.\)\:\-\#\/]+\s*/);
      
      if (match) {
        const original = node.textContent;
        const cleaned = original.replace(match[0], "");
        if (cleaned !== original) {
          node.textContent = cleaned;
          cleanedAny = true;
          // If we cleaned the node and it still has text, we've reached the content.
          if (node.textContent.trim()) break;
        }
      } else {
        // If we hit a text node that doesn't start with numbering, we stop.
        if (text.trim()) break;
      }
    }
    return cleanedAny ? tmp.innerHTML : html;
  } catch (e) {
    return html;
  }
}

async function loadData(cb) {
  try {
    const result = await chrome.storage.local.get(['savemockSubjects']);
    
    if (result.savemockSubjects && Array.isArray(result.savemockSubjects)) {
      SUBJECTS = result.savemockSubjects;
    }
    
    db = (await getFullDb(SUBJECTS)) || {};
    
    // Ensure all subjects always exist in db
    SUBJECTS.forEach(s => { if (!db[s]) db[s] = []; });
    
    if (!SUBJECTS.includes(currentSubject)) {
      currentSubject = SUBJECTS[0] || "";
    }

    // Initialize displayedCount for pagination
    SUBJECTS.forEach(s => {
      if (!displayedCount[s]) {
        displayedCount[s] = Math.min(QUESTIONS_PER_PAGE, (db[s] || []).length);
      }
    });
    
    if (cb) cb();
  } catch (e) {
    console.error('Savemock load error:', e);
    db = {};
    if (cb) cb();
  }
}


// ─── Render ──────────────────────────────────────────────────────────────────
// Debounced render: prevents rapid re-renders when multiple storage changes
// arrive in quick succession (e.g. content.js saving + FP index update).
function debouncedRender() {
  if (_renderTimer) clearTimeout(_renderTimer);
  _renderTimer = setTimeout(() => {
    _renderTimer = null;
    render();
  }, 300);
}

function render() {
  if (currentSubject === null) return; // Prevent standard rendering if history is active
  
  const takeTestBtn = document.getElementById('btn-take-test');
  if (takeTestBtn) takeTestBtn.style.display = 'inline-flex';
  const sortBtn = document.getElementById('btn-sort');
  if (sortBtn) sortBtn.style.display = 'inline-flex';
  const viewHistoryBtn = document.getElementById('btn-view-history');
  if (viewHistoryBtn) viewHistoryBtn.classList.remove('active');

  renderSidebar();
  
  // If the user is currently typing in a notes area, don't rebuild the questions list
  // as it would destroy the textarea they are interacting with.
  if (document.activeElement && document.activeElement.classList.contains('q-notes-area')) {
    return;
  }
  
  renderQuestions();
}

function renderSidebar() {
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  SUBJECTS.forEach((sub, idx) => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';

    const btn = document.createElement('button');
    btn.className = `nav-btn ${sub === currentSubject ? 'active' : ''}`;
    btn.innerHTML = `<span>${sub}</span><span class="count">${(db[sub] || []).length}</span>`;
    btn.onclick = () => { 
      currentSubject = sub;
      // Reset displayed count for new subject to show first 20 questions
      if (!displayedCount[currentSubject]) {
        displayedCount[currentSubject] = QUESTIONS_PER_PAGE;
      }
      render(); 
      if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('open');
      }
    };
    
    const actions = document.createElement('div');
    actions.className = 'sidebar-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Rename section';
    editBtn.onclick = (e) => { e.stopPropagation(); renameSubject(sub); };
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-btn del';
    delBtn.innerHTML = '🗑️';
    delBtn.title = 'Delete section';
    delBtn.onclick = (e) => { e.stopPropagation(); deleteSubject(sub); };
    
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
    
    item.appendChild(btn);
    // Don't show delete for default subjects or if it's the only one
    if (SUBJECTS.length > 1) {
      item.appendChild(actions);
    }
    
    nav.appendChild(item);
  });
}

function renderQuestions() {
  const title = document.getElementById('subject-title');
  const list  = document.getElementById('questions-list');
  const clearBtn = document.getElementById('btn-clear-subject');
  const sortBtn = document.getElementById('btn-sort');

  const qs = db[currentSubject] || [];
  const totalCount = qs.length;

  // Get current displayed count for this subject, default to QUESTIONS_PER_PAGE
  let currentDisplayed = displayedCount[currentSubject] || QUESTIONS_PER_PAGE;
  currentDisplayed = Math.min(currentDisplayed, totalCount);
  if (totalCount > 0) currentDisplayed = Math.max(currentDisplayed, Math.min(QUESTIONS_PER_PAGE, totalCount));

  title.textContent = `${currentSubject} — Showing ${currentDisplayed} of ${totalCount} question${totalCount !== 1 ? 's' : ''}`;
  clearBtn.style.display = totalCount > 0 ? 'inline-flex' : 'none';
  if (sortBtn) sortBtn.style.display = totalCount > 1 ? 'inline-flex' : 'none';

  if (totalCount === 0) {
    const subText = currentSubject ? `<strong>${currentSubject}</strong>` : "any subject";
    list.innerHTML = `<div class="empty-state">
      <div class="icon">📋</div>
      <p>No questions saved for ${subText} yet.</p>
      <p style="margin-top:8px;font-size:13px;">Go to any mock exam site, select the subject in the floating panel, then click <strong>Copy HTML</strong>.</p>
    </div>`;
    _lastRenderedSubject = currentSubject;
    _lastRenderedCount = 0;
    return;
  }

  // Build cards in async chunks so the browser doesn't freeze
  _buildCardsAsync(list, qs, currentDisplayed, totalCount);
}

// Async chunked card builder — yields to browser between small batches
async function _buildCardsAsync(list, qs, targetCount, totalCount) {
  if (_renderingInProgress) return; // Don't overlap renders
  _renderingInProgress = true;
  const CHUNK_SIZE = 5;
  const subject = currentSubject; // capture for async safety

  list.innerHTML = '';
  _lastRenderedSubject = subject;
  _lastRenderedCount = 0;

  // Remove old load-more button
  const oldLoadMore = list.querySelector('.load-more-container');
  if (oldLoadMore) oldLoadMore.remove();

  for (let i = 0; i < targetCount; i += CHUNK_SIZE) {
    // If subject changed mid-render, abort
    if (currentSubject !== subject) { _renderingInProgress = false; return; }
    
    const end = Math.min(i + CHUNK_SIZE, targetCount);
    const fragment = document.createDocumentFragment();
    for (let j = i; j < end; j++) {
      const card = buildCard(qs[j], j);
      fragment.appendChild(card);
    }
    list.appendChild(fragment);
    
    // Render math only for the cards we just added (not the whole list!)
    const newCards = list.querySelectorAll('.q-card');
    for (let j = i; j < end; j++) {
      if (newCards[j]) renderMathInCard(newCards[j]);
    }
    _lastRenderedCount = end;

    // Yield to browser between chunks (except the last one)
    if (end < targetCount) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Add "Load More" button if needed
  _addLoadMoreButton(list, targetCount, totalCount);
  _renderingInProgress = false;
}

function _addLoadMoreButton(list, currentDisplayed, totalCount) {
  if (currentDisplayed >= totalCount) return;
  const loadMoreDiv = document.createElement('div');
  loadMoreDiv.className = 'load-more-container';
  loadMoreDiv.style.cssText = 'text-align: center; margin: 20px 0; padding: 10px;';
  loadMoreDiv.innerHTML = `
    <button id="btn-load-more" class="load-more-btn" style="
      background: #2563eb; color: white; border: none;
      padding: 10px 24px; border-radius: 6px; font-size: 14px;
      cursor: pointer; font-weight: 500; transition: background 0.2s;
    ">Load More (${totalCount - currentDisplayed} remaining)</button>
  `;
  list.appendChild(loadMoreDiv);
  const loadMoreBtn = loadMoreDiv.querySelector('#btn-load-more');
  loadMoreBtn.addEventListener('click', () => {
    displayedCount[currentSubject] = currentDisplayed + QUESTIONS_PER_PAGE;
    renderQuestions();
  });
  loadMoreBtn.addEventListener('mouseenter', () => { loadMoreBtn.style.background = '#1d4ed8'; });
  loadMoreBtn.addEventListener('mouseleave', () => { loadMoreBtn.style.background = '#2563eb'; });
}

// Fix broken LaTeX from old saved data (double subscripts, empty scripts, NBSP)
function sanitizeTex(tex) {
  if (!tex) return tex;
  // Remove non-breaking space characters
  tex = tex.replace(/\u00A0/g, '');
  // Remove empty subscripts/superscripts first: _{} or ^{}
  tex = tex.replace(/_\{\s*\}/g, '');
  tex = tex.replace(/\^\{\s*\}/g, '');
  // Fix double subscripts: _{a}_{b} → _{a} (keep first, drop bogus second)
  // Apply repeatedly in case of triple nesting
  let prev;
  do {
    prev = tex;
    tex = tex.replace(/(_\{[^}]*\})_\{[^}]*\}/g, '$1');
    tex = tex.replace(/(\^\{[^}]*\})\^\{[^}]*\}/g, '$1');
  } while (tex !== prev);
  return tex.trim();
}

function normalizeLatex(tex) {
  if (!tex) return tex;
  return tex
    .replace(/×/g, '\\times ')
    .replace(/÷/g, '\\div ')
    .replace(/−/g, '-')
    .replace(/≤/g, '\\leq ')
    .replace(/≥/g, '\\geq ')
    .replace(/≠/g, '\\neq ')
    .replace(/≈/g, '\\approx ')
    .replace(/∞/g, '\\infty ')
    .replace(/π/g, '\\pi ')
    .replace(/√/g, '\\sqrt')
    .replace(/α/g, '\\alpha ')
    .replace(/β/g, '\\beta ')
    .replace(/γ/g, '\\gamma ')
    .replace(/θ/g, '\\theta ')
    .replace(/∑/g, '\\sum ')
    .replace(/∫/g, '\\int ')
    .replace(/\\frac/g, '\\dfrac');
}

// Scan text nodes for bare LaTeX (\frac{}{}, \sqrt{}) not inside delimiters,
// and wrap them in \( \) so auto-render can pick them up.
function wrapBareLatex(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  let node;
  const nodesToProcess = [];
  while (node = walker.nextNode()) {
    const parent = node.parentNode;
    if (parent && (parent.closest('.math-tex') || parent.closest('.katex') || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) continue;
    if (node.textContent.includes('\\frac{') || node.textContent.includes('\\dfrac{') || node.textContent.includes('\\sqrt{') || node.textContent.includes('\\overline{')) {
      nodesToProcess.push(node);
    }
  }
  nodesToProcess.forEach(textNode => {
    const text = textNode.textContent;
    // Use regex to find \frac{...}{...} or \sqrt{...} patterns
    const pattern = /(\\d?frac\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\\sqrt\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\\overline\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g;
    const parts = text.split(pattern);
    const matches = text.match(pattern);
    if (!matches || matches.length === 0) return;
    let changed = false;
    let result = '';
    let mi = 0;
    for (let pi = 0; pi < parts.length; pi++) {
      result += parts[pi];
      if (mi < matches.length) {
        result += '\\(' + matches[mi] + '\\)';
        mi++;
        changed = true;
      }
    }
    if (changed) textNode.textContent = result;
  });
}

function formatNoteContent(text) {
  if (!text) return "";
  
  const temp = document.createElement('div');
  temp.innerHTML = text;

  // Walk through text nodes and convert URLs/Base64 to images
  const walker = document.createTreeWalker(temp, NodeFilter.SHOW_TEXT, null, false);
  let node;
  const toReplace = [];
  while (node = walker.nextNode()) {
    // Skip text nodes already inside an <img> tag (shouldn't happen) or other special tags
    if (node.parentNode.tagName === 'SCRIPT' || node.parentNode.tagName === 'STYLE') continue;
    
    const content = node.textContent;
    const imgRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)/gi;
    if (imgRegex.test(content)) {
      toReplace.push(node);
    }
  }

  toReplace.forEach(node => {
    const content = node.textContent;
    const imgRegex = /(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)/gi;
    const parts = content.split(imgRegex);
    const matches = content.match(imgRegex);
    
    const fragment = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (part) fragment.appendChild(document.createTextNode(part));
      if (matches && matches[i]) {
        const img = document.createElement('img');
        img.src = matches[i];
        fragment.appendChild(img);
      }
    });
    node.parentNode.replaceChild(fragment, node);
  });

  return temp.innerHTML;
}

async function handleNotePaste(e, container, onSave) {
  const items = e.clipboardData.items;
  let hasImage = false;
  
  // 1. Try to handle as binary image file first
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf("image") !== -1) {
      e.preventDefault();
      hasImage = true;
      const file = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target.result;
        insertImageAtCursor(base64, container);
        if (onSave) onSave();
      };
      reader.readAsDataURL(file);
    }
  }
  return hasImage;
}

function insertImageAtCursor(src, container) {
  const img = document.createElement('img');
  img.src = src;
  const selection = window.getSelection();
  if (selection.rangeCount) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.setEndAfter(img);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    container.appendChild(img);
  }
}

// Render math in a SINGLE card (not the whole list!) — prevents O(N²) re-rendering
function renderMathInCard(card) {
  if (!card) return;
  if (!window.katex) {
    // Retry once after 500ms if KaTeX wasn't loaded yet
    setTimeout(() => renderMathInCard(card), 500);
    return;
  }
  
  card.querySelectorAll('.math-tex').forEach(span => {
    if (span.querySelector('.katex')) return;
    let tex = span.textContent.trim();
    if (!tex) return;
    if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
    else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
    else if (tex.length > 4 && tex.charAt(0) === '\\' && tex.charAt(1) === '(' && tex.endsWith('\\)')) tex = tex.slice(2, -2);
    if (!tex) return;
    tex = sanitizeTex(tex);
    tex = normalizeLatex(tex);
    if (!tex) return;
    try {
      katex.render(tex, span, { throwOnError: false, displayMode: false });
    } catch (e) { console.warn('KaTeX render error:', e.message, 'for:', tex); }
  });

  wrapBareLatex(card);

  if (typeof renderMathInElement === 'function') {
    renderMathInElement(card, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
  }
}

// Legacy wrapper — still used by solution toggle and notes view
function renderMathInList(el) {
  renderMathInCard(el);
}

function buildCard(q, idx) {
  const card = document.createElement('div');
  card.className = 'q-card';

  // Header row
  const header = document.createElement('div');
  header.className = 'q-header';
  header.innerHTML = `<span class="q-num">Q${idx + 1}</span>`;
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-red btn-sm';
  delBtn.innerHTML = '✕';
  delBtn.title = 'Delete question';
  delBtn.onclick = () => {
    if (confirm('Are you sure you want to delete this question?')) {
      deleteQuestion(idx, card);
    }
  };
  header.appendChild(delBtn);
  card.appendChild(header);

  // Question body
  const body = document.createElement('div');
  body.className = 'q-body';
  body.innerHTML = q.questionHtml || '<em>No question text extracted.</em>';
  card.appendChild(body);

  // Options
  if (q.options && q.options.length > 0) {
    const optsGrid = document.createElement('div');
    optsGrid.className = 'q-opts';
    q.options.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = `q-opt ${opt.isCorrect ? 'correct' : ''}`;
      const color = opt.isCorrect ? '#16a34a' : (OPT_COLORS[i] || '#64748b');
      div.innerHTML = `<span class="opt-badge" style="background:${color}">${opt.label || String.fromCharCode(65+i)}</span><span>${opt.html || ''}</span>`;
      optsGrid.appendChild(div);
    });
    card.appendChild(optsGrid);
  }

  // Actions Container (Solution & Notes)
  const actionsContainer = document.createElement('div');
  actionsContainer.style.display = 'flex';
  actionsContainer.style.gap = '8px';
  actionsContainer.style.marginTop = '10px';
  actionsContainer.style.flexWrap = 'wrap';
  card.appendChild(actionsContainer);

  // Solution
  if (q.solutionHtml) {
    const solContainer = document.createElement('div');
    solContainer.style.width = '100%';
    
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn btn-outline btn-sm';
    toggleBtn.textContent = '👁 Show Solution';
    
    const sol = document.createElement('div');
    sol.className = 'q-solution';
    sol.style.display = 'none';
    sol.innerHTML = `<strong>📝 Solution</strong>${q.solutionHtml}`;
    
    toggleBtn.onclick = () => {
      if (sol.style.display === 'none') {
        sol.style.display = 'block';
        toggleBtn.textContent = '🙈 Hide Solution';
        toggleBtn.classList.replace('btn-outline', 'btn-slate');
        renderMathInList(sol);
      } else {
        sol.style.display = 'none';
        toggleBtn.textContent = '👁 Show Solution';
        toggleBtn.classList.replace('btn-slate', 'btn-outline');
      }
    };
    
    actionsContainer.appendChild(toggleBtn);
    card.appendChild(sol);
  }

  // Notes
  const notesContainer = document.createElement('div');
  notesContainer.className = 'q-notes-container';
  notesContainer.style.width = '100%';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-outline btn-sm btn-notes-view';
  viewBtn.innerHTML = `👁 View`;
  viewBtn.style.display = q.notes ? 'inline-flex' : 'none';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-outline btn-sm btn-notes';
  editBtn.innerHTML = `✏️ ${q.notes ? 'Edit' : 'Add'} Note`;

  const notesView = document.createElement('div');
  notesView.className = 'q-notes-view';
  notesView.innerHTML = `<strong>Mistake Note:</strong><div class="notes-content"></div>`;
  const notesContent = notesView.querySelector('.notes-content');
  notesContent.innerHTML = formatNoteContent(q.notes);

  const notesEditor = document.createElement('div');
  notesEditor.className = 'q-notes-editor';
  notesEditor.setAttribute('contenteditable', 'true');
  notesEditor.setAttribute('placeholder', 'What mistake did you make? Paste images or type notes (LaTeX supported)...');
  notesEditor.innerHTML = q.notes || '';

  const editFooter = document.createElement('div');
  editFooter.className = 'q-notes-edit-footer';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-blue btn-sm';
  saveBtn.textContent = '✅ Done';
  editFooter.appendChild(saveBtn);

  viewBtn.onclick = () => {
    const isVisible = notesView.style.display === 'block';
    notesView.style.display = isVisible ? 'none' : 'block';
    notesEditor.style.display = 'none';
    editFooter.style.display = 'none';
    viewBtn.classList.toggle('active', !isVisible);
    editBtn.classList.toggle('active', !!q.notes);
    if (!isVisible) {
      renderMathInList(notesContent);
    }
  };

  editBtn.onclick = () => {
    const isVisible = notesEditor.style.display === 'block';
    notesEditor.style.display = isVisible ? 'none' : 'block';
    editFooter.style.display = isVisible ? 'none' : 'flex';
    notesView.style.display = 'none';
    viewBtn.classList.remove('active');
    editBtn.classList.toggle('active', !isVisible || !!q.notes);
    if (!isVisible) {
      setTimeout(() => notesEditor.focus(), 10);
    }
  };

  saveBtn.onclick = () => {
    notesEditor.style.display = 'none';
    editFooter.style.display = 'none';
    if (q.notes) {
      notesView.style.display = 'block';
      viewBtn.classList.add('active');
      renderMathInList(notesContent);
    } else {
      viewBtn.style.display = 'none';
    }
    editBtn.classList.toggle('active', !!q.notes);
    notesContent.innerHTML = formatNoteContent(q.notes);
    viewBtn.style.display = q.notes ? 'inline-flex' : 'none';
  };

  const triggerSave = () => {
    q.notes = notesEditor.innerHTML;
    editBtn.innerHTML = `✏️ ${q.notes ? 'Edit' : 'Add'} Note`;
    notesContent.innerHTML = formatNoteContent(q.notes);
    renderMathInList(notesContent);
    viewBtn.style.display = q.notes ? 'inline-flex' : 'none';
    saveDb();
  };

  let saveTimeout;
  notesEditor.oninput = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(triggerSave, 500);
  };

  notesEditor.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    let containsImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) containsImage = true;
    }

    if (containsImage) {
      handleNotePaste(e, notesEditor, triggerSave);
    } else {
      // 2. For text/html paste, check if it's an image URL or Base64 code
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain').trim();
      const html = e.clipboardData.getData('text/html');
      const imgRegex = /^(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)$/i;
      
      if (imgRegex.test(text)) {
        // It's an image link/code, insert as image
        insertImageAtCursor(text, notesEditor);
      } else if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        
        // Extract KaTeX source
        tmp.querySelectorAll('.katex').forEach(el => {
          const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
          if (annotation) {
            el.replaceWith('\\(' + annotation.textContent + '\\)');
          } else {
            const mathml = el.querySelector('.katex-mathml');
            el.replaceWith(mathml ? mathml.textContent : el.textContent);
          }
        });
        
        // Extract MathJax/internal math-tex source
        if (typeof SavemockParser !== 'undefined' && SavemockParser.cleanMathJaxHtml) {
           tmp.innerHTML = SavemockParser.cleanMathJaxHtml(tmp.innerHTML);
           tmp.querySelectorAll('.math-tex').forEach(span => {
               span.replaceWith('\\(' + span.textContent + '\\)');
           });
        }
        
        // Sanitize styles to avoid pasting site layout garbage, but keep spacing/classes/tabs
        tmp.querySelectorAll('*').forEach(el => {
           if (el.tagName !== 'IMG' && el.tagName !== 'A') {
              if (el.style) {
                 el.style.fontFamily = '';
                 el.style.fontSize = '';
                 el.style.color = '';
                 el.style.backgroundColor = '';
                 el.style.background = '';
                 el.style.position = '';
              }
           }
        });
        
        // Remove structural HTML whitespace (newlines between tags) to prevent pre-wrap gaps
        // We only match newlines \r\n to ensure we don't accidentally delete tabs (\t) or non-breaking spaces
        let sanitizedHtml = tmp.innerHTML;
        sanitizedHtml = sanitizedHtml.replace(/>[\r\n]+\s*</g, '><');
        
        document.execCommand('insertHTML', false, sanitizedHtml || text);
      } else {
        // Standard text
        document.execCommand('insertText', false, text);
      }
      triggerSave();
    }
  });

  actionsContainer.appendChild(viewBtn);
  actionsContainer.appendChild(editBtn);
  card.appendChild(notesView);
  card.appendChild(notesEditor);
  card.appendChild(editFooter);

  return card;
}

// ─── Actions ─────────────────────────────────────────────────────────────────
async function addSubject() {
  const name = prompt("Enter new section name:");
  if (!name || name.trim() === "") return;
  const cleanName = name.trim();
  if (SUBJECTS.includes(cleanName)) {
    toast("Section already exists");
    return;
  }
  
  SUBJECTS.push(cleanName);
  db[cleanName] = [];
  try {
    await chrome.storage.local.set({ savemockSubjects: SUBJECTS });
    await setFullDb(db);
    currentSubject = cleanName;
    render();
    toast(`✅ Added section: ${cleanName}`);
  } catch (e) {
    toast("❌ Error adding section");
  }
}

async function renameSubject(oldName) {
  const newName = prompt(`Rename section "${oldName}" to:`, oldName);
  if (!newName || newName.trim() === "" || newName.trim() === oldName) return;
  const cleanNewName = newName.trim();
  
  if (SUBJECTS.includes(cleanNewName)) {
    toast("Section name already exists");
    return;
  }
  
  const idx = SUBJECTS.indexOf(oldName);
  if (idx === -1) return;
  
  SUBJECTS[idx] = cleanNewName;
  db[cleanNewName] = db[oldName] || [];
  delete db[oldName];
  
  if (currentSubject === oldName) currentSubject = cleanNewName;
  
  try {
    await chrome.storage.local.set({ savemockSubjects: SUBJECTS });
    await setFullDb(db);
    render();
    toast("✅ Section renamed");
  } catch (e) {
    toast("❌ Error renaming section");
  }
}

async function sortSubject() {
  if (!db[currentSubject] || db[currentSubject].length === 0) return;
  
  // Physically reverse the array. Since the array order dictates
  // both the UI render and the HTML export, reversing it handles both!
  db[currentSubject].reverse();
  
  try {
    await setFullDb(db);
    render();
    toast("✅ Order reversed!");
  } catch (e) {
    toast("❌ Error reversing order");
  }
}

async function deleteSubject(name) {
  const count = (db[name] || []).length;
  if (!confirm(`Are you sure you want to delete the section "${name}" and all its ${count} questions?`)) return;
  
  const idx = SUBJECTS.indexOf(name);
  if (idx === -1) return;
  
  SUBJECTS.splice(idx, 1);
  delete db[name];
  
  if (currentSubject === name) {
    currentSubject = SUBJECTS[0] || "";
  }
  
  try {
    await chrome.storage.local.set({ savemockSubjects: SUBJECTS });
    await setFullDb(db);
    render();
    toast("✅ Section deleted");
  } catch (e) {
    toast("❌ Error deleting section");
  }
}

function deleteQuestion(idx, cardEl) {
  // ── Instant optimistic UI: fade & collapse the card immediately ──────────
  if (cardEl) {
    cardEl.style.transition = 'opacity 0.18s ease, transform 0.18s ease, margin 0.18s ease, padding 0.18s ease, max-height 0.22s ease';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.97)';
    cardEl.style.maxHeight = cardEl.offsetHeight + 'px';
    setTimeout(() => {
      cardEl.style.maxHeight = '0';
      cardEl.style.marginBottom = '0';
      cardEl.style.padding = '0';
      cardEl.style.overflow = 'hidden';
    }, 150);
    setTimeout(() => cardEl.remove(), 380);
  }

  // ── Update in-memory db and sidebar count immediately ──────────────────
  db[currentSubject].splice(idx, 1);
  renderSidebar();

  // ── Persist to storage in the background ────────────────────────────
  lastLocalSave = Date.now();
  setFullDb(db).catch(err => {
    console.error('Delete save failed:', err);
    toast('❌ Failed to save deletion');
  });
}

window.deleteQuestion = deleteQuestion;

function clearSubject() {
  if (!confirm(`Clear all ${db[currentSubject].length} question(s) in ${currentSubject}?`)) return;
  db[currentSubject] = [];
  saveDb(() => render());
}

async function saveDb(cb) {
  lastLocalSave = Date.now();
  try {
    await setFullDb(db);
    // Update lastLocalSave again after write completes to extend the guard window
    lastLocalSave = Date.now();
    if (cb) cb();
  } catch (e) {
    console.error('Savemock save error:', e);
    toast('❌ Error saving data');
  }
}

// ─── History View ────────────────────────────────────────────────────────────
function renderHistoryView() {
  const title = document.getElementById('subject-title');
  const list  = document.getElementById('questions-list');
  const clearBtn = document.getElementById('btn-clear-subject');
  const sortBtn = document.getElementById('btn-sort');
  const takeTestBtn = document.getElementById('btn-take-test');

  // Deactivate all sidebar nav buttons
  document.querySelectorAll('#sidebar-nav .nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-view-history').classList.add('active');

  currentSubject = null; // Denotes we are in a special view
  title.textContent = "Test History";
  if (clearBtn) clearBtn.style.display = 'none';
  if (sortBtn) sortBtn.style.display = 'none';
  if (takeTestBtn) takeTestBtn.style.display = 'none';

  chrome.storage.local.get(['savemockHistory'], (res) => {
    const history = res.savemockHistory || [];
    if (history.length === 0) {
      list.innerHTML = `<div class="empty-state">
        <div class="icon">📊</div>
        <p>No tests taken yet.</p>
      </div>`;
      return;
    }

    list.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    // Clear history button
    const clearHistBtn = document.createElement('button');
    clearHistBtn.className = 'btn btn-red btn-sm';
    clearHistBtn.style.marginBottom = '20px';
    clearHistBtn.textContent = '🗑 Clear All History';
    clearHistBtn.onclick = () => {
      if (confirm('Delete all test history?')) {
        chrome.storage.local.set({ savemockHistory: [] }, renderHistoryView);
      }
    };
    fragment.appendChild(clearHistBtn);

    history.forEach((h, index) => {
      const card = document.createElement('div');
      card.className = 'q-card';
      card.style.cursor = 'pointer';
      
      const date = new Date(h.date).toLocaleString();
      const total = h.stats.correct + h.stats.wrong + h.stats.skipped;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:700; font-size:16px; margin-bottom:4px; color:var(--text-main);">${h.subject} - ${h.mode === 'real' ? 'Real Test' : 'Practice'}</div>
                <div style="font-size:13px; color:var(--text-muted);">${date} • ${total} Questions</div>
            </div>
            <div style="display:flex; gap:12px; font-size:14px; font-weight:600; align-items:center;">
                <span style="color:#16a34a;">✅ ${h.stats.correct}</span>
                <span style="color:#dc2626;">❌ ${h.stats.wrong}</span>
                <span style="color:#64748b;">➖ ${h.stats.skipped}</span>
                <button class="action-btn del" title="Delete this record" style="position:relative; z-index:2; margin-left:16px;">✕</button>
            </div>
        </div>
      `;

      card.onclick = (e) => {
         if (e.target.classList.contains('del')) {
             if (confirm('Delete this record?')) {
                 history.splice(index, 1);
                 chrome.storage.local.set({ savemockHistory: history }, renderHistoryView);
             }
             return;
         }
         window.open(`test.html?historyId=${h.id}`, '_blank');
      };

      fragment.appendChild(card);
    });

    list.appendChild(fragment);
  });
}

function exportHtml() {
  if (typeof SavemockParser === 'undefined') { toast('❌ Parser not loaded'); return; }
  const qs = db[currentSubject] || [];
  if (qs.length === 0) { toast(`No questions to export for ${currentSubject}`); return; }
  
  const rangeInput = prompt(`Export questions from ${currentSubject}. \nEnter range (e.g. 1-${qs.length}):`, `1-${qs.length}`);
  if (rangeInput === null) return; // User cancelled

  let [start, end] = rangeInput.split('-').map(s => parseInt(s.trim()));
  if (isNaN(start) || isNaN(end) || start < 1 || end < start) {
    toast('❌ Invalid range format. Use Start-End (e.g. 1-20)');
    return;
  }

  const exportQs = qs.slice(start - 1, end);
  if (exportQs.length === 0) {
    toast('❌ No questions found in that range');
    return;
  }

  const includeSols = document.getElementById('chk-include-solutions')?.checked ?? true;
  
  const html = SavemockParser.generateDownloadHtml(exportQs, currentSubject, { includeSolutions: includeSols });
  downloadFile(html, `savemock-${currentSubject.toLowerCase()}-export.html`, 'text/html');
  toast(`✅ ${exportQs.length} questions exported!`);
}

function backupJson() {
  const total = SUBJECTS.reduce((s, sub) => s + (db[sub] || []).length, 0);
  if (total === 0) { toast('No questions to backup'); return; }
  downloadFile(JSON.stringify(db, null, 2), 'savemock-backup.json', 'application/json');
  toast('✅ Backup saved!');
}

function restoreJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (parsed && typeof parsed === 'object') {
        SUBJECTS.forEach(sub => {
          if (parsed[sub] && Array.isArray(parsed[sub])) {
            const existing = db[sub] || [];
            const newOnes = parsed[sub].filter(q => {
              return !existing.some(ex => {
                if (ex.questionHtml !== q.questionHtml) return false;
                const exOpts = ex.options || [];
                const qOpts = q.options || [];
                if (exOpts.length !== qOpts.length) return false;
                return qOpts.every((opt, i) => opt.html === exOpts[i].html);
              });
            });

            if (newOnes.length > 0) {
              const offset = existing.length;
              const reindexed = newOnes.map((q, i) => ({ ...q, id: offset + i + 1 }));
              db[sub] = [...reindexed, ...existing];
            }
          }
        });
        saveDb(() => { render(); toast('✅ Backup restored and merged!'); });
      }
    } catch (err) { toast('❌ Invalid backup file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  const darkBtn = document.getElementById('btn-toggle-dark');
  if (darkBtn) darkBtn.textContent = isDark ? '☀️' : '🌙';
  chrome.storage.local.set({ darkMode: isDark });
}

document.addEventListener('DOMContentLoaded', init);
