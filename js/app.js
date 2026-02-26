/**
 * Quackdas - Application Entry Point
 * Initialization, event listeners, keyboard shortcuts
 */

function decodeBase64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function applyPlatformShortcutTooltips() {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.title = isMac ? 'Undo (Cmd+Z)' : 'Undo (Ctrl+Z)';
    if (redoBtn) redoBtn.title = isMac ? 'Redo (Cmd+Shift+Z)' : 'Redo (Ctrl+Y)';
}

function setupLogoQuackEasterEgg() {
    const logo = document.getElementById('appLogo');
    if (!logo) return;
    const quackAudio = new Audio('assets/quack.mp3');
    quackAudio.preload = 'auto';
    logo.addEventListener('dblclick', () => {
        try {
            quackAudio.currentTime = 0;
            const playPromise = quackAudio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch(() => {});
            }
        } catch (_) {}
    });
}

// Initialize application
document.addEventListener('DOMContentLoaded', async function() {
    window.__startupProjectRestoreInProgress = true;
    try {
        loadData();

        let reopenedLastProject = false;
        if (window.electronAPI && typeof window.electronAPI.openLastUsedProject === 'function') {
            try {
                const result = await window.electronAPI.openLastUsedProject();
                if (result && result.ok && result.data) {
                    reopenedLastProject = true;
                    const buffer = decodeBase64ToArrayBuffer(result.data);
                    await applyImportedQdpx(buffer);
                }
            } catch (err) {
                console.warn('Could not reopen last project on startup:', err);
            }
        }

        if (!reopenedLastProject) {
            renderAll();
        }
        updateHistoryButtons();
        updateSaveStatus();
        applyPlatformShortcutTooltips();
        if (typeof initCodeViewDelegatedHandlers === 'function') initCodeViewDelegatedHandlers();
        if (typeof initSearchResultsDelegatedHandlers === 'function') initSearchResultsDelegatedHandlers();
        if (typeof initCooccurrenceDelegatedHandlers === 'function') initCooccurrenceDelegatedHandlers();
        
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
        setupStaticActionBindings();
        setupLogoQuackEasterEgg();
        if (typeof initSemanticTools === 'function') {
            initSemanticTools();
        }
        if (typeof startProjectBackupScheduler === 'function') {
            startProjectBackupScheduler();
        }

        // Flush lightweight doc access metadata before app/tab closes.
        window.addEventListener('beforeunload', () => {
            if (typeof flushDocumentAccessMetaSave === 'function') {
                flushDocumentAccessMetaSave();
            }
        });
    } finally {
        window.__startupProjectRestoreInProgress = false;
    }
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
    // Capture-phase fallback: close open overlays/modals even when focused controls consume key events.
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!closeUiOnEscape()) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    window.addEventListener('scroll', () => hideContextMenu(), true);
}

function makeDelegatedEventWithCurrentTarget(event, currentTarget) {
    return {
        target: event.target,
        currentTarget,
        dataTransfer: event.dataTransfer,
        metaKey: !!event.metaKey,
        ctrlKey: !!event.ctrlKey,
        shiftKey: !!event.shiftKey,
        altKey: !!event.altKey,
        clientX: Number(event.clientX || 0),
        clientY: Number(event.clientY || 0),
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation()
    };
}

function getEventTargetElement(event) {
    const target = event ? event.target : null;
    if (target && target.nodeType === 1) return target;
    if (target && target.nodeType === 3 && target.parentElement) return target.parentElement;
    return null;
}

function findNearbyCodedSegmentForContextMenu(event, originTarget) {
    const content = document.getElementById('documentContent');
    if (!content || !originTarget) return null;
    if (!(originTarget === content || content.contains(originTarget))) return null;

    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const verticalProbeOffsets = [0, -3, 3, -6, 6, -9, 9, -12, 12];
    for (const dy of verticalProbeOffsets) {
        const probeY = y + dy;
        const stack = (typeof document.elementsFromPoint === 'function')
            ? document.elementsFromPoint(x, probeY)
            : [document.elementFromPoint(x, probeY)].filter(Boolean);
        for (const el of stack) {
            if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') continue;
            const codedSegment = el.closest('.coded-segment[data-segment-ids]');
            if (codedSegment && content.contains(codedSegment)) return codedSegment;
        }
    }

    return null;
}

function isInteractiveControlTarget(target) {
    const targetEl = (target && target.nodeType === 1)
        ? target
        : (target && target.nodeType === 3 ? target.parentElement : null);
    if (!targetEl) return false;
    return !!targetEl.closest('button, input, select, textarea, label, a, [data-action]');
}

function setupStaticActionBindings() {
    document.addEventListener('click', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const el = targetEl.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
            case 'openSearchModal': openSearchModal(); break;
            case 'handleHeaderPrimaryAction': handleHeaderPrimaryAction(); break;
            case 'manualSave': manualSave(); break;
            case 'toggleHeaderDropdown': toggleHeaderDropdown(event); break;
            case 'newProjectAndCloseHeaderDropdown': newProject(); closeHeaderDropdown(); break;
            case 'importProjectNativeAndCloseHeaderDropdown': importProjectNative(); closeHeaderDropdown(); break;
            case 'manualSaveAsAndCloseHeaderDropdown': manualSave(true); closeHeaderDropdown(); break;
            case 'openStatsModalAndCloseHeaderDropdown': openStatsModal(); closeHeaderDropdown(); break;
            case 'runProjectHealthCheckAndCloseHeaderDropdown': runProjectHealthCheck(); closeHeaderDropdown(); break;
            case 'openRestoreBackupModalAndCloseHeaderDropdown': openRestoreBackupModal(); closeHeaderDropdown(); break;
            case 'exportCodedDataAndCloseHeaderDropdown': exportCodedData(); closeHeaderDropdown(); break;
            case 'openCaseModal': openCaseModal(); break;
            case 'openCodeModal': openCodeModal(); break;
            case 'undo': undo(); break;
            case 'redo': redo(); break;
            case 'pdfPrevPage': pdfPrevPage(); break;
            case 'pdfNextPage': pdfNextPage(); break;
            case 'adjustZoomOut': adjustZoom(-10); break;
            case 'adjustZoomIn': adjustZoom(10); break;
            case 'openImportModal': openImportModal(); break;
            case 'openPasteModal': openPasteModal(); break;
            case 'openSemanticToolsModal': openSemanticToolsModal(); break;
            case 'showSemanticToolSearch': showSemanticToolSearch(); break;
            case 'showSemanticToolAsk': showSemanticToolAsk(); break;
            case 'createFolder': createFolder(); break;
            case 'closeMemoModal': closeMemoModal(); break;
            case 'closeRestoreBackupModal': closeRestoreBackupModal(); break;
            case 'updateBoundaryPreview': updateBoundaryPreview(); break;
            case 'closeEditBoundariesModal': closeEditBoundariesModal(); break;
            case 'saveBoundaryEdit': saveBoundaryEdit(); break;
            case 'closeMetadataModal': closeMetadataModal(); break;
            case 'closeStatsModal': closeStatsModal(); break;
            case 'closeHealthCheckModal': closeHealthCheckModal(); break;
            case 'applySelectedHealthFixes': applySelectedHealthFixes(); break;
            case 'closeSearchResults': closeSearchResults(); break;
            case 'closeSemanticToolsModal': closeSemanticToolsModal(); break;
            case 'inPageSearchPrev': inPageSearchPrev(); break;
            case 'inPageSearchNext': inPageSearchNext(); break;
            case 'closeInPageSearch': closeInPageSearch(); break;
            case 'saveSemanticModelSetting': saveSemanticModelSetting(); break;
            case 'saveSemanticGenerationModel': saveSemanticGenerationModel(); break;
            case 'refreshSemanticModelList': refreshSemanticModelList(); break;
            case 'startSemanticIndexing': startSemanticIndexing(); break;
            case 'cancelSemanticIndexing': cancelSemanticIndexing(); break;
            case 'runSemanticSearch': runSemanticSearch(); break;
            case 'runSemanticAsk': runSemanticAsk(); break;
            case 'runSemanticAskAgain': runSemanticAskAgain(); break;
            case 'cancelSemanticAsk': cancelSemanticAsk(); break;
            case 'segmentActionChoiceMemo': segmentActionChoice('memo'); break;
            case 'segmentActionChoiceEdit': segmentActionChoice('edit'); break;
            case 'segmentActionChoiceRemove': segmentActionChoice('remove'); break;
            case 'closeSegmentActionModal': closeSegmentActionModal(); break;
            case 'closeCodeModal': closeCodeModal(); break;
            case 'closeCaseModal': closeCaseModal(); break;
            case 'closeImportModal': closeImportModal(); break;
            case 'closePasteModal': closePasteModal(); break;
            case 'closeCodeSelectionModal': closeCodeSelectionModal(); break;
            case 'applySelectedCodes': applySelectedCodes(); break;
            case 'closeCaseAddDocumentsModal': closeCaseAddDocumentsModal(); break;
            case 'closeDocumentAssignCasesModal': closeDocumentAssignCasesModal(); break;
            case 'closeMoveToFolderModal': closeMoveToFolderModal(); break;
            case 'closeFolderInfoModal': closeFolderInfoModal(); break;
            case 'closeCodeColorModal': closeCodeColorModal(); break;
            case 'closeCodeDescriptionModal': closeCodeDescriptionModal(); break;
            case 'closeTextPromptCancel': closeTextPrompt(false); break;
            case 'closeTextPromptOk': closeTextPrompt(true); break;
            case 'closeOcrHelpModal': closeOcrHelpModal(); break;
            case 'closePdfRegionPreviewModal': closePdfRegionPreviewModal(); break;
            case 'openDocumentMetadataFromList': openDocumentMetadata(String(el.dataset.docId || ''), event); break;
            case 'toggleFolderExpandedFromList': toggleFolderExpanded(String(el.dataset.folderId || ''), event); break;
            case 'openFolderInfoFromList': openFolderInfo(String(el.dataset.folderId || ''), event); break;
            case 'deleteCodeFromList': deleteCode(String(el.dataset.codeId || ''), event); break;
            case 'assignShortcutFromCodeView': assignShortcut(String(el.dataset.codeId || '')); break;
            case 'toggleCodeViewSubcodes': toggleCodeViewSubcodes(); break;
            case 'goToParentCodeFromCodeView': goToParentCodeFromCodeView(); break;
            case 'toggleCodeViewNotes': toggleCodeViewNotes(); break;
            case 'editFilterCodeDescription': editFilterCodeDescription(String(el.dataset.codeId || '')); break;
            case 'toggleCodeViewPresetsExpanded': toggleCodeViewPresetsExpanded(); break;
            case 'saveCurrentCodeViewPreset': saveCurrentCodeViewPreset(); break;
            case 'setCodeViewMode': setCodeViewMode(String(el.dataset.mode || 'segments')); break;
            case 'clearCodeInspectorSelection': clearCodeInspectorSelection(); break;
            case 'addInspectorSegmentMemo': addInspectorSegmentMemo(String(el.dataset.segmentId || '')); break;
            case 'goToSegmentLocationFromInspector': goToSegmentLocation(String(el.dataset.docId || ''), String(el.dataset.segmentId || '')); break;
            case 'toggleCaseExpandedFromList': toggleCaseExpanded(String(el.dataset.caseId || ''), event); break;
            case 'deleteCaseFromList': deleteCase(String(el.dataset.caseId || ''), event); break;
            case 'saveCaseDescriptionAndNotesFromSheet': saveCaseDescriptionAndNotes(String(el.dataset.caseId || '')); break;
            case 'cancelCaseDescriptionEdit': cancelCaseDescriptionEdit(); break;
            case 'startCaseDescriptionEdit': startCaseDescriptionEdit(); break;
            case 'toggleCaseViewNotes': toggleCaseViewNotes(); break;
            case 'saveCaseTypeFromSheet': saveCaseTypeFromSheet(String(el.dataset.caseId || '')); break;
            case 'saveCaseAttributeRow': saveCaseAttributeRow(String(el.dataset.caseId || ''), Number(el.dataset.rowIndex || 0)); break;
            case 'deleteCaseAttributeRow': deleteCaseAttributeRow(String(el.dataset.caseId || ''), Number(el.dataset.rowIndex || 0)); break;
            case 'addCaseAttributeFromSheet': addCaseAttributeFromSheet(String(el.dataset.caseId || '')); break;
            case 'linkCurrentDocumentToSelectedCase': linkCurrentDocumentToSelectedCase(); break;
            case 'openCaseAddDocumentsModalFromSheet': openCaseAddDocumentsModal(String(el.dataset.caseId || '')); break;
            case 'openLinkedCaseDocument': openLinkedCaseDocument(String(el.dataset.docId || '')); break;
            case 'unlinkDocumentFromCaseFromSheet': unlinkDocumentFromCaseFromSheet(String(el.dataset.caseId || ''), String(el.dataset.docId || '')); break;
            case 'openCaseFromHeaderPill': openCaseFromHeaderPill(String(el.dataset.caseId || '')); break;
            case 'toggleDocumentCasesPicker': toggleDocumentCasesPicker(event); break;
            case 'createCaseFromDocumentPicker': createCaseFromDocumentPicker(); break;
            case 'editMemo': editMemo(String(el.dataset.memoId || '')); break;
            case 'deleteMemo': deleteMemo(String(el.dataset.memoId || '')); break;
            case 'restoreBackupById': restoreBackupById(String(el.dataset.backupId || '')); break;
            case 'selectFolderForMove': selectFolderForMove(el.dataset.folderId ? String(el.dataset.folderId) : null); break;
            case 'toggleStatsMostUsedCodes': toggleStatsMostUsedCodes(); break;
            case 'toggleStatsCodingProgressDocs': toggleStatsCodingProgressDocs(); break;
            case 'toggleCaseAnalysisPanel': toggleCaseAnalysisPanel(String(el.dataset.panel || '')); break;
            case 'goToCaseAnalysisResult': goToCaseAnalysisResult(String(el.dataset.docId || ''), String(el.dataset.segmentId || '')); break;
            case 'openCaseSummaryCodeInFilter': openCaseSummaryCodeInFilter(String(el.dataset.codeId || ''), String(el.dataset.caseId || '')); break;
            case 'openMatrixCellInFilter': openMatrixCellInFilter(String(el.dataset.codeId || ''), String(el.dataset.caseIds || '')); break;
            default: break;
        }
    });

    document.addEventListener('change', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const el = targetEl.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
            case 'importProjectChange': importProject(event); break;
            case 'toggleCodeColorPaletteContrast': toggleCodeColorPaletteContrast(event.target.checked); break;
            case 'toggleInspectorSegmentCode': toggleInspectorSegmentCode(String(el.dataset.segmentId || ''), String(el.dataset.codeId || ''), !!event.target.checked); break;
            case 'applyCodeViewPreset': applyCodeViewPreset(event.target.value); break;
            case 'updateAnnotationViewFilter': updateAnnotationViewFilter(String(el.dataset.filterKey || ''), event.target.value); break;
            case 'updateCaseAnalysisField': updateCaseAnalysisField(String(el.dataset.fieldPath || ''), event.target.value); break;
            case 'toggleCaseAnalysisFilterCase': toggleCaseAnalysisFilterCase(String(el.dataset.caseId || ''), !!event.target.checked); break;
            case 'toggleCaseAnalysisMatrixCode': toggleCaseAnalysisMatrixCode(String(el.dataset.codeId || ''), !!event.target.checked); break;
            case 'toggleCaseLinkFromDocumentPicker': toggleCaseLinkFromDocumentPicker(String(el.dataset.caseId || ''), !!event.target.checked); break;
            case 'updateCaseAnalysisCooccurrenceSelection': updateCaseAnalysisCooccurrenceSelection(String(el.dataset.which || ''), event.target.value); break;
            default: break;
        }
    });

    document.addEventListener('input', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const el = targetEl.closest('[data-action]');
        if (!el) return;
        switch (el.dataset.action) {
            case 'updateDocumentCasesPickerQuery': updateDocumentCasesPickerQuery(event.target.value); break;
            case 'updateAnnotationViewFilter': updateAnnotationViewFilter(String(el.dataset.filterKey || ''), event.target.value); break;
            case 'updateCaseAnalysisField': updateCaseAnalysisField(String(el.dataset.fieldPath || ''), event.target.value); break;
            default: break;
        }
    });

    [
        ['memoForm', saveMemo],
        ['metadataForm', saveMetadata],
        ['codeForm', saveCode],
        ['caseForm', saveCase],
        ['caseAddDocumentsForm', saveCaseAddDocuments],
        ['documentAssignCasesForm', saveDocumentAssignCases],
        ['codeDescriptionForm', saveCodeDescriptionFromModal],
        ['importForm', importDocument],
        ['pasteForm', pasteDocument],
        ['folderInfoForm', saveFolderInfo]
    ].forEach(([id, handler]) => {
        const form = document.getElementById(id);
        if (!form || typeof handler !== 'function') return;
        form.addEventListener('submit', (event) => handler(event));
    });

    const descInput = document.getElementById('codeDescriptionShortInput');
    const notesInput = document.getElementById('codeDescriptionNotesInput');
    if (descInput) {
        descInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            if (typeof saveCodeDescriptionFromModal === 'function') saveCodeDescriptionFromModal();
        });
    }
    if (notesInput) {
        notesInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            if (event.shiftKey) return; // Shift+Enter inserts line break.
            event.preventDefault();
            if (typeof saveCodeDescriptionFromModal === 'function') saveCodeDescriptionFromModal();
        });
    }

    document.addEventListener('click', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        if (targetEl.closest('[data-action]')) return;

        const docItem = targetEl.closest('.document-item[data-doc-id]');
        if (docItem && !isInteractiveControlTarget(targetEl)) {
            selectDocumentFromList(event, String(docItem.dataset.docId || ''));
            return;
        }

        const codeItem = targetEl.closest('.code-item.draggable-code[data-code-id]');
        if (codeItem && !isInteractiveControlTarget(targetEl)) {
            filterByCode(String(codeItem.dataset.codeId || ''), event);
            return;
        }

        const caseItem = targetEl.closest('.case-item[data-case-id]');
        if (caseItem && !isInteractiveControlTarget(targetEl)) {
            selectCase(String(caseItem.dataset.caseId || ''), event);
        }
    });

    document.addEventListener('contextmenu', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;

        const docItem = targetEl.closest('.document-item[data-doc-id]');
        if (docItem) {
            openDocumentContextMenu(String(docItem.dataset.docId || ''), event);
            return;
        }

        const folderItem = targetEl.closest('.folder-item[data-folder-id]');
        if (folderItem) {
            openFolderContextMenu(String(folderItem.dataset.folderId || ''), event);
            return;
        }

        const codeItem = targetEl.closest('.code-item.draggable-code[data-code-id]');
        if (codeItem) {
            openCodeContextMenu(String(codeItem.dataset.codeId || ''), event);
            return;
        }

        const caseItem = targetEl.closest('.case-item[data-case-id]');
        if (caseItem) {
            openCaseContextMenu(String(caseItem.dataset.caseId || ''), event);
            return;
        }

        const codedSegment = targetEl.closest('.coded-segment[data-segment-ids]')
            || findNearbyCodedSegmentForContextMenu(event, targetEl);
        if (codedSegment) {
            showSegmentContextMenu(String(codedSegment.dataset.segmentIds || ''), event);
        }
    });

    document.addEventListener('dragstart', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;

        const docItem = targetEl.closest('.document-item[data-doc-id]');
        if (docItem) {
            handleDocDragStart(makeDelegatedEventWithCurrentTarget(event, docItem), String(docItem.dataset.docId || ''));
            return;
        }
        const folderItem = targetEl.closest('.folder-item[data-folder-id]');
        if (folderItem) {
            handleFolderItemDragStart(makeDelegatedEventWithCurrentTarget(event, folderItem), String(folderItem.dataset.folderId || ''));
        }
    });

    document.addEventListener('dragend', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;

        const docItem = targetEl.closest('.document-item[data-doc-id]');
        if (docItem) {
            handleDocDragEnd(makeDelegatedEventWithCurrentTarget(event, docItem));
            return;
        }
        const folderItem = targetEl.closest('.folder-item[data-folder-id]');
        if (folderItem) {
            handleFolderItemDragEnd(makeDelegatedEventWithCurrentTarget(event, folderItem));
        }
    });

    document.addEventListener('dragover', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const zone = targetEl.closest('.folder-item[data-folder-id], .root-drop-zone, .root-doc-separator, #documentsList[data-root-drop-enabled]');
        if (!zone) return;
        handleFolderDragOver(makeDelegatedEventWithCurrentTarget(event, zone));
    });

    document.addEventListener('dragleave', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const zone = targetEl.closest('.folder-item[data-folder-id], .root-drop-zone, .root-doc-separator, #documentsList[data-root-drop-enabled]');
        if (!zone) return;
        handleFolderDragLeave(makeDelegatedEventWithCurrentTarget(event, zone));
    });

    document.addEventListener('drop', (event) => {
        const targetEl = getEventTargetElement(event);
        if (!targetEl) return;
        const zone = targetEl.closest('.folder-item[data-folder-id], .root-drop-zone, .root-doc-separator, #documentsList[data-root-drop-enabled]');
        if (!zone) return;
        if (zone.matches('.folder-item[data-folder-id]')) {
            handleDocumentDropOnFolder(makeDelegatedEventWithCurrentTarget(event, zone), String(zone.dataset.folderId || '') || null);
            return;
        }
        if (zone.matches('.root-drop-zone') || zone.matches('.root-doc-separator')) {
            handleDocumentDropOnFolder(makeDelegatedEventWithCurrentTarget(event, zone), null);
            return;
        }
        if (zone.matches('#documentsList[data-root-drop-enabled]')) {
            handleRootLevelDrop(makeDelegatedEventWithCurrentTarget(event, zone));
        }
    });
}

function isModalOpen(modalId) {
    const el = document.getElementById(modalId);
    return !!(el && el.classList.contains('show'));
}

function closeTopmostShownModalFallback() {
    const shownModals = Array.from(document.querySelectorAll('.modal.show'));
    if (!shownModals.length) return false;
    const topModal = shownModals[shownModals.length - 1];
    topModal.classList.remove('show');
    return true;
}

function closeUiOnEscape() {
    if (typeof closeDocumentCasesPicker === 'function' && typeof documentCasePickerState !== 'undefined' && documentCasePickerState && documentCasePickerState.open) {
        closeDocumentCasesPicker();
        return true;
    }

    const contextMenu = document.getElementById('contextMenu');
    if (contextMenu && contextMenu.classList.contains('show')) {
        hideContextMenu();
        return true;
    }

    const bar = document.getElementById('inPageSearchBar');
    if (bar && bar.classList.contains('show')) {
        if (typeof closeInPageSearch === 'function') closeInPageSearch();
        return true;
    }

    if (isModalOpen('pdfRegionPreviewModal')) {
        if (typeof closePdfRegionPreviewModal === 'function') closePdfRegionPreviewModal();
        else document.getElementById('pdfRegionPreviewModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('memoModal')) {
        if (typeof closeMemoModal === 'function') closeMemoModal();
        else document.getElementById('memoModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('statsModal')) {
        if (typeof closeStatsModal === 'function') closeStatsModal();
        else document.getElementById('statsModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('healthCheckModal')) {
        if (typeof closeHealthCheckModal === 'function') closeHealthCheckModal();
        else document.getElementById('healthCheckModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('searchResultsModal')) {
        if (typeof closeSearchResults === 'function') closeSearchResults();
        else document.getElementById('searchResultsModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('textPromptModal')) {
        if (typeof closeTextPrompt === 'function') closeTextPrompt(false);
        else document.getElementById('textPromptModal').classList.remove('show');
        return true;
    }

    if (isModalOpen('codeDescriptionModal')) {
        if (typeof closeCodeDescriptionModal === 'function') closeCodeDescriptionModal();
        else document.getElementById('codeDescriptionModal').classList.remove('show');
        return true;
    }

    const inlineAnnotation = document.getElementById('pdfRegionAnnotationInline');
    if (inlineAnnotation && !inlineAnnotation.hidden) {
        if (typeof dismissPdfRegionAnnotationInline === 'function') dismissPdfRegionAnnotationInline();
        else inlineAnnotation.hidden = true;
        return true;
    }

    const inspectorPanel = document.getElementById('codeInspectorPanel');
    if (inspectorPanel && !inspectorPanel.hidden) {
        if (typeof clearCodeInspectorSelection === 'function') {
            clearCodeInspectorSelection();
        } else {
            inspectorPanel.hidden = true;
        }
        return true;
    }

    return closeTopmostShownModalFallback();
}

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    const activeEl = document.activeElement;
    const isTypingContext = !!activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
    );

    // Escape closes open UI windows/panels in priority order
    if (e.key === 'Escape') {
        if (closeUiOnEscape()) {
            e.preventDefault();
            return;
        }
    }

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

    // Ctrl/Cmd + Shift + F for global search
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        openSearchModal();
        return;
    }
    // Ctrl/Cmd + F for in-page find
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (typeof openInPageSearch === 'function') openInPageSearch();
        return;
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
                let base64 = null;
                if (typeof getProjectQdpxBase64 === 'function') {
                    base64 = await getProjectQdpxBase64();
                } else if (typeof exportToQdpx === 'function') {
                    const blob = await exportToQdpx();
                    const arrayBuffer = await blob.arrayBuffer();
                    base64 = arrayBufferToBase64(arrayBuffer);
                }
                if (!base64) return;

                await window.electronAPI.saveProject({
                    qdpxBase64: base64
                }, { saveAs: false, silent: true, format: 'qdpx' });

                if (typeof createProjectBackup === 'function') {
                    createProjectBackup('autosave', { base64 }).catch(() => {});
                }
                appData.lastSaveTime = new Date().toISOString();
                appData.hasUnsavedChanges = false;
                if (typeof updateSaveStatus === 'function') updateSaveStatus();
            }
        } catch (e) {
            // Don't spam the user; just log.
            console.error('Autosave failed:', e);
        }
    }, 30000);
}
