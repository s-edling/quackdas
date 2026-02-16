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
    if (!sel || sel.startIndex === undefined || sel.endIndex === undefined || !sel.text) return;

    const doc = appData.documents.find(d => d.id === appData.currentDocId);

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
    let segment = appData.segments.find(s =>
        s.docId === doc.id &&
        s.startIndex === sel.startIndex &&
        s.endIndex === sel.endIndex
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
            // Keep text in sync (useful if content changed slightly)
            segment.text = sel.text;
        }
    } else {
        segment = {
            id: 'seg_' + Date.now(),
            docId: doc.id,
            text: sel.text,
            codeIds: [...allCodeIds], // Include parent codes
            startIndex: sel.startIndex,
            endIndex: sel.endIndex,
            created: new Date().toISOString()
        };
        appData.segments.push(segment);
    }

    saveData();
    renderAll();

    // Re-select the same text so the user can apply multiple codes
    restoreSelectionByIndices(sel.startIndex, sel.endIndex);
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

    const hasMemo = appData.memos.some(m => m.type === 'segment' && m.targetId === segments[0].id);

    showContextMenu([
        { label: (hasMemo ? 'View memo' : 'Add memo') + ` • ${label}`, onClick: () => openMemoModal('segment', segments[0].id) },
        { type: 'sep' },
        { label: `Remove coding • ${label}`, onClick: () => editSegmentGroup(segmentIds, { stopPropagation: () => {} }), danger: true }
    ], event.clientX, event.clientY);
}

function updateSegmentActionModalLabels(segmentId) {
    const hasMemo = appData.memos.some(m => m.type === 'segment' && m.targetId === segmentId);
    let memoBtn = document.querySelector('#segmentActionModal [data-action="memo"]');
    if (!memoBtn) memoBtn = document.querySelector('#segmentActionModal button[onclick*="segmentActionChoice(\'memo\')"]');
    if (memoBtn) memoBtn.textContent = hasMemo ? 'View memo' : 'Add memo';
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
        openMemoModal('segment', ids[0]);
    } else if (action === 'edit') {
        openEditBoundariesModal(ids[0]);
    } else if (action === 'remove') {
        editSegmentGroup(segmentIds, { stopPropagation: () => {} });
    }
}

function openEditBoundariesModal(segmentId) {
    currentEditSegment = appData.segments.find(s => s.id === segmentId);
    if (!currentEditSegment) return;
    
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
