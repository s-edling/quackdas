/**
 * Quackdas - Coding Functions
 * Text selection, segment creation, segment editing
 */

// Current segment being edited
let currentEditSegment = null;
let currentSegmentActionIds = null;

// Safety limit to prevent infinite loops
const MAX_CODE_DEPTH = 20;

// Get all parent code IDs for a given code (for hierarchical coding)
function getParentCodeIds(codeId) {
    const parentIds = [];
    const visited = new Set();
    let currentCode = appData.codes.find(c => c.id === codeId);
    
    while (currentCode && currentCode.parentId && parentIds.length < MAX_CODE_DEPTH) {
        if (visited.has(currentCode.parentId)) break; // Cycle detection
        visited.add(currentCode.parentId);
        
        parentIds.push(currentCode.parentId);
        currentCode = appData.codes.find(c => c.id === currentCode.parentId);
    }
    
    return parentIds;
}

// Get a code and all its parent codes
function getCodeWithParents(codeId) {
    return [codeId, ...getParentCodeIds(codeId)];
}

function regionsEqualForSegment(a, b, tolerance = 0.0015) {
    if (!a || !b) return false;
    if (a.pageNum !== b.pageNum) return false;
    return Math.abs((a.xNorm || 0) - (b.xNorm || 0)) <= tolerance &&
        Math.abs((a.yNorm || 0) - (b.yNorm || 0)) <= tolerance &&
        Math.abs((a.wNorm || 0) - (b.wNorm || 0)) <= tolerance &&
        Math.abs((a.hNorm || 0) - (b.hNorm || 0)) <= tolerance;
}

let currentPdfAnnotationSegmentId = null;
let pdfAnnotationOutsideBound = false;
let pdfAnnotationOpenedAt = 0;

function addSegmentMemo(segmentId, text) {
    if (!text) return;
    appData.memos.push({
        id: 'memo_' + Date.now(),
        type: 'segment',
        targetId: segmentId,
        content: text,
        created: new Date().toISOString()
    });
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
    if (saveBtn) saveBtn.addEventListener('click', savePdfRegionAnnotationInline);
    if (skipBtn) skipBtn.addEventListener('click', dismissPdfRegionAnnotationInline);
    if (input) {
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            if (event.shiftKey) return;
            event.preventDefault();
            savePdfRegionAnnotationInline();
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

function renderSegmentAnnotationList(segmentId) {
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (!panel) return;
    const list = panel.querySelector('#pdfRegionAnnotationExisting');
    if (!list) return;

    const memos = getMemosForTarget('segment', segmentId);
    if (memos.length === 0) {
        list.hidden = true;
        list.innerHTML = '';
        return;
    }

    list.hidden = false;
    list.innerHTML = `
        <div class="pdf-region-annotation-existing-title">Existing annotations</div>
        ${memos.map(memo => `<div class="pdf-region-annotation-item">${escapeHtml(memo.content || '')}</div>`).join('')}
    `;
}

function showPdfRegionAnnotationInline(segment, options = {}) {
    if (!segment || !segment.id) return;
    const panel = ensurePdfAnnotationInline();
    const titleEl = panel.querySelector('#pdfRegionAnnotationTitle');
    const input = panel.querySelector('#pdfRegionAnnotationInput');
    currentPdfAnnotationSegmentId = segment.id;
    if (titleEl) {
        titleEl.textContent = options.title || 'Add annotation';
    }
    if (input) {
        input.value = '';
        input.placeholder = options.placeholder || 'Add annotation (optional)...';
        setTimeout(() => input.focus(), 0);
    }
    renderSegmentAnnotationList(segment.id);
    pdfAnnotationOpenedAt = Date.now();
    panel.hidden = false;
}

function savePdfRegionAnnotationInline() {
    if (!currentPdfAnnotationSegmentId) return;
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (!panel) return;
    const input = panel.querySelector('#pdfRegionAnnotationInput');
    const text = (input?.value || '').trim();

    saveHistory();
    addSegmentMemo(currentPdfAnnotationSegmentId, text);
    saveData();
    renderAll();
    dismissPdfRegionAnnotationInline();
}

function dismissPdfRegionAnnotationInline() {
    const panel = document.getElementById('pdfRegionAnnotationInline');
    if (panel) panel.hidden = true;
    currentPdfAnnotationSegmentId = null;
}

// Text selection and coding
function handleTextSelection() {
    if (appData.filterCodeId) return; // Don't allow coding in filter view

    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Clear stored selection if nothing is selected
    if (!text || text.length === 0 || !selection.rangeCount) {
        appData.selectedText = null;
        return;
    }

    const range = selection.getRangeAt(0);
    const doc = appData.documents.find(d => d.id === appData.currentDocId);

    // Calculate actual character positions in the document
    const contentElement = document.getElementById('documentContent');
    const position = getTextPosition(contentElement, range, doc.content);

    if (position) {
        // Store indices (not just a DOM Range) so we can restore selection after re-render
        appData.selectedText = {
            text: text,
            startIndex: position.start,
            endIndex: position.end
        };
    }
}

// Restore selection by character indices (used to keep selection when applying multiple codes)
function restoreSelectionByIndices(startIndex, endIndex) {
    const container = document.getElementById('documentContent');
    if (!container) return;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_ACCEPT;
            if (p.classList.contains('segment-tooltip') || p.classList.contains('memo-indicator') || p.classList.contains('code-actions')) {
                return NodeFilter.FILTER_REJECT;
            }
            // Exclude any UI-only nodes inside coded segments
            if (p.closest && p.closest('.segment-tooltip, .code-actions')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let current = 0;
    let startNode = null, endNode = null;
    let startOffset = 0, endOffset = 0;

    while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = (node.nodeValue || '').length;

        if (startNode === null && current + len >= startIndex) {
            startNode = node;
            startOffset = Math.max(0, startIndex - current);
        }
        if (current + len >= endIndex) {
            endNode = node;
            endOffset = Math.max(0, endIndex - current);
            break;
        }
        current += len;
    }

    if (startNode && endNode) {
        const range = document.createRange();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

// Apply a single code to the currently stored selection (click-to-code workflow)
function applyCodeToStoredSelection(codeId) {
    if (!appData.currentDocId || appData.filterCodeId) return;

    const sel = appData.selectedText;
    if (!sel) return;

    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const isPdfRegion = sel.kind === 'pdfRegion' && sel.pdfRegion;
    if (isPdfRegion && !sel.pdfRegion) return;
    if (!isPdfRegion && !sel.text) return;
    if (!isPdfRegion && (sel.startIndex === undefined || sel.endIndex === undefined)) return;

    // Save history before making changes
    saveHistory();

    // Update code lastUsed
    const code = appData.codes.find(c => c.id === codeId);
    if (code) {
        code.lastUsed = new Date().toISOString();
    }

    // Get all codes to apply (including parent codes for hierarchical coding)
    const allCodeIds = getCodeWithParents(codeId);

    // Merge into existing segment if boundaries match; otherwise create a new segment
    let segment = null;
    if (isPdfRegion) {
        segment = appData.segments.find(s =>
            s.docId === doc.id &&
            s.pdfRegion &&
            regionsEqualForSegment(s.pdfRegion, sel.pdfRegion)
        );
    } else {
        segment = appData.segments.find(s =>
            s.docId === doc.id &&
            s.startIndex === sel.startIndex &&
            s.endIndex === sel.endIndex
        );
    }

    let codeApplied = false;
    if (segment) {
        if (segment.codeIds.includes(codeId)) {
            // Toggle off: remove only the specific code (not parent codes)
            segment.codeIds = segment.codeIds.filter(id => id !== codeId);
            // If no codes remain, remove the segment entirely
            if (segment.codeIds.length === 0) {
                appData.segments = appData.segments.filter(s => s.id !== segment.id);
            }
        } else {
            // Add the code and all parent codes (if not already present)
            allCodeIds.forEach(id => {
                if (!segment.codeIds.includes(id)) {
                    segment.codeIds.push(id);
                }
            });
            // Keep text in sync (useful if content changed slightly)
            if (typeof sel.text === 'string') {
                segment.text = sel.text;
            }
            codeApplied = true;
        }
    } else {
        segment = {
            id: 'seg_' + Date.now(),
            docId: doc.id,
            text: typeof sel.text === 'string' && sel.text.length > 0
                ? sel.text
                : `[PDF region: page ${sel.pdfRegion.pageNum}]`,
            codeIds: [...allCodeIds], // Include parent codes
            startIndex: isPdfRegion ? 0 : sel.startIndex,
            endIndex: isPdfRegion ? 1 : sel.endIndex,
            pdfRegion: isPdfRegion ? Object.assign({}, sel.pdfRegion) : undefined,
            created: new Date().toISOString()
        };
        appData.segments.push(segment);
        codeApplied = true;
    }

    const contentBody = document.querySelector('.content-body');
    const preservedScrollTop = contentBody ? contentBody.scrollTop : 0;
    const preservedPage = currentPdfState.currentPage;

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
        }, 0);
    } else {
        renderAll();
    }

    if (isPdfRegion && codeApplied && segment && segment.codeIds && segment.codeIds.length > 0) {
        if (typeof setPdfSelectionStatus === 'function') {
            setPdfSelectionStatus('Code applied. Add annotation in the note field (optional).', 'selected', 2200);
        }
        showPdfRegionAnnotationInline(segment, {
            title: 'Region coded. Add annotation (optional)',
            placeholder: 'Why this region matters...'
        });
    }

    // Re-select the same text so the user can apply multiple codes
    if (!isPdfRegion) {
        restoreSelectionByIndices(sel.startIndex, sel.endIndex);
    } else if (typeof clearPendingPdfRegionSelection === 'function') {
        clearPendingPdfRegionSelection();
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
            <input type="checkbox" value="${code.id}">
            <div class="code-color" style="background: ${code.color};"></div>
            <span>${code.name}</span>
        </label>
    `).join('');
    
    modal.classList.add('show');
}

function closeCodeSelectionModal() {
    document.getElementById('codeSelectionModal').classList.remove('show');
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
    
    // Save history before making changes
    saveHistory();
    
    // Build full list including parent codes
    const allCodeIds = new Set();
    selectedCodeIds.forEach(codeId => {
        getCodeWithParents(codeId).forEach(id => allCodeIds.add(id));
    });
    
    // Update lastUsed for all applied codes
    allCodeIds.forEach(codeId => {
        const code = appData.codes.find(c => c.id === codeId);
        if (code) {
            code.lastUsed = new Date().toISOString();
        }
    });
    
    const segment = {
        id: 'seg_' + Date.now(),
        docId: doc.id,
        text: selectedText.text,
        codeIds: [...allCodeIds],
        startIndex: selectedText.startIndex,
        endIndex: selectedText.endIndex,
        created: new Date().toISOString()
    };
    
    appData.segments.push(segment);
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
    const text = selection.toString().trim();
    
    if (text.length === 0 || !selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const contentElement = document.getElementById('documentContent');
    const position = getTextPosition(contentElement, range, doc.content);
    
    if (!position) return;
    
    saveHistory();
    
    // Update code lastUsed
    const code = appData.codes.find(c => c.id === codeId);
    if (code) {
        code.lastUsed = new Date().toISOString();
    }
    
    // Get all codes to apply (including parent codes for hierarchical coding)
    const allCodeIds = getCodeWithParents(codeId);
    
    // Check if segment with same boundaries already exists
    let segment = appData.segments.find(s =>
        s.docId === doc.id &&
        s.startIndex === position.start &&
        s.endIndex === position.end
    );
    
    if (segment) {
        if (segment.codeIds.includes(codeId)) {
            // Toggle off: remove only the specific code (not parent codes)
            segment.codeIds = segment.codeIds.filter(id => id !== codeId);
            // If no codes remain, remove the segment entirely
            if (segment.codeIds.length === 0) {
                appData.segments = appData.segments.filter(s => s.id !== segment.id);
            }
        } else {
            // Add the code and all parent codes (if not already present)
            allCodeIds.forEach(id => {
                if (!segment.codeIds.includes(id)) {
                    segment.codeIds.push(id);
                }
            });
            // Keep text in sync
            segment.text = text;
        }
    } else {
        segment = {
            id: 'seg_' + Date.now(),
            docId: doc.id,
            text: text,
            codeIds: [...allCodeIds],
            startIndex: position.start,
            endIndex: position.end,
            created: new Date().toISOString()
        };
        appData.segments.push(segment);
    }
    
    saveData();
    renderAll();
    
    // Clear selection
    window.getSelection().removeAllRanges();
}

// Handle editing/removing overlapping segments
function editSegmentGroup(segmentIds, e) {
    e.stopPropagation();
    const ids = segmentIds.split(',');
    const segments = ids.map(id => appData.segments.find(s => s.id === id)).filter(Boolean);
    
    if (segments.length === 0) return;
    
    if (segments.length === 1) {
        if (confirm('Remove coding from this segment?')) {
            saveHistory();
            appData.segments = appData.segments.filter(s => s.id !== segments[0].id);
            saveData();
            renderAll();
        }
    } else {
        // Multiple overlapping segments
        const codes = [];
        segments.forEach(seg => {
            seg.codeIds.forEach(codeId => {
                const code = appData.codes.find(c => c.id === codeId);
                if (code && !codes.find(c => c.id === code.id)) {
                    codes.push(code);
                }
            });
        });
        
        const message = `This text has ${segments.length} overlapping code segments:\n\n` +
            codes.map(c => `• ${c.name}`).join('\n') +
            `\n\nRemove ALL codings from this text?`;
        
        if (confirm(message)) {
            saveHistory();
            appData.segments = appData.segments.filter(s => !ids.includes(s.id));
            saveData();
            renderAll();
        }
    }
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

    const label = codes.length ? codes.map(c => c.name).join(', ') : 'Coding';

    showContextMenu([
        { label: `Annotations • ${label}`, onClick: () => showPdfRegionAnnotationInline(segments[0], { title: 'Annotations', placeholder: 'Add annotation (optional)...' }) },
        { type: 'sep' },
        { label: `Remove coding • ${label}`, onClick: () => editSegmentGroup(segmentIds, { stopPropagation: () => {} }), danger: true }
    ], event.clientX, event.clientY);
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
    
    const start = parseInt(document.getElementById('boundaryStart').value);
    const end = parseInt(document.getElementById('boundaryEnd').value);
    
    if (start >= end || start < 0 || end > appData.documents.find(d => d.id === currentEditSegment.docId).content.length) {
        alert('Invalid boundaries');
        return;
    }
    
    saveHistory();
    
    const doc = appData.documents.find(d => d.id === currentEditSegment.docId);
    currentEditSegment.startIndex = start;
    currentEditSegment.endIndex = end;
    currentEditSegment.text = doc.content.substring(start, end);
    
    saveData();
    closeEditBoundariesModal();
    renderAll();
}
