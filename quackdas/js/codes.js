/**
 * Quackdas - Code Management
 * Code CRUD, filtering, drag-and-drop reordering
 */

// Drag-and-drop state
let draggedCodeId = null;

function openCodeModal() {
    document.getElementById('codeModal').classList.add('show');
}

function closeCodeModal() {
    document.getElementById('codeModal').classList.remove('show');
    document.getElementById('codeName').value = '';
    document.getElementById('codeDescription').value = '';
    document.getElementById('codeShortcut').value = '';
    document.getElementById('parentCode').value = '';
}

function saveCode(e) {
    e.preventDefault();
    const name = document.getElementById('codeName').value;
    const description = document.getElementById('codeDescription').value;
    const shortcut = document.getElementById('codeShortcut').value;
    const parentId = document.getElementById('parentCode').value || null;
    
    saveHistory();
    
    const code = {
        id: 'code_' + Date.now(),
        name: name,
        description: description,
        notes: '',
        shortcut: shortcut,
        parentId: parentId,
        color: codeColors[colorIndex % codeColors.length],
        created: new Date().toISOString(),
        lastUsed: new Date().toISOString()
    };
    
    colorIndex++;
    appData.codes.push(code);
    saveData();
    renderCodes();
    closeCodeModal();
}

function deleteCode(codeId, e) {
    e.stopPropagation();
    if (!confirm('Delete this code? Segments will lose this coding.')) return;
    
    saveHistory();

    const codeIdsToDelete = new Set([codeId]);
    let changed = true;
    while (changed) {
        changed = false;
        appData.codes.forEach((code) => {
            if (!code || !code.parentId || codeIdsToDelete.has(code.id)) return;
            if (!codeIdsToDelete.has(code.parentId)) return;
            codeIdsToDelete.add(code.id);
            changed = true;
        });
    }
    
    // Remove deleted codes from all segments
    appData.segments.forEach(segment => {
        segment.codeIds = segment.codeIds.filter(id => !codeIdsToDelete.has(id));
    });
    
    // Remove segments with no codes
    appData.segments = appData.segments.filter(s => s.codeIds.length > 0);

    // Remove all deleted codes from code list
    appData.codes = appData.codes.filter(c => !codeIdsToDelete.has(c.id));
    if (appData.filterCodeId && codeIdsToDelete.has(appData.filterCodeId)) {
        appData.filterCodeId = null;
    }

    // Remove code annotations that target deleted codes.
    // Segment annotations scoped to deleted codes are also removed.
    appData.memos = appData.memos.filter((memo) => {
        if (memo.type === 'code' && codeIdsToDelete.has(memo.targetId)) return false;
        const scopedCodeId = String(memo?.codeId || '').trim();
        if (memo.type === 'segment' && scopedCodeId && codeIdsToDelete.has(scopedCodeId)) return false;
        return true;
    });
    
    saveData();
    renderAll();
}

async function renameCode(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;
    
    const newName = await openTextPrompt('Rename Code', code.name);
    if (newName && newName !== code.name) {
        saveHistory();
        code.name = newName;
        saveData();
        renderAll();
    }
}

async function assignShortcut(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;
    
    const currentShortcut = code.shortcut || '';
    const newShortcut = await openTextPrompt('Assign Shortcut (1-9, or leave empty to remove)', currentShortcut);
    
    if (newShortcut === null) return; // Cancelled
    
    const trimmed = newShortcut.trim();
    
    // Validate: must be empty or a single digit 1-9
    if (trimmed !== '' && (!/^[1-9]$/.test(trimmed))) {
        alert('Shortcut must be a single digit from 1 to 9.');
        return;
    }
    
    // Check if shortcut is already in use by another code
    if (trimmed !== '') {
        const existingCode = appData.codes.find(c => c.shortcut === trimmed && c.id !== codeId);
        if (existingCode) {
            const confirmReassign = confirm(`Shortcut "${trimmed}" is currently assigned to "${existingCode.name}". Reassign it to "${code.name}"?`);
            if (!confirmReassign) return;
            // Remove from existing code
            saveHistory();
            existingCode.shortcut = '';
        } else {
            saveHistory();
        }
    } else {
        saveHistory();
    }
    
    code.shortcut = trimmed;
    saveData();
    renderAll();
}

function filterByCode(codeId, e) {
    e.stopPropagation();
    appData.selectedCaseId = null;

    // If the user has a stored selection, clicking a code applies it.
    // Hold Shift/Alt/Ctrl/Cmd to force filter behaviour instead.
    const sel = appData.selectedText;
    const hasTextSelection = !!(sel && typeof sel.text === 'string' && sel.text.length > 0 &&
        sel.startIndex !== undefined && sel.endIndex !== undefined);
    const hasPdfRegionSelection = !!(sel && sel.kind === 'pdfRegion' && sel.pdfRegion);
    const hasStoredSelection = hasTextSelection || hasPdfRegionSelection;
    const forceFilter = e.shiftKey || e.altKey || e.ctrlKey || e.metaKey;
    if (hasStoredSelection && !forceFilter) {
        applyCodeToStoredSelection(codeId);
        return;
    }

    // --- Filter behaviour (existing functionality) ---
    // Save current scroll position only when entering filter mode (not already filtered)
    if (appData.currentDocId && !appData.filterCodeId) {
        const contentBody = document.querySelector('.content-body');
        if (contentBody) {
            appData.scrollPositions[appData.currentDocId] = contentBody.scrollTop;
        }
    }

    if (appData.filterCodeId === codeId) {
        appData.filterCodeId = null;
        if (typeof codeViewUiState === 'object' && codeViewUiState) {
            codeViewUiState.notesExpanded = false;
        }
    } else {
        appData.filterCodeId = codeId;
        if (typeof codeViewUiState === 'object' && codeViewUiState) {
            codeViewUiState.segmentsIncludeSubcodes = false;
            codeViewUiState.notesExpanded = false;
        }
    }
    renderAll();

    // Restore scroll position when clearing filter
    if (!appData.filterCodeId && appData.currentDocId) {
        setTimeout(() => {
            const contentBody = document.querySelector('.content-body');
            if (contentBody) {
                const savedPosition = appData.scrollPositions[appData.currentDocId] || 0;
                contentBody.scrollTop = savedPosition;
            }
        }, 0);
    }
}

function clearFilter() {
    // Don't save scroll position when in filtered view
    
    appData.filterCodeId = null;
    renderAll();
    
    // Restore scroll position
    if (appData.currentDocId) {
        setTimeout(() => {
            const contentBody = document.querySelector('.content-body');
            if (contentBody) {
                const savedPosition = appData.scrollPositions[appData.currentDocId] || 0;
                contentBody.scrollTop = savedPosition;
            }
        }, 0);
    }
}

function wouldCreateCodeCycle(codeId, nextParentId) {
    if (!nextParentId || !codeId) return false;
    if (codeId === nextParentId) return true;

    const visited = new Set([codeId]);
    let cursor = nextParentId;
    while (cursor) {
        if (visited.has(cursor)) return true;
        visited.add(cursor);
        const parent = appData.codes.find(c => c.id === cursor);
        if (!parent) return false;
        cursor = parent.parentId || null;
    }
    return false;
}

function getOrderedCodesForParent(parentId) {
    return appData.codes
        .filter((code) => (code.parentId || null) === (parentId || null))
        .sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(a.created || 0) - new Date(b.created || 0);
        });
}

function reindexCodeSortOrderForParent(parentId) {
    const siblings = getOrderedCodesForParent(parentId);
    siblings.forEach((code, idx) => {
        code.sortOrder = idx;
    });
}

function moveCodeToParent(codeId, nextParentId, options = {}) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;

    const normalizedParent = nextParentId || null;
    const targetCodeId = options.targetCodeId || null;
    const placeAfter = !!options.placeAfter;
    if (normalizedParent && !appData.codes.some(c => c.id === normalizedParent)) return;
    if (wouldCreateCodeCycle(codeId, normalizedParent)) {
        alert('That move would create a code hierarchy cycle.');
        return;
    }

    const previousParentId = code.parentId || null;
    const needsParentChange = previousParentId !== normalizedParent;
    const needsSiblingReorder = !!targetCodeId && !needsParentChange;
    if (!needsParentChange && !needsSiblingReorder) return;

    saveHistory();
    code.parentId = normalizedParent;

    const siblings = getOrderedCodesForParent(normalizedParent).filter((item) => item.id !== codeId);
    if (targetCodeId) {
        const targetIndex = siblings.findIndex((item) => item.id === targetCodeId);
        if (targetIndex >= 0) {
            const insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
            siblings.splice(insertIndex, 0, code);
        } else {
            siblings.push(code);
        }
    } else {
        siblings.push(code);
    }
    siblings.forEach((item, idx) => {
        item.sortOrder = idx;
    });
    if (previousParentId !== normalizedParent) {
        reindexCodeSortOrderForParent(previousParentId);
    }

    saveData();
    renderCodes();
}

// Drag-and-drop parenting for codes
function setupCodeDragAndDrop() {
    const codesList = document.getElementById('codesList');
    if (!codesList) return;
    const draggableItems = codesList.querySelectorAll('.draggable-code[data-code-id]');
    
    draggableItems.forEach(item => {
        item.addEventListener('dragstart', handleCodeDragStart);
        item.addEventListener('dragend', handleCodeDragEnd);
        item.addEventListener('dragover', handleCodeDragOver);
        item.addEventListener('dragleave', handleCodeDragLeave);
        item.addEventListener('drop', handleCodeDrop);
    });

    // Dropping directly on list background moves to root level.
    codesList.ondragover = handleCodesListDragOver;
    codesList.ondrop = handleCodesListDrop;
}

function getCodeDropIntent(event, targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = rect.height > 0 ? (y / rect.height) : 0.5;
    if (ratio < 0.2) return 'sibling-before';
    if (ratio > 0.8) return 'sibling-after';
    return 'child';
}

function handleCodeDragStart(e) {
    draggedCodeId = e.currentTarget.dataset.codeId;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedCodeId);
}

function handleCodeDragEnd(e) {
    e.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    draggedCodeId = null;
}

function handleCodeDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = e.currentTarget;
    if (target.dataset.codeId === draggedCodeId) return;
    const intent = getCodeDropIntent(e, target);
    target.classList.toggle('drag-over', intent !== 'child');
    target.classList.toggle('drag-over-child', intent === 'child');
}

function handleCodeDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
    e.currentTarget.classList.remove('drag-over-child');
}

function handleCodeDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    e.currentTarget.classList.remove('drag-over-child');
    const targetCodeId = e.currentTarget.dataset.codeId;
    
    if (!draggedCodeId || draggedCodeId === targetCodeId) return;
    const targetCode = appData.codes.find((code) => code.id === targetCodeId);
    if (!targetCode) return;

    const intent = getCodeDropIntent(e, e.currentTarget);
    if (intent === 'child') {
        moveCodeToParent(draggedCodeId, targetCodeId);
        return;
    }

    const nextParentId = targetCode.parentId || null;
    moveCodeToParent(draggedCodeId, nextParentId, {
        targetCodeId,
        placeAfter: intent === 'sibling-after'
    });
}

function handleCodesListDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleCodesListDrop(e) {
    if (!draggedCodeId) return;
    if (e.target && e.target.closest && e.target.closest('.draggable-code[data-code-id]')) return;
    e.preventDefault();
    moveCodeToParent(draggedCodeId, null);
}
