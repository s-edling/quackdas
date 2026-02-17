/**
 * Quackdas - Application Entry Point
 * Initialization, event listeners, keyboard shortcuts
 */

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    loadData();
    renderAll();
    updateHistoryButtons();
    updateSaveStatus();
    
    // Initialize PDF.js if available
    if (typeof initPdfJs === 'function') {
        initPdfJs();
    }
    
    // Setup drag and drop
    setupDragAndDrop();
    
    // Setup modal close on background click
    setupModalBackgrounds();
    
    // Setup file input label updates
    setupFileInputs();
    
    // Setup context menu dismissal
    setupContextMenuDismissal();

    // Flush lightweight doc access metadata before app/tab closes.
    window.addEventListener('beforeunload', () => {
        if (typeof flushDocumentAccessMetaSave === 'function') {
            flushDocumentAccessMetaSave();
        }
    });
});

// Drag and drop file handling
let dragCounter = 0;

function setupDragAndDrop() {
    const dropOverlay = document.getElementById('dropOverlay');
    
    // Prevent default drag behaviors on the whole document
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Show overlay when dragging files over the window
    document.body.addEventListener('dragenter', function(e) {
        dragCounter++;
        if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
            dropOverlay.classList.add('show');
        }
    });

    document.body.addEventListener('dragleave', function(e) {
        dragCounter--;
        if (dragCounter === 0) {
            dropOverlay.classList.remove('show');
        }
    });

    document.body.addEventListener('drop', function(e) {
        dragCounter = 0;
        dropOverlay.classList.remove('show');
        
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleDroppedFiles(e.dataTransfer.files);
        }
    });
}

function setupModalBackgrounds() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
}

function setupFileInputs() {
    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            const fileName = e.target.files[0]?.name || 'Choose file...';
            const label = document.querySelector('.file-input-label');
            if (label) label.textContent = fileName;
        });
    }
}

function setupContextMenuDismissal() {
    window.addEventListener('click', () => hideContextMenu());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
    window.addEventListener('scroll', () => hideContextMenu(), true);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    const activeEl = document.activeElement;
    const isTypingContext = !!activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
    );

    // PDF page navigation via arrow keys (when not typing in an input field)
    if (!isTypingContext && typeof isPdfDocumentActive === 'function' && isPdfDocumentActive()) {
        if (e.key === 'Escape' && typeof clearPendingPdfRegionSelection === 'function') {
            if (appData.selectedText && appData.selectedText.kind === 'pdfRegion') {
                e.preventDefault();
                clearPendingPdfRegionSelection();
                const doc = appData.documents.find(d => d.id === appData.currentDocId);
                if (doc && typeof renderPdfPage === 'function') {
                    renderPdfPage(currentPdfState.currentPage, doc);
                }
                return;
            }
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (typeof pdfPrevPage === 'function') pdfPrevPage();
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (typeof pdfNextPage === 'function') pdfNextPage();
            return;
        }
    }

    // Ctrl/Cmd + F for search
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearchModal();
    }
    // Ctrl/Cmd + S for save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        manualSave();
    }
    // Ctrl/Cmd + Z for undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
    }
    // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y for redo
    if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) || 
        ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        redo();
    }
    // Ctrl/Cmd + Plus/Equals for zoom in
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        adjustZoom(10);
    }
    // Ctrl/Cmd + Minus for zoom out
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        adjustZoom(-10);
    }
    // Ctrl/Cmd + 0 to reset zoom
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        appData.zoomLevel = 100;
        applyZoom();
        saveData();
    }
    
    // Keyboard shortcuts for codes (1-9)
    if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selection = window.getSelection();
        const hasTextSelection = selection.toString().trim().length > 0;
        const hasPdfRegionSelection = !!(appData.selectedText && appData.selectedText.kind === 'pdfRegion' && appData.selectedText.pdfRegion);
        if (hasTextSelection || hasPdfRegionSelection) {
            const shortcutNum = e.key;
            const code = appData.codes.find(c => c.shortcut === shortcutNum);
            if (code && appData.currentDocId && !appData.filterCodeId) {
                e.preventDefault();
                quickApplyCode(code.id);
            }
        }
    }
});

// Warn before closing with unsaved changes
window.addEventListener('beforeunload', function(e) {
    if (appData.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

// Update save status every minute
setInterval(updateSaveStatus, 60000);

// Electron: listen for menu-driven "Open Project" events (legacy JSON)
if (window.electronAPI && window.electronAPI.onOpenProject) {
    window.electronAPI.onOpenProject((jsonText) => {
        try {
            const imported = JSON.parse(jsonText);
            applyImportedProject(imported);
        } catch (e) {
            console.error('Failed to parse opened project JSON:', e);
            alert('Could not open project: invalid JSON');
        }
    });
}

// Electron: listen for QDPX file open events
if (window.electronAPI && window.electronAPI.onOpenQdpx) {
    window.electronAPI.onOpenQdpx(async (buffer) => {
        try {
            // Buffer comes from Electron as a Node Buffer, convert to ArrayBuffer
            const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
            await applyImportedQdpx(arrayBuffer);
        } catch (e) {
            console.error('Failed to open QDPX project:', e);
            alert('Could not open project: ' + (e.message || e));
        }
    });
}

// Electron: listen for menu actions (IPC instead of executeJavaScript)
if (window.electronAPI && window.electronAPI.onMenuAction) {
    window.electronAPI.onMenuAction((action, payload) => {
        switch (action) {
            case 'newProject':
                newProject();
                break;
            case 'save':
                manualSave(false);
                break;
            case 'saveAs':
                manualSave(true);
                break;
            default:
                console.warn('Unknown menu action:', action);
        }
    });
}

// Electron autosave: every 30s, save in place if a project file has been chosen and there are unsaved changes.
if (window.electronAPI && window.electronAPI.hasProjectHandle) {
    setInterval(async () => {
        try {
            if (appData && appData.hasUnsavedChanges && await window.electronAPI.hasProjectHandle()) {
                // Generate QDPX for autosave
                if (typeof exportToQdpx === 'function') {
                    const blob = await exportToQdpx();
                    const arrayBuffer = await blob.arrayBuffer();
                    const base64 = arrayBufferToBase64(arrayBuffer);
                    await window.electronAPI.saveProject(base64, { saveAs: false, silent: true, isQdpx: true });
                    appData.lastSaveTime = new Date().toISOString();
                    appData.hasUnsavedChanges = false;
                    if (typeof updateSaveStatus === 'function') updateSaveStatus();
                }
            }
        } catch (e) {
            // Don't spam the user; just log.
            console.error('Autosave failed:', e);
        }
    }, 30000);
}
