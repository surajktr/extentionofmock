let SUBJECTS = ["Math", "English", "GK/GS", "Reasoning"];
const OPT_COLORS = ["#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed", "#0891b2"];

let db = { Math: [], English: [], "GK/GS": [], Reasoning: [] };
let currentSubject = "Math";
let lastLocalSave = 0;
let currentPage = 1;
const PAGE_SIZE = 25;

// ─── Fingerprint helpers (must match content.js) ─────────────────────────────
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
function rebuildFPIndex() {
  const fpIndex = {};
  Object.keys(db).forEach(subject => {
    if (Array.isArray(db[subject])) {
      fpIndex[subject] = db[subject].map(q => questionFingerprint(q));
    }
  });
  return fpIndex;
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
  loadData(render);

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

  const exportBtn = document.getElementById('btn-export');
  if (exportBtn) exportBtn.addEventListener('click', exportHtml);

  const exportMcqBtn = document.getElementById('btn-export-mcq');
  if (exportMcqBtn) exportMcqBtn.addEventListener('click', exportMcqJson);

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

  chrome.storage.onChanged.addListener((changes) => {
    // If we just saved locally, ignore the subsequent onChanged event to prevent UI flicker/re-render
    if (Date.now() - lastLocalSave < 1000) return;

    if (changes.savemockSubjects) {
      // Subject list changed externally — need a full reload
      loadData(render);
      return;
    }
    // We intentionally ignore changes.savemockQuestions here to avoid heavy JSON parsing.
    // Dashboard updates are handled via the NEW_QUESTION_SAVED message below.
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEW_QUESTION_SAVED") {
      const { subject, actualNew } = msg;
      if (!actualNew || actualNew.length === 0) return;
      
      // Update in-memory DB incrementally
      if (!db[subject]) db[subject] = [];
      db[subject] = [...actualNew, ...db[subject]];
      
      // Update sidebar counts
      renderSidebar();
      
      // Incremental DOM update if we are on the affected subject and page 1
      if (currentSubject === subject && currentPage === 1) {
        const title = document.getElementById('subject-title');
        const qs = db[currentSubject] || [];
        if (title) title.textContent = `${currentSubject} — ${qs.length} question${qs.length !== 1 ? 's' : ''}`;
        
        const list = document.getElementById('questions-list');
        const emptyState = list.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        
        // Prepend new cards
        for (let i = actualNew.length - 1; i >= 0; i--) {
          const card = buildCard(actualNew[i], i);
          list.insertBefore(card, list.firstChild);
          renderMathInList(card);
        }
        
        // Re-number all visible cards on page 1
        const cards = list.querySelectorAll('.q-card');
        cards.forEach((c, idx) => {
          const numSpan = c.querySelector('.q-num');
          if (numSpan) numSpan.textContent = `Q${idx + 1}`;
        });
        
        // Remove excess cards beyond PAGE_SIZE
        while (list.children.length > PAGE_SIZE) {
          list.lastChild.remove();
        }
        
        renderPaginationControls(qs.length);
      }
    }
  });

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
    
    if (cb) cb();
  } catch (e) {
    console.error('Savemock load error:', e);
    db = {};
    if (cb) cb();
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────
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
      currentPage = 1;
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
  title.textContent = `${currentSubject} — ${qs.length} question${qs.length !== 1 ? 's' : ''}`;
  clearBtn.style.display = qs.length > 0 ? 'inline-flex' : 'none';
  if (sortBtn) sortBtn.style.display = qs.length > 1 ? 'inline-flex' : 'none';

  if (qs.length === 0) {
    const subText = currentSubject ? `<strong>${currentSubject}</strong>` : "any subject";
    list.innerHTML = `<div class="empty-state">
      <div class="icon">📋</div>
      <p>No questions saved for ${subText} yet.</p>
      <p style="margin-top:8px;font-size:13px;">Go to any mock exam site, select the subject in the floating panel, then click <strong>Copy HTML</strong>.</p>
    </div>`;
    return;
  }

  const totalPages = Math.ceil(qs.length / PAGE_SIZE);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageQs = qs.slice(start, end);

  list.innerHTML = '';
  pageQs.forEach((q, idx) => {
    list.appendChild(buildCard(q, start + idx));
  });

  renderPaginationControls(qs.length);

  // Render math after a short delay to ensure KaTeX is fully loaded
  renderMathInList(list);
}

function renderPaginationControls(totalItems) {
  const container = document.getElementById('pagination-container');
  if (!container) return;
  
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="pagination-controls">
      <button class="btn btn-outline btn-sm" ${currentPage === 1 ? 'disabled' : ''} id="btn-prev-page">← Previous</button>
      <span class="page-info">Page <strong>${currentPage}</strong> of <strong>${totalPages}</strong></span>
      <button class="btn btn-outline btn-sm" ${currentPage === totalPages ? 'disabled' : ''} id="btn-next-page">Next →</button>
    </div>
  `;

  const prevBtn = container.querySelector('#btn-prev-page');
  const nextBtn = container.querySelector('#btn-next-page');

  if (prevBtn) prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      render();
      document.querySelector('.main').scrollTop = 0;
    }
  };

  if (nextBtn) nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      render();
      document.querySelector('.main').scrollTop = 0;
    }
  };
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

function renderMathInList(list) {
  // Direct render for .math-tex spans
  if (window.katex) {
    list.querySelectorAll('.math-tex').forEach(span => {
      // Skip if already rendered by KaTeX
      if (span.querySelector('.katex')) return;
      let tex = span.textContent.trim();
      if (!tex) return;
      // Strip any leftover delimiters from old saved data
      if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
      else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
      else if (tex.length > 4 && tex.charAt(0) === '\\' && tex.charAt(1) === '(' && tex.endsWith('\\)')) tex = tex.slice(2, -2);
      if (!tex) return;
      // Sanitize broken LaTeX from old saved data
      tex = sanitizeTex(tex);
      tex = normalizeLatex(tex);
      if (!tex) return;
      try {
        katex.render(tex, span, { throwOnError: false, displayMode: false });
      } catch (e) { console.warn('KaTeX render error:', e.message, 'for:', tex); }
    });
  }

  // Wrap bare LaTeX (\frac, \sqrt) in delimiters before auto-render
  wrapBareLatex(list);

  // Also run auto-render for inline math text not in .math-tex spans
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(list, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
  }

  // Retry once after 500ms if KaTeX wasn't loaded yet
  if (!window.katex) {
    setTimeout(() => renderMathInList(list), 500);
  }
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
      // For text/html paste
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain').trim();
      const html = e.clipboardData.getData('text/html');
      const imgRegex = /^(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s]*)?|data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+)$/i;

      if (imgRegex.test(text)) {
        insertImageAtCursor(text, notesEditor);
      } else if (html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        // ── PHASE 1: DOM-based KaTeX extraction ──
        // Process .katex-display first (contains .katex children)
        tmp.querySelectorAll('.katex-display').forEach(el => {
          const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
          if (annotation) {
            const latex = annotation.textContent.trim();
            el.replaceWith('\\[' + latex + '\\]');
          } else {
            el.remove();
          }
        });

        // Process remaining inline .katex
        tmp.querySelectorAll('.katex').forEach(el => {
          const annotation = el.querySelector('annotation[encoding="application/x-tex"]');
          if (annotation) {
            const latex = annotation.textContent.trim();
            el.replaceWith('\\(' + latex + '\\)');
          } else {
            el.remove();
          }
        });

        // Remove any leftover KaTeX/MathML artifacts
        tmp.querySelectorAll('.katex-mathml, .katex-html, math, annotation').forEach(el => el.remove());

        // MathJax cleanup
        if (typeof SavemockParser !== 'undefined' && SavemockParser.cleanMathJaxHtml) {
           tmp.innerHTML = SavemockParser.cleanMathJaxHtml(tmp.innerHTML);
           tmp.querySelectorAll('.math-tex').forEach(span => {
               span.replaceWith('\\(' + span.textContent + '\\)');
           });
        }

        // Sanitize styles
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

        let sanitizedHtml = tmp.innerHTML;
        sanitizedHtml = sanitizedHtml.replace(/>[\r\n]+\s*</g, '><');

        // ── PHASE 2: Robust Deduplication ──
        // Some sites (like ChatGPT) put raw LaTeX text adjacent to the rendered .katex elements.
        // Since we extracted the LaTeX from .katex, we end up with duplicates: \(\frac{1}{2}\) \frac{1}{2}.
        let prev;
        do {
            prev = sanitizedHtml;

            // 1. Remove duplicate bare text AFTER the formula: \( X \) X -> \( X \)
            sanitizedHtml = sanitizedHtml.replace(/(\\\(\s*(.*?)\s*\\\))\s*\2/g, '$1');
            sanitizedHtml = sanitizedHtml.replace(/(\\\[\s*(.*?)\s*\\\])\s*\2/g, '$1');

            // 2. Remove duplicate bare text BEFORE the formula: X \( X \) -> \( X \)
            sanitizedHtml = sanitizedHtml.replace(/([\s\S]*?)\\\(\s*(.*?)\s*\\\)/g, (match, prefix, inner) => {
                if (inner && prefix.trim().endsWith(inner.trim())) {
                    const idx = prefix.lastIndexOf(inner.trim());
                    if (idx !== -1) return prefix.substring(0, idx) + '\\(' + inner + '\\)';
                }
                return match;
            });
            sanitizedHtml = sanitizedHtml.replace(/([\s\S]*?)\\\[\s*(.*?)\s*\\\]/g, (match, prefix, inner) => {
                if (inner && prefix.trim().endsWith(inner.trim())) {
                    const idx = prefix.lastIndexOf(inner.trim());
                    if (idx !== -1) return prefix.substring(0, idx) + '\\[' + inner + '\\]';
                }
                return match;
            });

            // 3. Deduplicate consecutive identical wrapped formulas: \( X \) \( X \) -> \( X \)
            sanitizedHtml = sanitizedHtml.replace(/(\\\(\s*(.*?)\s*\\\))\s*\\\(\s*\2\s*\\\)/g, '$1');
            sanitizedHtml = sanitizedHtml.replace(/(\\\[\s*(.*?)\s*\\\])\s*\\\[\s*\2\s*\\\]/g, '$1');

            // 4. Clean up any stray delimiters caused by partial matches
            sanitizedHtml = sanitizedHtml.replace(/\\\(\s*\\\(/g, '\\(');
            sanitizedHtml = sanitizedHtml.replace(/\\\)\s*\\\)/g, '\\)');

        } while (sanitizedHtml !== prev);

        document.execCommand('insertHTML', false, sanitizedHtml || text);
        setTimeout(() => renderMathInList(notesEditor), 0);
      } else {
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
    currentPage = 1;
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
    currentPage = 1;
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
    const fpIndex = rebuildFPIndex();
    await setFullDb(db);
    await chrome.storage.local.set({ savemockFPIndex: fpIndex });
    currentPage = 1;
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
    currentPage = 1;
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
    // Let the opacity transition play, then collapse height
    setTimeout(() => {
      cardEl.style.maxHeight = '0';
      cardEl.style.marginBottom = '0';
      cardEl.style.padding = '0';
      cardEl.style.overflow = 'hidden';
    }, 150);
    // Remove from DOM after animation finishes
    setTimeout(() => cardEl.remove(), 380);
  }

  // ── Update in-memory db and renumber the sidebar count immediately ────────
  db[currentSubject].splice(idx, 1);
  renderSidebar(); // update count badge (cheap)

  // ── Persist to storage in the background — no re-render needed ───────────
  lastLocalSave = Date.now();
  const fpIndex = rebuildFPIndex();
  setFullDb(db).then(() => {
    return chrome.storage.local.set({ savemockFPIndex: fpIndex });
  }).catch(err => {
    console.error('Delete save failed:', err);
    toast('❌ Failed to save deletion');
  });
}

window.deleteQuestion = deleteQuestion;

function clearSubject() {
  if (!confirm(`Clear all ${db[currentSubject].length} question(s) in ${currentSubject}?`)) return;
  db[currentSubject] = [];
  saveDb(() => {
    currentPage = 1;
    render();
  });
}

async function saveDb(cb) {
  lastLocalSave = Date.now();
  try {
    // Rebuild fingerprint index so content.js duplicate detection stays in sync
    const fpIndex = rebuildFPIndex();
    await setFullDb(db);
    await chrome.storage.local.set({ savemockFPIndex: fpIndex });
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

function extractQuestionData(q) {
  const temp = document.createElement("div");
  temp.innerHTML = q.questionHtml || "";
  
  // Extract first image src
  const imgEl = temp.querySelector("img");
  const image = imgEl ? imgEl.src : null;
  
  // Remove all images so they don't clutter question text
  temp.querySelectorAll("img").forEach(img => img.remove());
  
  // Convert <sup> and <sub> elements to standard LaTeX exponents and indices so squares and cubes are fully preserved
  temp.querySelectorAll("sup").forEach(sup => {
    sup.textContent = `^{${sup.textContent}}`;
  });
  temp.querySelectorAll("sub").forEach(sub => {
    sub.textContent = `_{${sub.textContent}}`;
  });
  
  // Strip leading question numbers (e.g. Q1., Q2., 1., 2.)
  let cleanedHtml = stripLeadingNumber(temp.innerHTML);
  const tempCleaned = document.createElement("div");
  tempCleaned.innerHTML = cleanedHtml;
  
  let questionText = tempCleaned.textContent || "";
  questionText = questionText.replace(/\s+/g, ' ').trim();
  
  // Process options: convert each to plain text, strip leading number, strip options' images if any
  const optionsText = (q.options || []).map(opt => {
    let optHtml = stripLeadingNumber(opt.html || "");
    const optTemp = document.createElement("div");
    optTemp.innerHTML = optHtml;
    optTemp.querySelectorAll("img").forEach(img => img.remove());
    
    // Convert <sup> and <sub> inside options to preserve math equations correctly
    optTemp.querySelectorAll("sup").forEach(sup => {
      sup.textContent = `^{${sup.textContent}}`;
    });
    optTemp.querySelectorAll("sub").forEach(sub => {
      sub.textContent = `_{${sub.textContent}}`;
    });
    
    let optText = optTemp.textContent || "";
    return optText.replace(/\s+/g, ' ').trim();
  });
  
  return {
    question: questionText,
    options: optionsText,
    image: image
  };
}

function exportMcqJson() {
  const qs = db[currentSubject] || [];
  if (qs.length === 0) { toast(`No questions to export for ${currentSubject}`); return; }
  
  const countInput = document.getElementById('export-mcq-count');
  let count = countInput ? parseInt(countInput.value) : 20;
  if (isNaN(count) || count < 1) count = 20;
  if (count > 100) count = 100;
  
  // Grab up to 'count' items from the subject
  const exportQs = qs.slice(0, count).map(q => extractQuestionData(q));
  
  const jsonStr = JSON.stringify(exportQs, null, 2);
  downloadFile(jsonStr, `savemock-${currentSubject.toLowerCase()}-mcq.json`, 'application/json');
  toast(`✅ ${exportQs.length} MCQ questions exported for Whiteboard!`);
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
              db[sub] = [...existing, ...reindexed];
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
