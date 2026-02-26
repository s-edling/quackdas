/**
 * Quackdas - Coding Functions
 * Text selection, segment creation, segment editing
 */

// Current segment being edited
let currentEditSegment = null;
let currentSegmentActionIds = null;
const MIN_TEXT_CODING_LENGTH = 3; // 1-2 chars are never kept as coding

function regionsEqualForSegment(a, b, tolerance = 0.0015) {
    if (!a || !b) return false;
    if (a.pageNum !== b.pageNum) return false;
    return Math.abs((a.xNorm || 0) - (b.xNorm || 0)) <= tolerance &&
        Math.abs((a.yNorm || 0) - (b.yNorm || 0)) <= tolerance &&
        Math.abs((a.wNorm || 0) - (b.wNorm || 0)) <= tolerance &&
        Math.abs((a.hNorm || 0) - (b.hNorm || 0)) <= tolerance;
}

let currentPdfAnnotationSegmentId = null;
let currentPdfAnnotationCodeId = null;
let currentPdfAnnotationCodeName = '';
let pdfAnnotationOutsideBound = false;
let pdfAnnotationOpenedAt = 0;

function resolveSegmentMemoCodeId(segmentId, codeId) {
    const normalizedCodeId = String(codeId || '').trim();
    if (!normalizedCodeId) return '';
    const segment = appData.segments.find(s => s.id === segmentId);
    if (!segment || !Array.isArray(segment.codeIds)) return '';
    return segment.codeIds.includes(normalizedCodeId) ? normalizedCodeId : '';
}

function addSegmentMemo(segmentId, text, tag = '', options = {}) {
    if (!text && !tag) return;
    const now = new Date().toISOString();
    const memo = {
        id: 'memo_' + Date.now(),
        type: 'segment',
        targetId: segmentId,
        content: text,
        tag: String(tag || '').trim().slice(0, 40),
        created: now,
        edited: now
    };
    const codeId = resolveSegmentMemoCodeId(segmentId, options?.codeId);
    if (codeId) memo.codeId = codeId;
    appData.memos.push(memo);
}

function ensurePdfAnnotationInline() {
    let panel = document.getElementById('pdfRegionAnnotationInline');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'pdfRegionAnnotationInline';
    panel.className = 'pdf-region-annotation-inline';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="pdf-region-annotation-title" id="pdfRegionAnnotationTitle">Add annotation</div>
        <textarea id="pdfRegionAnnotationInput" class="pdf-region-annotation-input" rows="3" placeholder="Why this region matters..."></textarea>
        <div class="pdf-region-annotation-tag-title">Tag (optional)</div>
        <input id="pdfRegionAnnotationTag" type="text" class="pdf-region-annotation-tag" maxlength="40" placeholder="Tag (optional)" />
        <div id="pdfRegionAnnotationExisting" class="pdf-region-annotation-existing" hidden></div>
        <div class="pdf-region-annotation-actions">
            <button type="button" id="pdfRegionAnnotationSave" class="btn btn-primary">Save annotation</button>
            <button type="button" id="pdfRegionAnnotationSkip" class="btn btn-secondary">Close</button>
        </div>
    `;
    document.body.appendChild(panel);

    const saveBtn = panel.querySelector('#pdfRegionAnnotationSave');
    const skipBtn = panel.querySelector('#pdfRegionAnnotationSkip');
    const input = panel.querySelector('#pdfRegionAnnotationInput');
    const tagInput = panel.querySelector('#pdfRegionAnnotationTag');
    if (saveBtn) saveBtn.addEventListener('click', savePdfRegionAnnotationInline);
    if (skipBtn) skipBtn.addEventListener('click', dismissPdfRegionAnnotationInline);
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                dismissPdfRegionAnnotationInline();
                return;
            }
            if (event.key !== 'Enter') return;
            if (event.shiftKey) return;
            event.preventDefault();
            savePdfRegionAnnotationInline();
        });
    }
    if (tagInput) {
        tagInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            dismissPdfRegionAnnotationInline();
        });
    }

    if (!pdfAnnotationOutsideBound) {
        const closeIfOutside = (event) => {
            const host = document.getElementById('pdfRegionAnnotationInline');
            if (!host || host.hidden) return;
            if (Date.now() - pdfAnnotationOpenedAt < 160) return;
            if (host.contains(event.target)) return;
            dismissPdfRegionAnnotationInline();
        };
        document.addEventListener('pointerdown', closeIfOutside, true);
        pdfAnnotationOutsideBound = true;
    }
    return panel;
}

function renderSegmentAnnotationList(segmentId, selectedCodeId = '') {
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (!panel) return;
    const list = panel.querySelector('#pdfRegionAnnotationExisting');
    if (!list) return;

    const normalizedCodeId = String(selectedCodeId || '').trim();
    const memos = normalizedCodeId
        ? getSegmentMemos(segmentId, normalizedCodeId)
        : getMemosForTarget('segment', segmentId);
    if (memos.length === 0) {
        list.hidden = true;
        list.innerHTML = '';
        return;
    }

    const scopeLabel = normalizedCodeId && currentPdfAnnotationCodeName
        ? ` for ${escapeHtml(currentPdfAnnotationCodeName)}`
        : '';

    list.hidden = false;
    list.innerHTML = `
        <div class="pdf-region-annotation-existing-title">Existing annotations${scopeLabel}</div>
        ${memos.map(memo => `<div class="pdf-region-annotation-item">${memo.tag ? `<div class="memo-tag-badge">${escapeHtml(memo.tag)}</div>` : ''}${escapeHtml(memo.content || '')}</div>`).join('')}
    `;
}

function showPdfRegionAnnotationInline(segment, options = {}) {
    if (!segment || !segment.id) return;
    const panel = ensurePdfAnnotationInline();
    const titleEl = panel.querySelector('#pdfRegionAnnotationTitle');
    const input = panel.querySelector('#pdfRegionAnnotationInput');
    currentPdfAnnotationSegmentId = segment.id;

    const requestedCodeId = resolveSegmentMemoCodeId(segment.id, options.selectedCodeId);
    currentPdfAnnotationCodeId = requestedCodeId || null;
    if (currentPdfAnnotationCodeId) {
        const code = appData.codes.find(c => c.id === currentPdfAnnotationCodeId);
        currentPdfAnnotationCodeName = String(options.selectedCodeName || code?.name || '').trim();
    } else {
        currentPdfAnnotationCodeName = '';
    }

    if (titleEl) {
        titleEl.textContent = options.title || (currentPdfAnnotationCodeName ? `Add annotation • ${currentPdfAnnotationCodeName}` : 'Add annotation');
    }
    if (input) {
        input.value = '';
        input.placeholder = options.placeholder || (currentPdfAnnotationCodeName
            ? `Add annotation for ${currentPdfAnnotationCodeName} (optional)...`
            : 'Add annotation (optional)...');
        setTimeout(() => input.focus(), 0);
    }
    const tagInput = panel.querySelector('#pdfRegionAnnotationTag');
    if (tagInput) tagInput.value = '';
    renderSegmentAnnotationList(segment.id, currentPdfAnnotationCodeId);
    pdfAnnotationOpenedAt = Date.now();
    panel.hidden = false;
}

function savePdfRegionAnnotationInline() {
    if (!currentPdfAnnotationSegmentId) return;
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (!panel) return;
    const input = panel.querySelector('#pdfRegionAnnotationInput');
    const tagInput = panel.querySelector('#pdfRegionAnnotationTag');
    const text = (input?.value || '').trim();
    const tag = (tagInput?.value || '').trim().slice(0, 40);
    const segmentId = currentPdfAnnotationSegmentId;
    const segment = appData.segments.find(s => s.id === segmentId);
    const currentDoc = appData.documents.find(d => d.id === appData.currentDocId);
    const isCurrentPdfSegment = !!(
        segment &&
        currentDoc &&
        currentDoc.type === 'pdf' &&
        segment.docId === currentDoc.id &&
        !appData.filterCodeId
    );

    saveHistory();
    addSegmentMemo(segmentId, text, tag, { codeId: currentPdfAnnotationCodeId });
    saveData();

    if (isCurrentPdfSegment) {
        // Do not re-render the PDF page here: it causes a jump to page top.
        // We only refresh side panels and keep current viewport/page intact.
        renderDocuments();
        renderCodes();
        renderSegmentAnnotationList(segmentId, currentPdfAnnotationCodeId);
    } else {
        renderAll();
    }

    dismissPdfRegionAnnotationInline();
}

function dismissPdfRegionAnnotationInline() {
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (panel) panel.hidden = true;
    currentPdfAnnotationSegmentId = null;
    currentPdfAnnotationCodeId = null;
    currentPdfAnnotationCodeName = '';
}

const READONLY_VIEWER_DRAG_THRESHOLD_PX = 4;
const readOnlyViewerCaretState = {
    outsidePointerBound: false,
    pointerDown: false,
    dragDetected: false,
    downX: 0,
    downY: 0,
    suppressNextClickActivation: false
};

function isCurrentDocumentTextView() {
    if (appData.filterCodeId || appData.selectedCaseId) return false;
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    if (!doc) return false;
    return doc.type !== 'pdf';
}

function selectionBelongsToElement(selection, element) {
    if (!selection || !element || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return element.contains(range.startContainer) && element.contains(range.endContainer);
}

function showReadOnlyTextViewerCaret(contentElement = document.getElementById('documentContent')) {
    if (!contentElement) return;
    contentElement.classList.add('viewer-readonly-caret-active');
    if (document.activeElement !== contentElement) {
        try {
            contentElement.focus({ preventScroll: true });
        } catch (_) {
            contentElement.focus();
        }
    }
}

function hideReadOnlyTextViewerCaret(options = {}) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement) return;
    contentElement.classList.remove('viewer-readonly-caret-active');
    if (document.activeElement === contentElement) {
        contentElement.blur();
    }
    if (options.clearCollapsedSelection === false) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return;
    if (!selectionBelongsToElement(selection, contentElement)) return;
    selection.removeAllRanges();
}

function preventReadOnlyViewerMutation(event) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement || !contentElement.classList.contains('viewer-readonly-caret-enabled')) return;
    if (!contentElement.contains(event.target)) return;
    event.preventDefault();
}

function preventReadOnlyViewerEditKeys(event) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement || !contentElement.classList.contains('viewer-readonly-caret-enabled')) return;
    if (!contentElement.contains(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = String(event.key || '');
    const isSingleChar = key.length === 1;
    if (!isSingleChar && key !== 'Backspace' && key !== 'Delete' && key !== 'Enter') return;
    event.preventDefault();
}

function handleReadOnlyViewerKeyup(event) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement || document.activeElement !== contentElement) return;
    const key = String(event.key || '');
    if (!key || key === 'Shift' || key === 'Control' || key === 'Meta' || key === 'Alt') return;
    handleTextSelection();
}

function handleReadOnlyViewerPointerDown(event) {
    if (event.button !== 0) return;
    readOnlyViewerCaretState.pointerDown = true;
    readOnlyViewerCaretState.dragDetected = false;
    readOnlyViewerCaretState.suppressNextClickActivation = false;
    readOnlyViewerCaretState.downX = event.clientX;
    readOnlyViewerCaretState.downY = event.clientY;
}

function handleReadOnlyViewerPointerMove(event) {
    if (!readOnlyViewerCaretState.pointerDown || readOnlyViewerCaretState.dragDetected) return;
    const dx = Math.abs(event.clientX - readOnlyViewerCaretState.downX);
    const dy = Math.abs(event.clientY - readOnlyViewerCaretState.downY);
    if (dx < READONLY_VIEWER_DRAG_THRESHOLD_PX && dy < READONLY_VIEWER_DRAG_THRESHOLD_PX) return;
    readOnlyViewerCaretState.dragDetected = true;
}

function handleReadOnlyViewerPointerEnd() {
    if (!readOnlyViewerCaretState.pointerDown) return;
    readOnlyViewerCaretState.suppressNextClickActivation = readOnlyViewerCaretState.dragDetected;
    readOnlyViewerCaretState.pointerDown = false;
    readOnlyViewerCaretState.dragDetected = false;
}

function isReadOnlyViewerInteractiveTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest(
        'button, a, input, textarea, select, [data-action], .document-segment-annotation-indicator'
    );
}

function handleReadOnlyViewerClick(event) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement || !contentElement.classList.contains('viewer-readonly-caret-enabled')) return;
    if (!isCurrentDocumentTextView()) return;
    if (isReadOnlyViewerInteractiveTarget(event.target)) {
        hideReadOnlyTextViewerCaret({ clearCollapsedSelection: false });
        return;
    }

    const suppress = readOnlyViewerCaretState.suppressNextClickActivation;
    readOnlyViewerCaretState.suppressNextClickActivation = false;
    if (suppress) {
        hideReadOnlyTextViewerCaret({ clearCollapsedSelection: false });
        return;
    }

    const selection = window.getSelection();
    if (selection && selection.rangeCount && selectionBelongsToElement(selection, contentElement) && !selection.isCollapsed) {
        hideReadOnlyTextViewerCaret({ clearCollapsedSelection: false });
        handleTextSelection();
        return;
    }

    showReadOnlyTextViewerCaret(contentElement);
}

function bindReadOnlyViewerOutsidePointerHandler() {
    if (readOnlyViewerCaretState.outsidePointerBound) return;
    document.addEventListener('pointerdown', (event) => {
        const contentElement = document.getElementById('documentContent');
        if (!contentElement || !contentElement.classList.contains('viewer-readonly-caret-active')) return;
        const viewer = document.querySelector('.content-body');
        if (viewer && viewer.contains(event.target)) return;
        hideReadOnlyTextViewerCaret();
    }, true);
    readOnlyViewerCaretState.outsidePointerBound = true;
}

function enableReadOnlyTextViewerCaret(contentElement = document.getElementById('documentContent')) {
    if (!contentElement) return;
    if (!isCurrentDocumentTextView()) return;
    contentElement.classList.add('viewer-readonly-caret-enabled');
    contentElement.setAttribute('contenteditable', 'true');
    contentElement.setAttribute('spellcheck', 'false');
    contentElement.setAttribute('autocapitalize', 'off');
    contentElement.setAttribute('autocorrect', 'off');
    contentElement.setAttribute('autocomplete', 'off');
    if (!contentElement.hasAttribute('tabindex')) {
        contentElement.setAttribute('tabindex', '0');
        contentElement.dataset.viewerReadonlyCaretOwnsTabindex = '1';
    }

    if (contentElement.dataset.viewerReadonlyCaretBound !== '1') {
        contentElement.addEventListener('beforeinput', preventReadOnlyViewerMutation, true);
        contentElement.addEventListener('paste', preventReadOnlyViewerMutation, true);
        contentElement.addEventListener('drop', preventReadOnlyViewerMutation, true);
        contentElement.addEventListener('keydown', preventReadOnlyViewerEditKeys, true);
        contentElement.addEventListener('keyup', handleReadOnlyViewerKeyup, true);
        contentElement.addEventListener('pointerdown', handleReadOnlyViewerPointerDown, true);
        contentElement.addEventListener('pointermove', handleReadOnlyViewerPointerMove, true);
        contentElement.addEventListener('pointerup', handleReadOnlyViewerPointerEnd, true);
        contentElement.addEventListener('pointercancel', handleReadOnlyViewerPointerEnd, true);
        contentElement.addEventListener('click', handleReadOnlyViewerClick, true);
        contentElement.dataset.viewerReadonlyCaretBound = '1';
    }

    bindReadOnlyViewerOutsidePointerHandler();
}

function disableReadOnlyTextViewerCaret(options = {}) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement) return;
    contentElement.classList.remove('viewer-readonly-caret-enabled', 'viewer-readonly-caret-active');
    contentElement.removeAttribute('contenteditable');
    contentElement.removeAttribute('spellcheck');
    contentElement.removeAttribute('autocapitalize');
    contentElement.removeAttribute('autocorrect');
    contentElement.removeAttribute('autocomplete');
    if (contentElement.dataset.viewerReadonlyCaretOwnsTabindex === '1') {
        contentElement.removeAttribute('tabindex');
        delete contentElement.dataset.viewerReadonlyCaretOwnsTabindex;
    }

    readOnlyViewerCaretState.pointerDown = false;
    readOnlyViewerCaretState.dragDetected = false;
    readOnlyViewerCaretState.suppressNextClickActivation = false;

    if (document.activeElement === contentElement) {
        contentElement.blur();
    }
    if (options.clearSelection === false) return;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    if (!selectionBelongsToElement(selection, contentElement)) return;
    selection.removeAllRanges();
}

// Text selection and coding
function handleTextSelection() {
    if (appData.filterCodeId) return; // Don't allow coding in filter view

    const selection = window.getSelection();
    if (!selection) {
        appData.selectedText = null;
        return;
    }
    const text = selection.toString().trim();

    // Clear stored selection if nothing is selected
    if (!text || text.length === 0 || !selection.rangeCount) {
        appData.selectedText = null;
        return;
    }

    const range = selection.getRangeAt(0);
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const contentElement = document.getElementById('documentContent');
    if (!doc || !contentElement || typeof doc.content !== 'string') {
        appData.selectedText = null;
        return;
    }

    // Calculate actual character positions in the document
    const position = getTextPosition(contentElement, range, doc.content);

    if (position) {
        // Store indices (not just a DOM Range) so we can restore selection after re-render
        appData.selectedText = {
            text: doc.content.substring(position.start, position.end),
            startIndex: position.start,
            endIndex: position.end
        };
    }
}

function isTinyTextRange(startIndex, endIndex) {
    return (Number(endIndex) - Number(startIndex)) < MIN_TEXT_CODING_LENGTH;
}

function mergeIntervals(intervals) {
    if (!Array.isArray(intervals) || intervals.length === 0) return [];
    const sorted = intervals
        .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
        .sort((x, y) => x[0] - y[0]);
    if (sorted.length === 0) return [];
    const merged = [sorted[0].slice()];
    for (let i = 1; i < sorted.length; i++) {
        const [start, end] = sorted[i];
        const last = merged[merged.length - 1];
        if (start <= last[1]) {
            last[1] = Math.max(last[1], end);
        } else {
            merged.push([start, end]);
        }
    }
    return merged;
}

function subtractIntervalsFromRange(start, end, coveredIntervals) {
    if (!(end > start)) return [];
    if (!Array.isArray(coveredIntervals) || coveredIntervals.length === 0) return [[start, end]];
    const out = [];
    let cursor = start;
    coveredIntervals.forEach(([a, b]) => {
        const s = Math.max(start, a);
        const e = Math.min(end, b);
        if (e <= s) return;
        if (s > cursor) out.push([cursor, s]);
        cursor = Math.max(cursor, e);
    });
    if (cursor < end) out.push([cursor, end]);
    return out;
}

function findSnapSegmentRange(docId, startIndex, endIndex) {
    const selectionLength = endIndex - startIndex;
    if (!(selectionLength > 0)) return null;

    const SNAP_MIN_OVERLAP_TO_SEGMENT = 0.88;
    const SNAP_MIN_OVERLAP_TO_SELECTION = 0.75;
    let best = null;
    let bestScore = -Infinity;

    appData.segments.forEach((segment) => {
        if (!segment || segment.docId !== docId || segment.pdfRegion) return;
        const segStart = Number(segment.startIndex);
        const segEnd = Number(segment.endIndex);
        if (!(segEnd > segStart)) return;

        const overlap = Math.max(0, Math.min(endIndex, segEnd) - Math.max(startIndex, segStart));
        if (!(overlap > 0)) return;

        const segLen = segEnd - segStart;
        const overlapToSeg = overlap / segLen;
        const overlapToSel = overlap / selectionLength;
        if (overlapToSeg < SNAP_MIN_OVERLAP_TO_SEGMENT || overlapToSel < SNAP_MIN_OVERLAP_TO_SELECTION) return;

        const edgeTolerance = Math.max(4, Math.round(segLen * 0.12));
        const startDrift = Math.abs(startIndex - segStart);
        const endDrift = Math.abs(endIndex - segEnd);
        if (startDrift > edgeTolerance || endDrift > edgeTolerance) return;

        const score = (overlapToSeg * 2) + overlapToSel - ((startDrift + endDrift) / (edgeTolerance * 2));
        if (score > bestScore) {
            bestScore = score;
            best = { startIndex: segStart, endIndex: segEnd };
        }
    });

    return best;
}

function normalizeTextSelectionForCoding(doc, rawSelection) {
    if (!doc || !rawSelection) return null;
    let startIndex = Number(rawSelection.startIndex);
    let endIndex = Number(rawSelection.endIndex);
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return null;
    if (endIndex < startIndex) {
        const t = startIndex;
        startIndex = endIndex;
        endIndex = t;
    }
    startIndex = Math.max(0, Math.min(startIndex, doc.content.length));
    endIndex = Math.max(0, Math.min(endIndex, doc.content.length));
    if (!(endIndex > startIndex)) return null;

    const snapped = findSnapSegmentRange(doc.id, startIndex, endIndex);
    if (snapped) {
        startIndex = snapped.startIndex;
        endIndex = snapped.endIndex;
    }

    return {
        startIndex,
        endIndex,
        text: doc.content.substring(startIndex, endIndex)
    };
}

function pruneTinyTextSegments() {
    appData.segments = appData.segments.filter((segment) => {
        if (!segment || segment.pdfRegion) return true;
        const start = Number(segment.startIndex);
        const end = Number(segment.endIndex);
        if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return false;
        return !isTinyTextRange(start, end);
    });
}

function coalesceExactTextSegments() {
    const byKey = new Map();
    const out = [];

    appData.segments.forEach((segment) => {
        if (!segment) return;
        if (segment.pdfRegion) {
            out.push(segment);
            return;
        }

        const start = Number(segment.startIndex);
        const end = Number(segment.endIndex);
        if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return;

        const key = `${segment.docId}::${start}::${end}`;
        const existing = byKey.get(key);
        if (!existing) {
            segment.codeIds = Array.from(new Set(Array.isArray(segment.codeIds) ? segment.codeIds : []));
            byKey.set(key, segment);
            out.push(segment);
            return;
        }

        existing.codeIds = Array.from(new Set([...(existing.codeIds || []), ...((segment.codeIds || []))]));
        if (!existing.created || (segment.created && segment.created < existing.created)) {
            existing.created = segment.created;
        }
        existing.modified = segment.modified || existing.modified;
        existing.text = existing.text || segment.text;
    });

    appData.segments = out.filter((segment) => {
        if (segment.pdfRegion) return true;
        return Array.isArray(segment.codeIds) && segment.codeIds.length > 0;
    });
}

function toggleCodeForTextRange(doc, startIndex, endIndex, codeId) {
    const overlapWithCode = appData.segments.filter((segment) => (
        segment &&
        !segment.pdfRegion &&
        segment.docId === doc.id &&
        Array.isArray(segment.codeIds) &&
        segment.codeIds.includes(codeId) &&
        Number(segment.startIndex) < endIndex &&
        Number(segment.endIndex) > startIndex
    ));

    const coveredIntervals = mergeIntervals(
        overlapWithCode.map((segment) => [
            Math.max(startIndex, Number(segment.startIndex)),
            Math.min(endIndex, Number(segment.endIndex))
        ])
    );

    // Tiny ranges are allowed only for removal (fine-grained uncoding), never for adding new coding.
    if (isTinyTextRange(startIndex, endIndex) && coveredIntervals.length === 0) {
        return { changed: false, skippedTiny: true };
    }

    const addIntervals = subtractIntervalsFromRange(startIndex, endIndex, coveredIntervals)
        .filter(([a, b]) => !isTinyTextRange(a, b));

    const affectedIds = new Set(overlapWithCode.map(segment => segment.id));
    const now = new Date().toISOString();
    const idBase = Date.now();
    let idSeq = 0;
    const nextSegId = () => `seg_${idBase}_${++idSeq}`;
    let changed = false;
    const nextSegments = [];

    appData.segments.forEach((segment) => {
        if (!segment || !affectedIds.has(segment.id)) {
            nextSegments.push(segment);
            return;
        }

        const segStart = Number(segment.startIndex);
        const segEnd = Number(segment.endIndex);
        if (!(segEnd > segStart)) return;

        const cuts = [segStart, segEnd];
        if (startIndex > segStart && startIndex < segEnd) cuts.push(startIndex);
        if (endIndex > segStart && endIndex < segEnd) cuts.push(endIndex);
        cuts.sort((a, b) => a - b);

        const pieces = [];
        for (let i = 0; i < cuts.length - 1; i++) {
            const a = cuts[i];
            const b = cuts[i + 1];
            if (!(b > a)) continue;

            let codeIds = Array.from(new Set(Array.isArray(segment.codeIds) ? segment.codeIds : []));
            const overlapsSelection = a < endIndex && b > startIndex;
            if (overlapsSelection && codeIds.includes(codeId)) {
                codeIds = codeIds.filter(id => id !== codeId);
                changed = true;
            }
            if (codeIds.length === 0 || isTinyTextRange(a, b)) continue;

            pieces.push({
                ...segment,
                id: nextSegId(),
                startIndex: a,
                endIndex: b,
                text: doc.content.substring(a, b),
                codeIds,
                modified: now
            });
        }

        if (pieces.length === 0) return;

        // Keep memo linkage stable where possible by preserving original id on largest remaining piece.
        let largestIndex = 0;
        for (let i = 1; i < pieces.length; i++) {
            const bestLen = Number(pieces[largestIndex].endIndex) - Number(pieces[largestIndex].startIndex);
            const curLen = Number(pieces[i].endIndex) - Number(pieces[i].startIndex);
            if (curLen > bestLen) largestIndex = i;
        }
        pieces[largestIndex].id = segment.id;
        pieces[largestIndex].created = segment.created || now;

        pieces.forEach(piece => nextSegments.push(piece));
    });

    addIntervals.forEach(([a, b]) => {
        let target = nextSegments.find((segment) => (
            segment &&
            !segment.pdfRegion &&
            segment.docId === doc.id &&
            Number(segment.startIndex) === a &&
            Number(segment.endIndex) === b
        ));

        if (target) {
            if (!target.codeIds.includes(codeId)) {
                target.codeIds.push(codeId);
                target.codeIds = Array.from(new Set(target.codeIds));
                target.text = doc.content.substring(a, b);
                target.modified = now;
                changed = true;
            }
        } else {
            nextSegments.push({
                id: nextSegId(),
                docId: doc.id,
                text: doc.content.substring(a, b),
                codeIds: [codeId],
                startIndex: a,
                endIndex: b,
                created: now,
                modified: now
            });
            changed = true;
        }
    });

    appData.segments = nextSegments;
    coalesceExactTextSegments();
    pruneTinyTextSegments();
    return { changed, skippedTiny: false };
}

// Apply a single code to the currently stored selection (click-to-code workflow)
function applyCodeToStoredSelection(codeId, options = {}) {
    if (!appData.currentDocId || appData.filterCodeId) return;

    const sel = appData.selectedText;
    if (!sel) return;
    const preserveCaretAfterApply = !!options.preserveCaretAfterApply;
    const preserveCaretCharIndex = Number.isFinite(Number(sel.endIndex))
        ? Number(sel.endIndex)
        : (Number.isFinite(Number(sel.startIndex)) ? Number(sel.startIndex) : 0);

    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const isPdfRegion = sel.kind === 'pdfRegion' && sel.pdfRegion;
    if (isPdfRegion && !sel.pdfRegion) return;
    if (!isPdfRegion && (sel.startIndex === undefined || sel.endIndex === undefined)) return;

    // Merge/toggle for PDF region or text range
    let segment = null;
    if (isPdfRegion) {
        segment = appData.segments.find(s =>
            s.docId === doc.id &&
            s.pdfRegion &&
            regionsEqualForSegment(s.pdfRegion, sel.pdfRegion)
        );
    }

    let codeApplied = false;
    if (!isPdfRegion) {
        const normalized = normalizeTextSelectionForCoding(doc, sel);
        if (!normalized) {
            appData.selectedText = null;
            const nativeSelection = window.getSelection();
            if (nativeSelection) nativeSelection.removeAllRanges();
            return;
        }

        if (isTinyTextRange(normalized.startIndex, normalized.endIndex)) {
            // Keep going: tiny ranges may still remove existing coding.
            // Addition of tiny new coding is blocked in toggleCodeForTextRange.
        }

        // Save history before making changes
        saveHistory();
        const code = appData.codes.find(c => c.id === codeId);
        if (code) code.lastUsed = new Date().toISOString();

        appData.selectedText = {
            text: normalized.text,
            startIndex: normalized.startIndex,
            endIndex: normalized.endIndex
        };
        const result = toggleCodeForTextRange(doc, normalized.startIndex, normalized.endIndex, codeId);
        if (!result.changed) {
            appData.selectedText = null;
            const nativeSelection = window.getSelection();
            if (nativeSelection) nativeSelection.removeAllRanges();
            return;
        }
        codeApplied = true;
    } else if (segment) {
        // Save history before making changes
        saveHistory();
        const code = appData.codes.find(c => c.id === codeId);
        if (code) code.lastUsed = new Date().toISOString();
        if (segment.codeIds.includes(codeId)) {
            // Toggle off: remove only the specific code (not parent codes)
            segment.codeIds = segment.codeIds.filter(id => id !== codeId);
            // If no codes remain, remove the segment entirely
            if (segment.codeIds.length === 0) {
                appData.segments = appData.segments.filter(s => s.id !== segment.id);
            }
        } else {
            // Add only the selected code (no automatic parent propagation)
            segment.codeIds.push(codeId);
            if (typeof sel.text === 'string') {
                segment.text = sel.text;
            }
            codeApplied = true;
        }
    } else {
        // Save history before making changes
        saveHistory();
        const code = appData.codes.find(c => c.id === codeId);
        if (code) code.lastUsed = new Date().toISOString();
        segment = {
            id: 'seg_' + Date.now(),
            docId: doc.id,
            text: typeof sel.text === 'string' && sel.text.length > 0
                ? sel.text
                : `[PDF region: page ${sel.pdfRegion.pageNum}]`,
            codeIds: [codeId],
            startIndex: 0,
            endIndex: 1,
            pdfRegion: Object.assign({}, sel.pdfRegion),
            created: new Date().toISOString()
        };
        appData.segments.push(segment);
        codeApplied = true;
    }

    const contentBody = document.querySelector('.content-body');
    const preservedScrollTop = contentBody ? contentBody.scrollTop : 0;
    const pdfContainer = document.getElementById('pdfContainer');
    const preservedPdfScrollTop = pdfContainer ? pdfContainer.scrollTop : 0;
    const preservedPage = isPdfRegion ? (sel.pdfRegion.pageNum || currentPdfState.currentPage || 1) : currentPdfState.currentPage;

    saveData();
    if (isPdfRegion) {
        renderDocuments();
        renderCodes();
        if (doc && typeof renderPdfPage === 'function') {
            renderPdfPage(preservedPage, doc);
        }
        setTimeout(() => {
            const body = document.querySelector('.content-body');
            if (body) body.scrollTop = preservedScrollTop;
            const c = document.getElementById('pdfContainer');
            if (c) c.scrollTop = preservedPdfScrollTop;
        }, 0);
    } else {
        renderAll();
    }

    if (isPdfRegion && codeApplied && segment && segment.codeIds && segment.codeIds.length > 0) {
        const appliedCode = appData.codes.find(c => c.id === codeId);
        if (typeof setPdfSelectionStatus === 'function') {
            setPdfSelectionStatus('Code applied. Add annotation in the note field (optional).', 'selected', 2200);
        }
        showPdfRegionAnnotationInline(segment, {
            title: 'Region coded. Add annotation (optional)',
            placeholder: appliedCode ? `Why this matters for ${appliedCode.name}...` : 'Why this region matters...',
            selectedCodeId: codeId,
            selectedCodeName: appliedCode?.name || ''
        });
    }

    // Applying a code should clear selection state (both stored and native).
    if (!isPdfRegion) {
        appData.selectedText = null;
        const nativeSelection = window.getSelection();
        if (nativeSelection) nativeSelection.removeAllRanges();
        if (preserveCaretAfterApply && typeof showReadOnlyTextViewerCaret === 'function') {
            requestAnimationFrame(() => {
                const contentElement = document.getElementById('documentContent');
                showReadOnlyTextViewerCaret(contentElement);
                if (!contentElement || typeof getTextNodeBoundaryAtChar !== 'function') return;
                const boundary = getTextNodeBoundaryAtChar(contentElement, Math.max(0, preserveCaretCharIndex));
                if (!boundary || !boundary.node) return;
                const caretSelection = window.getSelection();
                if (!caretSelection) return;
                const caretRange = document.createRange();
                caretRange.setStart(boundary.node, boundary.offset);
                caretRange.collapse(true);
                caretSelection.removeAllRanges();
                caretSelection.addRange(caretRange);
            });
        }
    } else if (typeof clearPendingPdfRegionSelection === 'function') {
        clearPendingPdfRegionSelection();
        appData.selectedText = null;
    }
}

// Calculate the actual character position in the original document text
function getTextPosition(container, range, docContent) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_ACCEPT;
            if (p.classList.contains('memo-indicator') || p.classList.contains('code-actions')) return NodeFilter.FILTER_REJECT;
            if (p.closest && p.closest('.code-actions')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    let startIndex = null;
    let endIndex = null;
    let idx = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.nodeValue || '';
        const len = text.length;

        if (startIndex === null && node === range.startContainer) {
            startIndex = idx + Math.max(0, Math.min(range.startOffset, len));
        }
        if (endIndex === null && node === range.endContainer) {
            endIndex = idx + Math.max(0, Math.min(range.endOffset, len));
        }

        idx += len;

        if (startIndex !== null && endIndex !== null) break;
    }

    // Fallbacks if boundaries are element nodes (should be rare with pre-wrap)
    if (startIndex === null) startIndex = 0;
    if (endIndex === null) endIndex = startIndex + range.toString().length;

    startIndex = Math.max(0, Math.min(startIndex, docContent.length));
    endIndex = Math.max(0, Math.min(endIndex, docContent.length));

    if (endIndex <= startIndex) return null;
    return { start: startIndex, end: endIndex };
}

function openCodeSelectionModal() {
    const modal = document.getElementById('codeSelectionModal');
    const list = document.getElementById('codeSelectionList');
    
    if (appData.codes.length === 0) {
        alert('Please create at least one code first.');
        return;
    }
    
    list.innerHTML = appData.codes.map(code => `
        <label class="code-checkbox">
            <input type="checkbox" value="${escapeHtmlAttrValue(code.id)}">
            <div class="code-color" style="background: ${escapeHtmlAttrValue(code.color)};"></div>
            <span>${escapeHtml(code.name)}</span>
        </label>
    `).join('');
    
    modal.classList.add('show');
}

function closeCodeSelectionModal() {
    document.getElementById('codeSelectionModal').classList.remove('show');
    appData.selectedText = null;
    window.getSelection().removeAllRanges();
}

function applySelectedCodes() {
    const checkboxes = document.querySelectorAll('#codeSelectionList input[type="checkbox"]:checked');
    const selectedCodeIds = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedCodeIds.length === 0) {
        alert('Please select at least one code.');
        return;
    }
    
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const selectedText = appData.selectedText;
    
    if (!selectedText || selectedText.startIndex === undefined) {
        alert('Could not locate selected text in document.');
        closeCodeSelectionModal();
        return;
    }

    const normalized = normalizeTextSelectionForCoding(doc, selectedText);
    if (!normalized || isTinyTextRange(normalized.startIndex, normalized.endIndex)) {
        closeCodeSelectionModal();
        return;
    }
    
    // Save history before making changes
    saveHistory();
    
    // Apply only explicitly selected codes
    const allCodeIds = new Set(selectedCodeIds);
    
    // Update lastUsed for all applied codes
    allCodeIds.forEach(codeId => {
        const code = appData.codes.find(c => c.id === codeId);
        if (code) {
            code.lastUsed = new Date().toISOString();
        }
    });
    
    let segment = appData.segments.find(s =>
        s.docId === doc.id &&
        !s.pdfRegion &&
        Number(s.startIndex) === normalized.startIndex &&
        Number(s.endIndex) === normalized.endIndex
    );

    if (segment) {
        segment.codeIds = Array.from(new Set([...(segment.codeIds || []), ...allCodeIds]));
        segment.text = normalized.text;
        segment.modified = new Date().toISOString();
    } else {
        segment = {
            id: 'seg_' + Date.now(),
            docId: doc.id,
            text: normalized.text,
            codeIds: [...allCodeIds],
            startIndex: normalized.startIndex,
            endIndex: normalized.endIndex,
            created: new Date().toISOString()
        };
        appData.segments.push(segment);
    }
    coalesceExactTextSegments();
    pruneTinyTextSegments();
    saveData();
    closeCodeSelectionModal();
    renderAll();
}

// Quick apply code using keyboard shortcut
function quickApplyCode(codeId) {
    if (!appData.currentDocId || appData.filterCodeId) return;

    const stored = appData.selectedText;
    if (stored && stored.kind === 'pdfRegion' && stored.pdfRegion) {
        applyCodeToStoredSelection(codeId);
        return;
    }
    
    const selection = window.getSelection();
    if (!selection) return;
    const text = selection.toString().trim();
    if (text.length === 0 || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const contentElement = document.getElementById('documentContent');
    if (!doc || !contentElement || typeof doc.content !== 'string') return;
    const position = getTextPosition(contentElement, range, doc.content);
    if (!position) return;

    appData.selectedText = {
        text: doc.content.substring(position.start, position.end),
        startIndex: position.start,
        endIndex: position.end
    };
    applyCodeToStoredSelection(codeId, { preserveCaretAfterApply: true });
}

// Handle editing/removing overlapping segments
function editSegmentGroup(segmentIds, e) {
    e.stopPropagation();
    const ids = segmentIds.split(',');
    const segments = ids.map(id => appData.segments.find(s => s.id === id)).filter(Boolean);
    
    if (segments.length === 0) return;
    
    if (segments.length === 1) {
        saveHistory();
        appData.segments = appData.segments.filter(s => s.id !== segments[0].id);
        saveData();
        renderAll();
    } else {
        saveHistory();
        appData.segments = appData.segments.filter(s => !ids.includes(s.id));
        saveData();
        renderAll();
    }
}

function removeCodeFromSegmentGroup(segmentIds, codeId) {
    const ids = String(segmentIds || '').split(',').map(id => id.trim()).filter(Boolean);
    if (!ids.length || !codeId) return;

    const idSet = new Set(ids);
    const targetSegments = appData.segments.filter((segment) => (
        segment &&
        idSet.has(segment.id) &&
        Array.isArray(segment.codeIds) &&
        segment.codeIds.includes(codeId)
    ));
    if (targetSegments.length === 0) return;

    saveHistory();
    let changed = false;
    const targetIdSet = new Set(targetSegments.map(segment => segment.id));
    appData.segments = appData.segments.filter((segment) => {
        if (!segment || !targetIdSet.has(segment.id) || !Array.isArray(segment.codeIds)) return true;
        const nextCodeIds = segment.codeIds.filter(id => id !== codeId);
        if (nextCodeIds.length === segment.codeIds.length) return true;
        changed = true;
        if (nextCodeIds.length === 0) return false;
        segment.codeIds = nextCodeIds;
        segment.modified = new Date().toISOString();
        return true;
    });

    if (!changed) return;
    coalesceExactTextSegments();
    pruneTinyTextSegments();
    saveData();
    renderAll();
}

function resolveSegmentElementFromContextEvent(event) {
    const target = event?.target;
    if (target && typeof target.closest === 'function') {
        const found = target.closest('.coded-segment');
        if (found) return found;
    }
    const current = event?.currentTarget;
    if (current && current !== document && typeof current.closest === 'function') {
        const found = current.closest('.coded-segment');
        if (found) return found;
    }
    if (current && current !== document && current.classList?.contains?.('coded-segment')) {
        return current;
    }
    return null;
}

// Segment action modal
function showSegmentMenu(segmentIds, event) {
    event.stopPropagation();
    const ids = segmentIds.split(',');
    
    if (ids.length === 1) {
        // Single segment - show modal
        currentSegmentActionIds = segmentIds;
        document.getElementById('segmentActionModal').classList.add('show');
        updateSegmentActionModalLabels(ids[0]);
    } else {
        // Multiple segments - go directly to remove
        editSegmentGroup(segmentIds, event);
    }
}

// Right-click context menu for coded segments
function showSegmentContextMenu(segmentIds, event) {
    event.preventDefault();
    event.stopPropagation();

    const ids = segmentIds.split(',');
    const segments = ids.map(id => appData.segments.find(s => s.id === id)).filter(Boolean);
    if (segments.length === 0) return;

    // Build a label
    const codes = [];
    segments.forEach(seg => {
        seg.codeIds.forEach(codeId => {
            const code = appData.codes.find(c => c.id === codeId);
            if (code && !codes.find(c => c.id === code.id)) codes.push(code);
        });
    });

    const segmentEl = resolveSegmentElementFromContextEvent(event);
    const codeIdsFromSpan = String(segmentEl?.dataset?.codeIds || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    const codeMap = new Map(codes.map(code => [code.id, code]));
    const orderedCodes = [];
    const seenCodeIds = new Set();
    codeIdsFromSpan.forEach((id) => {
        const code = codeMap.get(id);
        if (!code || seenCodeIds.has(id)) return;
        seenCodeIds.add(id);
        orderedCodes.push(code);
    });
    codes.forEach((code) => {
        if (seenCodeIds.has(code.id)) return;
        seenCodeIds.add(code.id);
        orderedCodes.push(code);
    });

    let selectedCode = orderedCodes[0] || null;
    if (segmentEl && typeof segmentEl.getClientRects === 'function' && orderedCodes.length > 1) {
        const lineRects = Array.from(segmentEl.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
        const clickRect = lineRects.find(rect => event.clientY >= rect.top && event.clientY <= rect.bottom)
            || lineRects[0]
            || segmentEl.getBoundingClientRect();
        const width = Math.max(1, clickRect.width || 0);
        const x = Math.max(0, Math.min(width - 0.001, event.clientX - clickRect.left));
        const idx = Math.max(0, Math.min(orderedCodes.length - 1, Math.floor((x / width) * orderedCodes.length)));
        selectedCode = orderedCodes[idx] || selectedCode;
    }

    const selectedCodeId = selectedCode?.id || '';
    const selectedCodeName = selectedCode?.name || '';
    const label = codes.length ? codes.map(c => c.name).join(', ') : 'Coding';
    const hasMultipleCodes = orderedCodes.length > 1;
    const primarySegment = segments[0];
    const selectedCodeSegment = selectedCodeId
        ? (segments.find(seg => Array.isArray(seg.codeIds) && seg.codeIds.includes(selectedCodeId)) || primarySegment)
        : primarySegment;
    const annotationLabel = selectedCodeName ? `Annotations • ${selectedCodeName}` : `Annotations • ${label}`;
    const menuItems = [
        {
            label: selectedCodeName ? `Coding inspector • ${selectedCodeName}` : 'Coding inspector',
            onClick: () => {
                if (!selectedCodeSegment || typeof openCodingInspectorForSegment !== 'function') return;
                openCodingInspectorForSegment(selectedCodeSegment.id, selectedCodeId);
            }
        },
        { type: 'sep' },
        {
            label: annotationLabel,
            onClick: () => showPdfRegionAnnotationInline(selectedCodeSegment, {
                title: selectedCodeName ? `Annotations • ${selectedCodeName}` : 'Annotations',
                placeholder: selectedCodeName ? `Add annotation for ${selectedCodeName} (optional)...` : 'Add annotation (optional)...',
                selectedCodeId,
                selectedCodeName
            })
        }
    ];

    if (segments.length === 1 && primarySegment && !primarySegment.pdfRegion) {
        menuItems.push({ label: `Edit boundaries • ${label}`, onClick: () => openEditBoundariesModal(primarySegment.id) });
    }

    menuItems.push({ type: 'sep' });
    menuItems.push({
        label: hasMultipleCodes && selectedCodeName ? `Remove coding • ${selectedCodeName}` : `Remove coding • ${label}`,
        onClick: () => {
            if (hasMultipleCodes && selectedCodeId) {
                removeCodeFromSegmentGroup(segmentIds, selectedCodeId);
                return;
            }
            editSegmentGroup(segmentIds, { stopPropagation: () => {} });
        },
        danger: true
    });
    if (hasMultipleCodes) {
        menuItems.push({
            label: 'Remove all coding',
            onClick: () => editSegmentGroup(segmentIds, { stopPropagation: () => {} }),
            danger: true
        });
    }

    showContextMenu(menuItems, event.clientX, event.clientY);
}

function updateSegmentActionModalLabels(segmentId) {
    let memoBtn = document.querySelector('#segmentActionModal [data-action="memo"]');
    if (!memoBtn) memoBtn = document.querySelector('#segmentActionModal button[onclick*="segmentActionChoice(\'memo\')"]');
    if (memoBtn) memoBtn.textContent = 'Annotations';
}

function closeSegmentActionModal() {
    document.getElementById('segmentActionModal').classList.remove('show');
    currentSegmentActionIds = null;
}

function segmentActionChoice(action) {
    const segmentIds = currentSegmentActionIds;
    const ids = segmentIds.split(',');
    closeSegmentActionModal();

    if (action === 'memo') {
        const segment = appData.segments.find(s => s.id === ids[0]);
        if (segment) {
            showPdfRegionAnnotationInline(segment, { title: 'Annotations', placeholder: 'Add annotation (optional)...' });
        }
    } else if (action === 'edit') {
        openEditBoundariesModal(ids[0]);
    } else if (action === 'remove') {
        editSegmentGroup(segmentIds, { stopPropagation: () => {} });
    }
}

function openEditBoundariesModal(segmentId) {
    currentEditSegment = appData.segments.find(s => s.id === segmentId);
    if (!currentEditSegment) return;
    if (currentEditSegment.pdfRegion) {
        alert('Boundary editing is not available for PDF region codings.');
        currentEditSegment = null;
        return;
    }
    
    const modal = document.getElementById('editBoundariesModal');
    document.getElementById('boundaryStart').value = currentEditSegment.startIndex;
    document.getElementById('boundaryEnd').value = currentEditSegment.endIndex;
    
    updateBoundaryPreview();
    modal.classList.add('show');
}

function closeEditBoundariesModal() {
    document.getElementById('editBoundariesModal').classList.remove('show');
    currentEditSegment = null;
}

function updateBoundaryPreview() {
    if (!currentEditSegment) return;
    
    const doc = appData.documents.find(d => d.id === currentEditSegment.docId);
    if (!doc) return;
    
    const start = parseInt(document.getElementById('boundaryStart').value);
    const end = parseInt(document.getElementById('boundaryEnd').value);
    
    const before = doc.content.substring(Math.max(0, start - 50), start);
    const selected = doc.content.substring(start, end);
    const after = doc.content.substring(end, Math.min(doc.content.length, end + 50));
    
    const preview = document.getElementById('boundaryPreview');
    preview.innerHTML = `
        ${escapeHtml(before)}<span class="boundary-highlight">${escapeHtml(selected)}</span>${escapeHtml(after)}
    `;
}

function saveBoundaryEdit() {
    if (!currentEditSegment) return;
    
    const doc = appData.documents.find(d => d.id === currentEditSegment.docId);
    if (!doc || typeof doc.content !== 'string') {
        alert('Document for this segment could not be found.');
        return;
    }
    const start = parseInt(document.getElementById('boundaryStart').value);
    const end = parseInt(document.getElementById('boundaryEnd').value);
    
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start < 0 || end > doc.content.length) {
        alert('Invalid boundaries');
        return;
    }
    
    saveHistory();

    currentEditSegment.startIndex = start;
    currentEditSegment.endIndex = end;
    currentEditSegment.text = doc.content.substring(start, end);
    
    saveData();
    closeEditBoundariesModal();
    renderAll();
}
