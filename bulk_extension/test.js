// test.js
const urlParams = new URLSearchParams(window.location.search);
const historyId = urlParams.get('historyId');
let subject = urlParams.get('subject') || 'Subject';
let mode = urlParams.get('mode') || 'real'; // 'real' | 'practice'

let allQuestions = [];
let questions = [];
let currentIndex = 0;
let timerSeconds = 0;
let timerInterval = null;
let isPaused = false;
let sidebarOpen = true;
let isSubmitted = false;
let qTimeSec = 0;
let qTimeInterval = null;
let zoomLevel = 1;
let solZoomLevel = 1;

const STATUS = {
    NOT_VISITED: 'not-visited',
    NOT_ANSWERED: 'not-answered',
    ANSWERED: 'answered',
    MARKED: 'marked',
    MARKED_ANSWERED: 'marked-answered'
};

const el = {
    headerTitle: document.getElementById('headerTitle'),
    sectionName: document.getElementById('sectionName'),
    sidebarSection: document.getElementById('sidebarSection'),
    modeBadge: document.getElementById('modeBadge'),
    qHeader: document.getElementById('questionNumberHeader'),
    qText: document.getElementById('questionText'),
    optsCont: document.getElementById('optionsContainer'),
    palCont: document.getElementById('paletteContainer'),
    solPanel: document.getElementById('solutionPanel'),
    solContent: document.getElementById('solutionContent'),
    notesPanel: document.getElementById('notesPanel'),
    notesContent: document.getElementById('notesContent'),
    sidebar: document.getElementById('sidebar'),
    sidebarWrap: document.getElementById('sidebarToggleWrapper'),
    tIconBtn: document.getElementById('toggleIconBtn'),
    tIcon: document.getElementById('toggleIcon'),
    tHours: document.getElementById('timer-hours'),
    tMins: document.getElementById('timer-minutes'),
    tSecs: document.getElementById('timer-seconds'),
    qTime: document.getElementById('questionTime'),
    pauseOverlay: document.getElementById('pauseOverlay'),
    rangeModal: document.getElementById('rangeModal'),
    rangeFrom: document.getElementById('rangeFrom'),
    rangeTo: document.getElementById('rangeTo'),
    rangeDesc: document.getElementById('rangeDesc'),
    rangeError: document.getElementById('rangeError'),
    btnSubmit: document.getElementById('btn-submit'),
    contentArea: document.getElementById('contentArea'),

    // Solutions View
    liveTestView: document.getElementById('live-test-view'),
    solutionView: document.getElementById('solution-view'),
    solQHeader: document.getElementById('sol-q-header'),
    solQStatus: document.getElementById('sol-q-status'),
    solQText: document.getElementById('sol-question-text'),
    solOptsCont: document.getElementById('sol-options-container'),
    solSolutionBox: document.getElementById('sol-solution-box'),
    solSolutionContent: document.getElementById('sol-solution-content'),
    solTabs: document.getElementById('sol-tabs'),
    btnTabSol: document.getElementById('btn-tab-sol'),
    btnTabNotes: document.getElementById('btn-tab-notes'),
    solPalette: document.getElementById('sol-palette-container'),
    solSidebarSec: document.getElementById('sol-sidebarSection'),
    solContentArea: document.getElementById('sol-content-area'),
    statCorrect: document.getElementById('stat-correct'),
    statWrong: document.getElementById('stat-wrong'),
    statSkipped: document.getElementById('stat-skipped'),
    btnSolPrev: document.getElementById('btn-sol-prev'),
    btnSolNext: document.getElementById('btn-sol-next'),
};

el.sectionName.textContent = subject;
el.sidebarSection.textContent = subject;
el.solSidebarSec.textContent = subject;
el.headerTitle.textContent = subject + ' — Live Test';

if (mode === 'real') {
    el.modeBadge.textContent = 'Real Test';
    el.modeBadge.className = 'mode-badge mode-real';
} else {
    el.modeBadge.textContent = 'Practice';
    el.modeBadge.className = 'mode-badge mode-practice';
}

if (historyId) {
    chrome.storage.local.get(['savemockHistory'], (res) => {
        const history = res.savemockHistory || [];
        const record = history.find(h => h.id === historyId);
        if (!record) {
            alert('Test history not found!');
            window.location.href = 'dashboard.html';
            return;
        }

        subject = record.subject;
        mode = record.mode;
        questions = record.questions;
        allQuestions = questions;
        
        el.sectionName.textContent = subject;
        el.sidebarSection.textContent = subject;
        el.solSidebarSec.textContent = subject;
        el.headerTitle.textContent = subject + ' — Review';
        
        if (mode === 'real') {
            el.modeBadge.textContent = 'Real Test';
            el.modeBadge.className = 'mode-badge mode-real';
        } else {
            el.modeBadge.textContent = 'Practice';
            el.modeBadge.className = 'mode-badge mode-practice';
        }
        
        isSubmitted = true;
        el.rangeModal.style.display = 'none';
        el.liveTestView.style.display = 'none';
        el.solutionView.style.display = 'flex';
        
        el.statCorrect.textContent = record.stats.correct;
        el.statWrong.textContent = record.stats.wrong;
        el.statSkipped.textContent = record.stats.skipped;
        
        currentIndex = 0;
        renderSolutionQuestion();
        renderSolutionPalette();
    });
} else {
    getFullDb([subject]).then((db) => {
        const rawQs = db[subject] || [];

        if (rawQs.length === 0) {
            alert('No questions found for this subject!');
            window.close();
            return;
        }

        allQuestions = rawQs;
        const total = allQuestions.length;

        el.rangeFrom.value = 1;
        el.rangeTo.value = total;
        el.rangeFrom.max = total;
        el.rangeTo.max = total;
        el.rangeDesc.textContent = `This subject has ${total} question${total !== 1 ? 's' : ''}. By default all are included.`;

        const testModeEl = document.getElementById('testMode');
        if (testModeEl) testModeEl.value = mode;

        document.getElementById('btn-start-test').addEventListener('click', startTest);
        el.rangeModal.style.display = 'flex';
    });
}

function startTest() {
    const total = allQuestions.length;
    const from = parseInt(el.rangeFrom.value, 10);
    const to = parseInt(el.rangeTo.value, 10);

    el.rangeError.textContent = '';

    if (isNaN(from) || isNaN(to) || from < 1 || to > total || from > to) {
        el.rangeError.textContent = `Please enter a valid range between 1 and ${total} (From ≤ To).`;
        return;
    }

    const testModeEl = document.getElementById('testMode');
    if (testModeEl) {
        mode = testModeEl.value;
        if (mode === 'real') {
            el.modeBadge.textContent = 'Real Test';
            el.modeBadge.className = 'mode-badge mode-real';
        } else {
            el.modeBadge.textContent = 'Practice';
            el.modeBadge.className = 'mode-badge mode-practice';
        }
    }

    const slice = allQuestions.slice(from - 1, to);
    questions = slice.map((q, i) => ({
        id: from + i,
        textHtml: (typeof decodeMathJax !== 'undefined') ? decodeMathJax(q.questionHtml || '') : (q.questionHtml || ''),
        options: q.options || [],
        solutionHtml: (typeof decodeMathJax !== 'undefined') ? decodeMathJax(q.solutionHtml || '') : (q.solutionHtml || ''),
        notesHtml: (typeof decodeMathJax !== 'undefined') ? decodeMathJax(q.notes || '') : (q.notes || ''),
        status: STATUS.NOT_VISITED,
        selectedOption: null,
        timeSpent: 0
    }));

    // Decode math for options too
    questions.forEach(q => {
        q.options.forEach(opt => {
            if (typeof decodeMathJax !== 'undefined' && opt.html) {
                opt.html = decodeMathJax(opt.html);
            }
        });
    });

    timerSeconds = questions.length * 90;

    el.rangeModal.style.display = 'none';

    if (mode === 'practice') {
        const timerBlock = document.querySelector('.timer-block');
        if (timerBlock) timerBlock.style.display = 'none';
        if (el.btnSubmit) el.btnSubmit.style.display = 'none';
        const pauseBtn = document.getElementById('btn-pause-header');
        if (pauseBtn) pauseBtn.style.display = 'none';
    }

    renderCurrentQuestion();
    renderPalette();
    startTimer();
    startQTimer();
}

function renderMathIn(container) {
    if (!container) return;
    if (window.katex) {
        container.querySelectorAll('.math-tex').forEach(span => {
            if (span.querySelector('.katex')) return;
            let tex = span.textContent.trim();
            if (!tex) return;
            if (tex.startsWith('$$') && tex.endsWith('$$')) tex = tex.slice(2, -2);
            else if (tex.startsWith('$') && tex.endsWith('$')) tex = tex.slice(1, -1);
            else if (tex.startsWith('\\(') && tex.endsWith('\\)')) tex = tex.slice(2, -2);
            else if (tex.startsWith('\\[') && tex.endsWith('\\]')) tex = tex.slice(2, -2);
            try { katex.render(tex, span, { throwOnError: false }); } catch (_) { }
        });
    }
    if (typeof renderMathInElement === 'function') {
        renderMathInElement(container, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false }
            ],
            throwOnError: false
        });
    }
}

function renderCurrentQuestion() {
    if (isSubmitted) {
        renderSolutionQuestion();
        return;
    }

    const q = questions[currentIndex];
    el.qHeader.textContent = `Question No. ${q.id}`;
    el.qText.innerHTML = q.textHtml || '<em>No question text.</em>';
    renderMathIn(el.qText);

    el.optsCont.innerHTML = '';
    const showAnswer = (mode === 'practice' && q.selectedOption !== null);

    q.options.forEach((opt, idx) => {
        const isChecked = q.selectedOption === idx;
        const isCorrect = !!opt.isCorrect;

        const label = document.createElement('label');
        label.className = 'custom-radio';

        let revealClass = '';
        if (showAnswer) {
            if (isCorrect) revealClass = 'opt-correct';
            else if (isChecked) revealClass = 'opt-wrong';
        }
        if (revealClass) label.classList.add(revealClass);

        label.innerHTML =
            `<input type="radio" name="current_options" value="${idx}" ${isChecked ? 'checked' : ''} ${showAnswer ? 'disabled' : ''}>` +
            `<span class="radio-mark"></span>` +
            `<span class="opt-text">${opt.html || ''}</span>`;

        label.querySelector('input').addEventListener('change', () => handleOptionSelect(idx));
        el.optsCont.appendChild(label);
        renderMathIn(label);
    });

    if (showAnswer) {
        el.solPanel.style.display = q.solutionHtml ? 'block' : 'none';
        el.solContent.innerHTML = q.solutionHtml || '';
        renderMathIn(el.solContent);

        el.notesPanel.style.display = q.notesHtml ? 'block' : 'none';
        el.notesContent.innerHTML = q.notesHtml || '';
        renderMathIn(el.notesContent);
    } else {
        el.solPanel.style.display = 'none';
        el.notesPanel.style.display = 'none';
    }
}

function handleOptionSelect(idx) {
    if (isSubmitted) return;
    questions[currentIndex].selectedOption = idx;
    if (mode === 'practice') {
        questions[currentIndex].status = STATUS.ANSWERED;
        renderCurrentQuestion();
        renderPalette();
    }
}

function renderPalette() {
    el.palCont.innerHTML = '';
    const counts = { [STATUS.NOT_VISITED]: 0, [STATUS.NOT_ANSWERED]: 0, [STATUS.ANSWERED]: 0, [STATUS.MARKED]: 0, [STATUS.MARKED_ANSWERED]: 0 };

    questions.forEach((q, i) => {
        counts[q.status]++;
        let shapeClass = 'shape-square', bgClass = 'bg-not-visited';
        if (q.status === STATUS.ANSWERED) { shapeClass = 'shape-shield'; bgClass = 'bg-answered'; }
        if (q.status === STATUS.NOT_ANSWERED) { shapeClass = 'shape-shield'; bgClass = 'bg-not-answered'; }
        if (q.status === STATUS.MARKED) { shapeClass = 'shape-circle'; bgClass = 'bg-marked'; }
        if (q.status === STATUS.MARKED_ANSWERED) { shapeClass = 'shape-circle'; bgClass = 'bg-marked'; }

        const btn = document.createElement('button');
        btn.className = `palette-btn ${shapeClass} ${bgClass}`;

        if (q.status === STATUS.MARKED_ANSWERED) {
            btn.innerHTML = q.id + `<div class="palette-check-badge"><svg fill="none" stroke="white" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg></div>`;
        } else {
            btn.textContent = q.id;
        }

        btn.onclick = () => jumpToQuestion(i);
        if (i === currentIndex) btn.classList.add('active-blue-border');

        el.palCont.appendChild(btn);
    });

    // Ensure we don't error out if legend items don't exist in solution view
    const eAnswered = document.getElementById('count-answered');
    if (eAnswered) eAnswered.textContent = counts[STATUS.ANSWERED];

    const eMarked = document.getElementById('count-marked');
    if (eMarked) eMarked.textContent = counts[STATUS.MARKED];

    const eNotVisited = document.getElementById('count-not-visited');
    if (eNotVisited) eNotVisited.textContent = counts[STATUS.NOT_VISITED];

    const eMarkedAns = document.getElementById('count-marked-answered');
    if (eMarkedAns) eMarkedAns.textContent = counts[STATUS.MARKED_ANSWERED];

    const eNotAns = document.getElementById('count-not-answered');
    if (eNotAns) eNotAns.textContent = counts[STATUS.NOT_ANSWERED];
}

function jumpToQuestion(index) {
    if (isSubmitted) {
        currentIndex = index;
        renderSolutionQuestion();
        renderSolutionPalette();
        return;
    }

    if (questions[currentIndex].status === STATUS.NOT_VISITED) questions[currentIndex].status = STATUS.NOT_ANSWERED;
    currentIndex = index;
    
    const ts = questions[currentIndex].timeSpent || 0;
    const m = Math.floor(ts / 60).toString().padStart(2, '0');
    const s = (ts % 60).toString().padStart(2, '0');
    el.qTime.textContent = `${m}:${s}`;
    
    renderCurrentQuestion();
    renderPalette();
}

function moveToNext() {
    if (currentIndex < questions.length - 1) jumpToQuestion(currentIndex + 1);
    else if (!isSubmitted) renderPalette();
}

function saveAndNext() {
    if (isSubmitted) return;
    const q = questions[currentIndex];
    q.status = q.selectedOption !== null ? STATUS.ANSWERED : STATUS.NOT_ANSWERED;
    moveToNext();
}

function markForReviewAndNext() {
    if (isSubmitted) return;
    const q = questions[currentIndex];
    q.status = q.selectedOption !== null ? STATUS.MARKED_ANSWERED : STATUS.MARKED;
    moveToNext();
}

function clearResponse() {
    if (isSubmitted) return;
    const q = questions[currentIndex];
    q.selectedOption = null;
    if (q.status === STATUS.ANSWERED) q.status = STATUS.NOT_ANSWERED;
    renderCurrentQuestion();
}

// ─── Submit & Solution View ───────────────────────────────────────────────────
function submitTest() {
    if (isSubmitted) return;
    if (!confirm('Are you sure you want to submit the test?')) return;

    isSubmitted = true;
    clearInterval(timerInterval);
    clearInterval(qTimeInterval);

    el.liveTestView.style.display = 'none';
    el.solutionView.style.display = 'flex';

    let correct = 0, wrong = 0, skipped = 0;
    questions.forEach(q => {
        if (q.selectedOption === null) { skipped++; return; }
        const opt = q.options[q.selectedOption];
        if (opt && opt.isCorrect) correct++;
        else wrong++;
    });

    el.statCorrect.textContent = correct;
    el.statWrong.textContent = wrong;
    el.statSkipped.textContent = skipped;

    const historyIdParam = urlParams.get('historyId');
    if (!historyIdParam) {
        chrome.storage.local.get(['savemockHistory'], (res) => {
            const history = res.savemockHistory || [];
            history.unshift({
                id: Date.now().toString(),
                date: new Date().toISOString(),
                subject: subject,
                mode: mode,
                stats: { correct, wrong, skipped },
                questions: questions
            });
            chrome.storage.local.set({ savemockHistory: history });
        });
    }

    currentIndex = 0;
    renderSolutionQuestion();
    renderSolutionPalette();
}

function renderSolutionQuestion() {
    const q = questions[currentIndex];
    el.solQHeader.textContent = `Question No. ${q.id}`;

    // Status Pill
    if (q.selectedOption === null) {
        el.solQStatus.textContent = 'Unattempted';
        el.solQStatus.style.background = '#6B7280';
    } else {
        const isCorrect = q.options[q.selectedOption]?.isCorrect;
        el.solQStatus.textContent = isCorrect ? 'Correct' : 'Incorrect';
        el.solQStatus.style.background = isCorrect ? '#28A745' : '#DC3545';
    }

    const solQTime = document.getElementById('sol-q-time');
    if (solQTime) {
        const ts = q.timeSpent || 0;
        const m = Math.floor(ts / 60).toString().padStart(2, '0');
        const s = (ts % 60).toString().padStart(2, '0');
        solQTime.textContent = `⏱️ ${m}:${s}`;
    }

    el.solQText.innerHTML = q.textHtml || '<em>No question text.</em>';
    renderMathIn(el.solQText);

    el.solOptsCont.innerHTML = '';
    q.options.forEach((opt, idx) => {
        const isChecked = q.selectedOption === idx;
        const isCorrect = !!opt.isCorrect;

        const row = document.createElement('div');
        row.className = 'sol-opt-row';
        if (isCorrect) row.classList.add('correct');
        else if (isChecked && !isCorrect) row.classList.add('wrong');

        row.innerHTML = `
            <div style="width:20px; height:20px; margin-right:12px; display:flex; align-items:center; justify-content:center;">
                ${isCorrect ? '<svg style="color:inherit; width:16px; height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : (isChecked ? '<svg style="color:inherit; width:16px; height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/></svg>' : '')}
            </div>
            <span class="sol-opt-text" style="flex:1;">${opt.html || ''}</span>
        `;
        el.solOptsCont.appendChild(row);
        renderMathIn(row);
    });

    el.solSolutionContent.innerHTML = q.solutionHtml || '';
    renderMathIn(el.solSolutionContent);

    const solNotesPanel = document.getElementById('sol-notes-panel');
    const solNotesContent = document.getElementById('sol-notes-content');
    if (solNotesContent) {
        solNotesContent.innerHTML = q.notesHtml || '';
        renderMathIn(solNotesContent);
    }

    // Tabs Logic
    const hasSol = !!q.solutionHtml;
    const hasNotes = !!q.notesHtml;

    if (hasSol || hasNotes) {
        if (el.solTabs) el.solTabs.style.display = 'flex';

        if (hasSol) {
            el.btnTabSol.style.display = 'inline-block';
        } else {
            el.btnTabSol.style.display = 'none';
        }

        if (hasNotes) {
            el.btnTabNotes.style.display = 'inline-block';
        } else {
            el.btnTabNotes.style.display = 'none';
        }

        // Default to solution if available, otherwise notes
        const defaultTab = hasSol ? 'sol' : 'notes';

        const showTab = (tabName) => {
            if (tabName === 'sol') {
                el.btnTabSol.classList.add('active');
                el.btnTabNotes.classList.remove('active');
                el.solSolutionBox.style.display = 'block';
                if (solNotesPanel) solNotesPanel.style.display = 'none';
            } else {
                el.btnTabNotes.classList.add('active');
                el.btnTabSol.classList.remove('active');
                el.solSolutionBox.style.display = 'none';
                if (solNotesPanel) solNotesPanel.style.display = 'block';
            }
        };

        el.btnTabSol.onclick = () => showTab('sol');
        el.btnTabNotes.onclick = () => showTab('notes');

        showTab(defaultTab);

    } else {
        if (el.solTabs) el.solTabs.style.display = 'none';
        el.solSolutionBox.style.display = 'none';
        if (solNotesPanel) solNotesPanel.style.display = 'none';
    }

    el.btnSolPrev.disabled = currentIndex === 0;
    el.btnSolPrev.style.opacity = currentIndex === 0 ? '0.5' : '1';
    el.btnSolNext.disabled = currentIndex === questions.length - 1;
    el.btnSolNext.style.opacity = currentIndex === questions.length - 1 ? '0.5' : '1';

    el.solContentArea.scrollTop = 0;
}

function renderSolutionPalette() {
    el.solPalette.innerHTML = '';
    questions.forEach((q, i) => {
        const isCorrect = q.selectedOption !== null && q.options[q.selectedOption]?.isCorrect;
        const isWrong = q.selectedOption !== null && !q.options[q.selectedOption]?.isCorrect;

        let bgClass = 'bg-not-visited';
        if (isCorrect) bgClass = 'bg-answered'; // green
        else if (isWrong) bgClass = 'bg-not-answered'; // red

        const btn = document.createElement('button');
        btn.className = `palette-btn shape-square ${bgClass}`;
        btn.textContent = q.id;
        btn.onclick = () => jumpToQuestion(i);
        if (i === currentIndex) btn.classList.add('active-blue-border');

        el.solPalette.appendChild(btn);
    });
}

// ─── Timers ───────────────────────────────────────────────────────────────────
function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (isPaused || isSubmitted) return;
        if (timerSeconds <= 0) { clearInterval(timerInterval); submitTest(); return; }
        timerSeconds--;
        el.tHours.textContent = Math.floor(timerSeconds / 3600).toString().padStart(2, '0');
        el.tMins.textContent = Math.floor((timerSeconds % 3600) / 60).toString().padStart(2, '0');
        el.tSecs.textContent = (timerSeconds % 60).toString().padStart(2, '0');
    }, 1000);
}

function startQTimer() {
    if (qTimeInterval) clearInterval(qTimeInterval);
    qTimeInterval = setInterval(() => {
        if (isPaused || isSubmitted) return;
        if (mode === 'practice' && questions[currentIndex].selectedOption !== null) return;
        
        questions[currentIndex].timeSpent++;
        const ts = questions[currentIndex].timeSpent;
        const m = Math.floor(ts / 60).toString().padStart(2, '0');
        const s = (ts % 60).toString().padStart(2, '0');
        el.qTime.textContent = `${m}:${s}`;
    }, 1000);
}

function togglePause() {
    if (isSubmitted) return;
    isPaused = !isPaused;
    el.pauseOverlay.style.display = isPaused ? 'flex' : 'none';
}

function toggleFullScreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => { });
    else if (document.exitFullscreen) document.exitFullscreen();
}

function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (sidebarOpen) {
        el.sidebar.style.width = '340px';
        el.sidebarWrap.style.right = '340px';
        el.tIconBtn.style.borderLeft = '1px solid var(--border-color)';
        el.tIcon.style.transform = 'rotate(180deg)';
    } else {
        el.sidebar.style.width = '0px';
        el.sidebarWrap.style.right = '0px';
        el.tIconBtn.style.borderLeft = 'none';
        el.tIcon.style.transform = 'rotate(0deg)';
    }
}

// ─── Zoom & Theme ─────────────────────────────────────────────────────────────
function updateZoom(view, delta) {
    if (view === 'live') {
        zoomLevel += delta;
        if (zoomLevel < 1) zoomLevel = 1;
        if (zoomLevel > 4) zoomLevel = 4;
        el.contentArea.className = `q-content zoom-${zoomLevel}`;
    } else {
        solZoomLevel += delta;
        if (solZoomLevel < 1) solZoomLevel = 1;
        if (solZoomLevel > 4) solZoomLevel = 4;
        el.solContentArea.className = `q-content zoom-${solZoomLevel}`;
    }
}

function toggleTheme() {
    document.body.classList.toggle('light-mode');
}

// ─── Attach Event Listeners ───────────────────────────────────────────────────
document.getElementById('btn-start-test').addEventListener('click', startTest);
document.getElementById('btn-resume-test').addEventListener('click', togglePause);
document.getElementById('btn-pause-header').addEventListener('click', togglePause);
document.getElementById('btn-fullscreen-header').addEventListener('click', toggleFullScreen);
document.getElementById('btn-mark-review').addEventListener('click', markForReviewAndNext);
document.getElementById('btn-clear-response').addEventListener('click', clearResponse);
document.getElementById('btn-save-next').addEventListener('click', saveAndNext);
document.getElementById('toggleIconBtn').addEventListener('click', toggleSidebar);
document.getElementById('btn-submit').addEventListener('click', submitTest);

const btnPrevLive = document.getElementById('btn-prev-live');
if (btnPrevLive) btnPrevLive.addEventListener('click', () => { if (currentIndex > 0) jumpToQuestion(currentIndex - 1); });

// Zoom
document.getElementById('btn-zoom-in').addEventListener('click', () => updateZoom('live', 1));
document.getElementById('btn-zoom-out').addEventListener('click', () => updateZoom('live', -1));
document.getElementById('btn-sol-zoom-in').addEventListener('click', () => updateZoom('sol', 1));
document.getElementById('btn-sol-zoom-out').addEventListener('click', () => updateZoom('sol', -1));

// Theme
document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);
document.getElementById('btn-theme-toggle-sol').addEventListener('click', toggleTheme);
document.getElementById('btn-fullscreen-sol')?.addEventListener('click', toggleFullScreen);

// Sol Navigation
document.getElementById('btn-sol-prev').addEventListener('click', () => { if (currentIndex > 0) jumpToQuestion(currentIndex - 1); });
document.getElementById('btn-sol-next').addEventListener('click', () => { if (currentIndex < questions.length - 1) jumpToQuestion(currentIndex + 1); });

// ─── Solution Sidebar Toggle ───
let solSidebarOpen = true;
function toggleSolSidebar() {
    solSidebarOpen = !solSidebarOpen;
    const solSidebar = document.querySelector('#solution-view #sidebar');
    const solWrap = document.getElementById('solSidebarToggleWrapper');
    const solIconBtn = document.getElementById('solToggleIconBtn');
    const solIcon = document.getElementById('solToggleIcon');

    if (solSidebarOpen) {
        solSidebar.style.width = '340px';
        solWrap.style.right = '340px';
        solIconBtn.style.borderLeft = '1px solid var(--border-color)';
        solIcon.style.transform = 'rotate(180deg)';
    } else {
        solSidebar.style.width = '0px';
        solWrap.style.right = '0px';
        solIconBtn.style.borderLeft = 'none';
        solIcon.style.transform = 'rotate(0deg)';
    }
}
document.getElementById('solToggleIconBtn')?.addEventListener('click', toggleSolSidebar);

// ─── Image Lightbox Logic ───
const lightbox = document.getElementById('image-lightbox');
if (lightbox) {
    const lightboxImg = lightbox.querySelector('img');
    const lightboxClose = lightbox.querySelector('.close-btn');
    let lbScale = 1;
    let lbX = 0, lbY = 0;
    let lbDragging = false;
    let lbDragStart = { x: 0, y: 0 };
    let lbPanStart = { x: 0, y: 0 };

    // Force initial hidden state
    lightbox.style.display = 'none';
    lightbox.style.opacity = '0';

    const applyTransform = (transition = '0.1s ease') => {
        lightboxImg.style.transition = `transform ${transition}`;
        lightboxImg.style.transform = `translate(${lbX}px, ${lbY}px) scale(${lbScale})`;
        lightboxImg.style.cursor = lbScale > 1 ? (lbDragging ? 'grabbing' : 'grab') : 'zoom-in';
    };

    const openLightbox = (imgEl) => {
        lightboxImg.src = imgEl.src;
        lbScale = 1; lbX = 0; lbY = 0;
        lightboxImg.style.transform = 'scale(0.85)';
        lightboxImg.style.transition = 'none';
        lightbox.style.display = 'flex';
        lightbox.style.opacity = '0';
        lightbox.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                lightbox.style.transition = 'opacity 0.2s ease';
                lightbox.style.opacity = '1';
                lightboxImg.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
                lightboxImg.style.transform = 'scale(1)';
            });
        });
    };

    const closeLightbox = () => {
        lightbox.style.transition = 'opacity 0.2s ease';
        lightbox.style.opacity = '0';
        document.body.style.overflow = '';
        lbScale = 1; lbX = 0; lbY = 0;
        setTimeout(() => {
            lightbox.style.display = 'none';
            lightbox.style.pointerEvents = 'none';
            lightboxImg.src = '';
            lightboxImg.style.transform = '';
            lightboxImg.style.transition = '';
        }, 220);
    };

    document.addEventListener('click', (e) => {
        if (e.target.tagName !== 'IMG') return;
        if (e.target.closest('.q-content') || e.target.closest('.notes-panel') || e.target.closest('.solution-panel')) {
            e.stopPropagation();
            openLightbox(e.target);
        }
    });

    lightbox.addEventListener('wheel', (e) => {
        e.preventDefault(); e.stopPropagation();
        const delta = e.deltaY < 0 ? 0.15 : -0.15;
        lbScale = Math.min(5, Math.max(0.5, lbScale + delta));
        if (lbScale <= 1) { lbX = 0; lbY = 0; }
        applyTransform();
    }, { passive: false });

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

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    lightboxClose.addEventListener('click', closeLightbox);
}
