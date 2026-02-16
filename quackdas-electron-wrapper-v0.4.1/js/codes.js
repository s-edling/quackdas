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
    
    // Remove code from all segments
    appData.segments.forEach(segment => {
        segment.codeIds = segment.codeIds.filter(id => id !== codeId);
    });
    
    // Remove segments with no codes
    appData.segments = appData.segments.filter(s => s.codeIds.length > 0);
    
    // Remove child codes
    const childCodes = appData.codes.filter(c => c.parentId === codeId);
    childCodes.forEach(child => {
        appData.segments.forEach(segment => {
            segment.codeIds = segment.codeIds.filter(id => id !== child.id);
        });
    });
    appData.codes = appData.codes.filter(c => c.parentId !== codeId);
    
    // Remove the code itself
    appData.codes = appData.codes.filter(c => c.id !== codeId);
    
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

    // If the user has a stored selection, clicking a code applies it.
    // Hold Shift/Alt/Ctrl/Cmd to force filter behaviour instead.
    const hasStoredSelection = appData.selectedText && appData.selectedText.startIndex !== undefined && appData.selectedText.endIndex !== undefined && appData.selectedText.text;
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
    } else {
        appData.filterCodeId = codeId;
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

// Drag-and-drop reordering for codes
function setupCodeDragAndDrop() {
    const codesList = document.getElementById('codesList');
    const draggableItems = codesList.querySelectorAll('.draggable-code');
    
    draggableItems.forEach(item => {
        item.addEventListener('dragstart', handleCodeDragStart);
        item.addEventListener('dragend', handleCodeDragEnd);
        item.addEventListener('dragover', handleCodeDragOver);
        item.addEventListener('dragleave', handleCodeDragLeave);
        item.addEventListener('drop', handleCodeDrop);
    });
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
    if (target.dataset.codeId !== draggedCodeId) {
        target.classList.add('drag-over');
    }
}

function handleCodeDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleCodeDrop(e) {
    e.preventDefault();
    const targetCodeId = e.currentTarget.dataset.codeId;
    
    if (!draggedCodeId || draggedCodeId === targetCodeId) return;
    
    saveHistory();
    
    // Get top-level codes in current order
    const topLevelCodes = appData.codes
        .filter(c => !c.parentId)
        .sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(a.created || 0) - new Date(b.created || 0);
        });
    
    // Find indices
    const draggedIndex = topLevelCodes.findIndex(c => c.id === draggedCodeId);
    const targetIndex = topLevelCodes.findIndex(c => c.id === targetCodeId);
    
    if (draggedIndex === -1 || targetIndex === -1) return;
    
    // Remove dragged item and insert at target position
    const [draggedCode] = topLevelCodes.splice(draggedIndex, 1);
    topLevelCodes.splice(targetIndex, 0, draggedCode);
    
    // Update sortOrder for all top-level codes
    topLevelCodes.forEach((code, index) => {
        const codeInData = appData.codes.find(c => c.id === code.id);
        if (codeInData) {
            codeInData.sortOrder = index;
        }
    });
    
    saveData();
    renderCodes();
}
