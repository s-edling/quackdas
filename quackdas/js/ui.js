/**
 * Quackdas - UI Utilities
 * Context menus, modals, zoom, save status, statistics
 */

// Text prompt modal state
let _textPromptResolve = null;
let projectBackupTimer = null;
let projectBackupInFlight = false;
let lastBackedUpRevision = 0;
let cooccurrenceDelegationBound = false;
let caseAnalysisCache = {
    revision: -1,
    caseById: new Map(),
    docById: new Map(),
    caseDocIds: new Map(),
    docCaseIds: new Map(),
    attrValuesByKey: new Map(),
    caseIdsByAttrPair: new Map()
};
let caseCodeReferenceCountCache = {
    revision: -1,
    values: new Map()
};
const caseAnalysisUiState = {
    expandedPanels: {
        filter: true,
        summary: true,
        matrix: true,
        cooccurrence: true
    },
    filter: {
        codeId: '',
        codeQuery: '',
        caseMode: 'any',
        caseQuery: '',
        caseIds: [],
        attrKey: '',
        attrValue: '',
        attrValueQuery: '',
        resultLimit: 250
    },
    summary: {
        caseId: '',
        caseQuery: ''
    },
    matrix: {
        rowMode: 'cases',
        rowAttributeKey: '',
        codeMode: 'selected',
        codeQuery: '',
        selectedCodeIds: [],
        codeGroupId: '',
        metric: 'references'
    },
    cooccurrence: {
        codeAId: '',
        codeBId: ''
    }
};
const statsDashboardUiState = {
    showAllMostUsedCodes: false,
    showAllCodingProgressDocs: false
};
let qdpxExportCache = {
    projectRef: null,
    revision: null,
    base64: null,
    inFlight: null
};

function ensureQdpxExportCacheContext() {
    if (qdpxExportCache.projectRef === appData) return;
    qdpxExportCache.projectRef = appData;
    qdpxExportCache.revision = null;
    qdpxExportCache.base64 = null;
    qdpxExportCache.inFlight = null;
}

async function getProjectQdpxBase64(options = {}) {
    const providedBase64 = options.base64 || null;
    if (providedBase64) return providedBase64;
    if (typeof exportToQdpx !== 'function') {
        throw new Error('QDPX export not available');
    }

    ensureQdpxExportCacheContext();
    const revision = (typeof appDataRevision === 'number') ? appDataRevision : -1;

    if (!options.force && qdpxExportCache.base64 && qdpxExportCache.revision === revision) {
        return qdpxExportCache.base64;
    }

    if (qdpxExportCache.inFlight && qdpxExportCache.revision === revision) {
        return qdpxExportCache.inFlight;
    }

    qdpxExportCache.revision = revision;
    qdpxExportCache.inFlight = (async () => {
        const blob = await exportToQdpx();
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        if (qdpxExportCache.projectRef === appData && qdpxExportCache.revision === revision) {
            qdpxExportCache.base64 = base64;
        }
        return base64;
    })();

    try {
        return await qdpxExportCache.inFlight;
    } finally {
        if (qdpxExportCache.projectRef === appData && qdpxExportCache.revision === revision) {
            qdpxExportCache.inFlight = null;
        }
    }
}

function initCooccurrenceDelegatedHandlers() {
    if (cooccurrenceDelegationBound) return;
    const matrix = document.getElementById('cooccurrenceMatrix');
    const overlaps = document.getElementById('cooccurrenceOverlaps');
    if (matrix) {
        matrix.addEventListener('click', (event) => {
            const cell = event.target.closest('.cooc-cell[data-code-a][data-code-b]');
            if (!cell) return;
            selectCooccurrencePair(cell.dataset.codeA, cell.dataset.codeB);
        });
    }
    if (overlaps) {
        overlaps.addEventListener('click', (event) => {
            const item = event.target.closest('.cooc-overlap-item[data-doc-id][data-segment-id]');
            if (!item) return;
            goToSegmentLocation(item.dataset.docId, item.dataset.segmentId);
        });
    }
    cooccurrenceDelegationBound = true;
}

function hasAnyProjectData() {
    return (appData.documents.length + appData.codes.length + appData.cases.length + appData.segments.length + appData.folders.length + appData.memos.length) > 0;
}

function scheduleProjectBackup(reason = 'state-change') {
    if (!(window.electronAPI && window.electronAPI.createProjectBackup)) return;
    if (!hasAnyProjectData()) return;
    if (projectBackupTimer) clearTimeout(projectBackupTimer);
    projectBackupTimer = setTimeout(() => {
        projectBackupTimer = null;
        createProjectBackup(reason).catch(() => {});
    }, 2500);
}

async function createProjectBackup(reason = 'auto', options = {}) {
    const force = !!options.force;
    if (!(window.electronAPI && window.electronAPI.createProjectBackup)) return false;
    if (!force && !appData.hasUnsavedChanges) return false;
    if (!force && typeof appDataRevision === 'number' && appDataRevision <= lastBackedUpRevision) return false;
    if (!hasAnyProjectData()) return false;
    if (projectBackupInFlight) return false;

    projectBackupInFlight = true;
    try {
        const base64 = await getProjectQdpxBase64({ base64: options.base64 });

        const result = await window.electronAPI.createProjectBackup(base64, {
            reason,
            projectName: appData.projectName || 'untitled-project'
        });
        if (!result || !result.ok) return false;

        if (typeof appDataRevision === 'number') lastBackedUpRevision = appDataRevision;
        return true;
    } catch (err) {
        console.warn('Project backup failed:', err);
        return false;
    } finally {
        projectBackupInFlight = false;
    }
}

function startProjectBackupScheduler() {
    if (!(window.electronAPI && window.electronAPI.createProjectBackup)) return;
    setInterval(() => {
        createProjectBackup('interval').catch(() => {});
    }, 10 * 60 * 1000);
}

// Header dropdown functions
function toggleHeaderDropdown(event) {
    event.stopPropagation();
    const menu = document.getElementById('headerDropdownMenu');
    if (menu) {
        menu.classList.toggle('show');
        if (menu.classList.contains('show')) {
            // Close when clicking elsewhere
            setTimeout(() => {
                document.addEventListener('click', closeHeaderDropdownOnOutsideClick);
            }, 0);
        }
    }
}

function closeHeaderDropdown() {
    const menu = document.getElementById('headerDropdownMenu');
    if (menu) {
        menu.classList.remove('show');
    }
    document.removeEventListener('click', closeHeaderDropdownOnOutsideClick);
}

function closeHeaderDropdownOnOutsideClick(event) {
    const menu = document.getElementById('headerDropdownMenu');
    if (menu && !menu.contains(event.target)) {
        closeHeaderDropdown();
    }
}

function hasProjectDataLoaded() {
    return (appData.documents.length + appData.codes.length + appData.cases.length + appData.segments.length + appData.folders.length + appData.memos.length) > 0;
}

function updateHeaderPrimaryAction() {
    const btn = document.getElementById('headerPrimaryAction');
    const openProjectMenuItem = document.getElementById('headerOpenProjectItem');
    if (!btn) return;

    const showOpen = !hasProjectDataLoaded();
    btn.style.display = showOpen ? 'inline-flex' : 'none';
    if (openProjectMenuItem) {
        openProjectMenuItem.style.display = showOpen ? 'none' : 'flex';
    }
    btn.title = 'Open project';
    btn.innerHTML = `
        <svg class="toolbar-icon" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        Open project
    `;
}

function handleHeaderPrimaryAction() {
    importProjectNative();
}

function openOcrHelpModal() {
    const modal = document.getElementById('ocrHelpModal');
    const osHint = document.getElementById('ocrHelpOsHint');
    const installCmd = document.getElementById('ocrHelpInstallCommand');
    if (!modal) return;

    const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
    if (platform.includes('mac')) {
        if (osHint) osHint.textContent = 'macOS (Homebrew)';
        if (installCmd) installCmd.textContent = 'brew install tesseract tesseract-lang';
    } else if (platform.includes('win')) {
        if (osHint) osHint.textContent = 'Windows';
        if (installCmd) installCmd.textContent = 'Install Tesseract OCR, then add tesseract.exe to PATH.';
    } else {
        if (osHint) osHint.textContent = 'Linux';
        if (installCmd) installCmd.textContent = 'sudo apt install tesseract-ocr tesseract-ocr-all';
    }

    modal.classList.add('show');
}

function closeOcrHelpModal() {
    const modal = document.getElementById('ocrHelpModal');
    if (modal) modal.classList.remove('show');
}

async function openRestoreBackupModal() {
    if (!(window.electronAPI && window.electronAPI.listProjectBackups && window.electronAPI.restoreProjectBackup)) {
        alert('Backup restore is only available in the Electron app.');
        return;
    }
    const modal = document.getElementById('backupRestoreModal');
    const listEl = document.getElementById('backupRestoreList');
    if (!modal || !listEl) return;

    listEl.innerHTML = '<div class="empty-state-hint">Loading backups…</div>';
    modal.classList.add('show');

    try {
        const result = await window.electronAPI.listProjectBackups({
            projectName: appData.projectName || 'untitled-project'
        });
        if (!result || !result.ok) {
            throw new Error(result?.error || 'Could not list backups');
        }
        const backups = Array.isArray(result.backups) ? result.backups : [];
        if (backups.length === 0) {
            listEl.innerHTML = '<div class="empty-state-hint">No backups found for this project yet.</div>';
            return;
        }

        listEl.innerHTML = backups.map((backup) => {
            const dt = new Date(backup.createdAt);
            const sizeMb = (Number(backup.sizeBytes || 0) / (1024 * 1024)).toFixed(2);
            return `
                <div class="backup-item">
                    <div class="backup-item-main">
                        <div class="backup-item-time">${escapeHtml(dt.toLocaleString())}</div>
                        <div class="backup-item-meta">${escapeHtml(backup.reason || 'auto backup')} · ${sizeMb} MB</div>
                    </div>
                    <button class="btn btn-secondary backup-restore-btn" onclick="restoreBackupById('${escapeJsForSingleQuotedString(backup.id)}')">Restore</button>
                </div>
            `;
        }).join('');
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state-hint">Failed to load backups: ${escapeHtml(err?.message || String(err))}</div>`;
    }
}

function closeRestoreBackupModal() {
    const modal = document.getElementById('backupRestoreModal');
    if (modal) modal.classList.remove('show');
}

async function restoreBackupById(backupId) {
    if (!backupId) return;
    if (!confirm('Restore this backup and replace the current project in memory?')) return;

    try {
        const result = await window.electronAPI.restoreProjectBackup(backupId, {
            projectName: appData.projectName || 'untitled-project'
        });
        if (!result || !result.ok || !result.data) {
            throw new Error(result?.error || 'Backup restore failed');
        }

        const buffer = base64ToArrayBuffer(result.data);
        await applyImportedQdpx(buffer);
        closeRestoreBackupModal();
    } catch (err) {
        alert('Restore failed: ' + (err?.message || err));
    }
}

// Context menu functions
function showContextMenu(items, x, y) {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;

    // Prevent clicks from falling through to underlying document text
    menu.onmousedown = (e) => { e.stopPropagation(); };
    menu.onclick = (e) => { e.stopPropagation(); };
    // Clear existing
    menu.innerHTML = '';
    menu.setAttribute('role', 'menu');

    for (const item of items) {
        if (item.type === 'sep') {
            const sep = document.createElement('div');
            sep.className = 'sep';
            sep.setAttribute('role', 'separator');
            menu.appendChild(sep);
            continue;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = item.danger ? 'danger' : '';
        btn.setAttribute('role', 'menuitem');
        btn.textContent = item.label;

        btn.addEventListener('click', async () => {
            try {
                const r = (typeof item.onClick === 'function') ? item.onClick() : null;
                if (r && typeof r.then === 'function') await r;
            } finally {
                hideContextMenu();
            }
        });

        menu.appendChild(btn);
    }

    // Position (keep on-screen)
    const padding = 8;
    menu.classList.add('show');

    // Need a frame to measure offsetWidth reliably after class change
    requestAnimationFrame(() => {
        const maxLeft = Math.max(padding, window.innerWidth - menu.offsetWidth - padding);
        const maxTop = Math.max(padding, window.innerHeight - menu.offsetHeight - padding);
        menu.style.left = Math.min(x, maxLeft) + 'px';
        menu.style.top = Math.min(y, maxTop) + 'px';
        menu.setAttribute('aria-hidden', 'false');
    });
}

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (!menu) return;
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
}

// Text prompt modal (Promise-based) to avoid window.prompt issues in packaged Electron builds
function openTextPrompt(title, defaultValue) {
    return new Promise((resolve) => {
        _textPromptResolve = resolve;
        const modal = document.getElementById('textPromptModal');
        const t = document.getElementById('textPromptTitle');
        const inp = document.getElementById('textPromptInput');
        if (t) t.textContent = title || 'Enter value';
        if (inp) {
            inp.value = defaultValue || '';
            // focus after paint
            setTimeout(() => {
                inp.focus();
                inp.select();
            }, 0);
            inp.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); closeTextPrompt(true); }
                if (e.key === 'Escape') { e.preventDefault(); closeTextPrompt(false); }
            };
        }
        if (modal) modal.classList.add('show');
    });
}

function closeTextPrompt(ok) {
    const modal = document.getElementById('textPromptModal');
    const inp = document.getElementById('textPromptInput');
    if (modal) modal.classList.remove('show');
    const value = inp ? inp.value : '';
    const resolve = _textPromptResolve;
    _textPromptResolve = null;
    if (typeof resolve === 'function') resolve(ok ? value : null);
}

// Document context menu
function openDocumentContextMenu(docId, event) {
    event.preventDefault();
    event.stopPropagation();

    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;

    const items = [
        { label: `Rename document: ${doc.title}`, onClick: () => renameDocument(docId) },
        { label: 'Move to folder...', onClick: () => openMoveToFolderModal(docId) },
        { label: 'Assign to case...', onClick: () => openDocumentAssignCasesModal(docId) },
        { label: `Delete document: ${doc.title}`, onClick: () => deleteDocument(docId), danger: true }
    ];
    if (doc.type === 'pdf' && typeof extractPdfTextAsDocument === 'function') {
        items.splice(2, 0, { label: 'Extract text as document', onClick: () => extractPdfTextAsDocument(docId) });
    }

    showContextMenu(items, event.clientX, event.clientY);
}

// Move to folder modal
let moveToFolderDocId = null;

function openMoveToFolderModal(docId) {
    moveToFolderDocId = docId;
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    const modal = document.getElementById('moveToFolderModal');
    const list = document.getElementById('folderSelectionList');
    
    // Build folder tree
    const folderIconSvg = `<svg class="toolbar-icon folder-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-1.2 8a2 2 0 0 1-2 1.7H6.2a2 2 0 0 1-2-1.7z"/></svg>`;
    let html = `<div class="folder-selection-item ${!doc.folderId ? 'selected' : ''}" onclick="selectFolderForMove(null)">
        <span class="folder-icon">${folderIconSvg}</span> Root (no folder)
    </div>`;
    
    html += renderFolderSelectionTree(null, 0, doc.folderId);
    
    list.innerHTML = html;
    modal.classList.add('show');
}

function renderFolderSelectionTree(parentId, depth, currentFolderId) {
    const folders = appData.folders.filter(f => f.parentId === parentId);
    if (folders.length === 0) return '';
    
    const folderIconSvg = `<svg class="toolbar-icon folder-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-1.2 8a2 2 0 0 1-2 1.7H6.2a2 2 0 0 1-2-1.7z"/></svg>`;
    let html = '';
    folders.forEach(folder => {
        const isSelected = folder.id === currentFolderId;
        const indent = depth * 20;
        html += `<div class="folder-selection-item ${isSelected ? 'selected' : ''}" style="padding-left: ${16 + indent}px;" onclick="selectFolderForMove('${escapeJsForSingleQuotedString(folder.id)}')">
            <span class="folder-icon">${folderIconSvg}</span> ${escapeHtml(folder.name)}
        </div>`;
        html += renderFolderSelectionTree(folder.id, depth + 1, currentFolderId);
    });
    return html;
}

function selectFolderForMove(folderId) {
    if (moveToFolderDocId) {
        moveDocumentToFolder(moveToFolderDocId, folderId);
    }
    closeMoveToFolderModal();
}

function closeMoveToFolderModal() {
    document.getElementById('moveToFolderModal').classList.remove('show');
    moveToFolderDocId = null;
}

const CODE_COLOR_PALETTE_DUSTY = [
    '#5b8fd9', '#8a64d6', '#d16a8e', '#d38452',
    '#4fae8c', '#88a843', '#4e9eb8', '#c97362',
    '#6d79d8', '#d48a4e', '#3ea8a1', '#b56aa5',
    '#9e9a3f', '#5d93c8', '#c27c54', '#5aa66e'
];

const CODE_COLOR_PALETTE_CONTRAST = [
    '#0f7ae5', '#d94f11', '#0c9e61', '#d11f6a',
    '#6a4de3', '#b66f00', '#0f8a93', '#c22f2f',
    '#2b6f2b', '#7a2cab', '#3663c5', '#a65c00',
    '#01776f', '#bb2c86', '#4f5a11', '#8e3150'
];

let currentCodeColorTargetId = null;
let codeColorHighContrast = false;

// Code context menu
function openCodeContextMenu(codeId, event) {
    event.preventDefault();
    event.stopPropagation();

    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;

    const shortcutLabel = code.shortcut ? `Change shortcut [${code.shortcut}]` : 'Assign shortcut';

    showContextMenu([
        { label: `Rename code: ${code.name}`, onClick: () => renameCode(codeId) },
        { label: shortcutLabel, onClick: () => assignShortcut(codeId) },
        { label: 'Change colour', onClick: () => openCodeColorModal(codeId) },
        { label: `Delete code: ${code.name}`, onClick: () => deleteCode(codeId, { stopPropagation: () => {} }), danger: true }
    ], event.clientX, event.clientY);
}

function getActiveCodeColorPalette() {
    return codeColorHighContrast ? CODE_COLOR_PALETTE_CONTRAST : CODE_COLOR_PALETTE_DUSTY;
}

function openCodeColorModal(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;

    currentCodeColorTargetId = codeId;
    const modal = document.getElementById('codeColorModal');
    const toggle = document.getElementById('codeColorHighContrastToggle');
    if (toggle) toggle.checked = codeColorHighContrast;
    renderCodeColorPalette();
    if (modal) modal.classList.add('show');
}

function closeCodeColorModal() {
    const modal = document.getElementById('codeColorModal');
    if (modal) modal.classList.remove('show');
    currentCodeColorTargetId = null;
}

function toggleCodeColorPaletteContrast(forceValue) {
    if (typeof forceValue === 'boolean') {
        codeColorHighContrast = forceValue;
    } else {
        const toggle = document.getElementById('codeColorHighContrastToggle');
        codeColorHighContrast = !!(toggle && toggle.checked);
    }
    renderCodeColorPalette();
}

function renderCodeColorPalette() {
    const code = appData.codes.find(c => c.id === currentCodeColorTargetId);
    const grid = document.getElementById('codeColorPaletteGrid');
    const meta = document.getElementById('codeColorPaletteMeta');
    if (!grid || !meta || !code) return;

    const palette = getActiveCodeColorPalette();
    meta.textContent = `${code.name}`;

    grid.innerHTML = palette.map((color) => {
        const selected = color.toLowerCase() === String(code.color || '').toLowerCase();
        return `<button type="button" class="code-color-swatch ${selected ? 'selected' : ''}" data-code-color="${escapeHtmlAttrValue(color)}" style="background:${escapeHtml(color)};" title="${escapeHtmlAttrValue(color)}"></button>`;
    }).join('');

    grid.querySelectorAll('.code-color-swatch[data-code-color]').forEach((btn) => {
        btn.addEventListener('click', () => {
            applyCodeColor(currentCodeColorTargetId, btn.dataset.codeColor);
        });
    });
}

function applyCodeColor(codeId, color) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code || !color) return;
    if (String(code.color || '').toLowerCase() === String(color).toLowerCase()) {
        closeCodeColorModal();
        return;
    }
    saveHistory();
    code.color = color;
    saveData();
    renderAll();
    closeCodeColorModal();
}

// Zoom functions
function adjustZoom(change) {
    if (typeof isPdfDocumentActive === 'function' && isPdfDocumentActive()) {
        if (typeof pdfAdjustZoomByPercent === 'function') {
            pdfAdjustZoomByPercent(change);
        }
        return;
    }

    appData.zoomLevel = Math.max(50, Math.min(200, appData.zoomLevel + change));
    applyZoom();
    saveData();
}

function applyZoom() {
    const zoomLevelEl = document.getElementById('zoomLevel');
    if (typeof isPdfDocumentActive === 'function' && isPdfDocumentActive()) {
        if (zoomLevelEl) {
            zoomLevelEl.textContent = Math.round(getCurrentPdfZoomPercent()) + '%';
        }
        return;
    }

    const docContent = document.getElementById('documentContent');
    if (docContent) {
        const baseFontSize = 16; // Base font size from CSS
        const newFontSize = (baseFontSize * appData.zoomLevel) / 100;
        docContent.style.fontSize = newFontSize + 'px';
    }
    
    if (zoomLevelEl) {
        zoomLevelEl.textContent = appData.zoomLevel + '%';
    }
}

// Save status
function updateSaveStatus() {
    const saveBtn = document.getElementById('saveBtn');
    const saveStatus = document.getElementById('saveStatus');
    
    if (appData.hasUnsavedChanges) {
        saveBtn.classList.add('unsaved');
        saveStatus.textContent = 'Save';
    } else {
        saveBtn.classList.remove('unsaved');
        if (appData.lastSaveTime) {
            const minutesAgo = Math.floor((Date.now() - new Date(appData.lastSaveTime)) / 60000);
            if (minutesAgo < 1) {
                saveStatus.textContent = 'Saved';
            } else if (minutesAgo < 60) {
                saveStatus.textContent = `Saved ${minutesAgo}m ago`;
            } else {
                saveStatus.textContent = 'Saved';
            }
        } else {
            saveStatus.textContent = 'Save';
        }
    }
}

async function manualSave(saveAs = false) {
    if (window.__startupProjectRestoreInProgress) {
        alert('Project is still loading. Please wait a moment, then try Save again.');
        return;
    }

    // If running inside Electron wrapper, use native save with QDPX format
    if (window.electronAPI && window.electronAPI.saveProject) {
        try {
            const base64 = await getProjectQdpxBase64();
            
            const result = await window.electronAPI.saveProject({
                qdpxBase64: base64
            }, { saveAs, format: 'qdpx' });
            if (result && result.ok) {
                if (typeof createProjectBackup === 'function') {
                    createProjectBackup(saveAs ? 'manual-save-as' : 'manual-save', { base64 }).catch(() => {});
                }
                appData.lastSaveTime = new Date().toISOString();
                appData.hasUnsavedChanges = false;
                updateSaveStatus();
                return;
            }
            // If user cancelled, do nothing.
            return;
        } catch (err) {
            console.error('Save failed:', err);
            alert('Save failed: ' + (err?.message || err));
            return;
        }
    }

    // Browser fallback: download as QDPX
    try {
        if (typeof exportToQdpx !== 'function') {
            throw new Error('QDPX export is not available in this build.');
        }
        
        const blob = await exportToQdpx();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `quackdas-project-${new Date().toISOString().split('T')[0]}.qdpx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Save failed:', err);
        alert('Save failed: ' + (err?.message || err));
    }
}

// Statistics modal
function openStatsModal() {
    renderStatistics();
    document.getElementById('statsModal').classList.add('show');
}

function closeStatsModal() {
    document.getElementById('statsModal').classList.remove('show');
}

function renderStatistics() {
    // Calculate stats
    const totalDocs = appData.documents.length;
    const totalCodes = appData.codes.length;
    const totalSegments = appData.segments.length;
    const totalMemos = appData.memos.length;
    
    const avgCodesPerDoc = totalDocs > 0 ? (totalSegments / totalDocs).toFixed(1) : 0;
    
    // Render summary cards
    const statsGrid = document.getElementById('statsGrid');
    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Total documents</div>
            <div class="stat-value">${totalDocs}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total codes</div>
            <div class="stat-value">${totalCodes}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Coded segments</div>
            <div class="stat-value">${totalSegments}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Analytical memos</div>
            <div class="stat-value">${totalMemos}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Avg segments/doc</div>
            <div class="stat-value">${avgCodesPerDoc}</div>
        </div>
    `;
    
    const codeCountsAll = appData.codes.map(code => ({
        name: code.name,
        count: getCodeSegmentCountFast(code.id)
    })).sort((a, b) => b.count - a.count);

    const codeCounts = statsDashboardUiState.showAllMostUsedCodes
        ? codeCountsAll
        : codeCountsAll.slice(0, 4);
    const maxCodeCount = Math.max(...codeCountsAll.map(c => c.count), 1);

    const codeChart = document.getElementById('codeChart');
    codeChart.innerHTML = codeCounts.map(code => `
        <div class="chart-bar">
            <div class="chart-label">${escapeHtml(code.name)}</div>
            <div class="chart-bar-bg">
                <div class="chart-bar-fill" style="width: ${(code.count / maxCodeCount * 100)}%"></div>
                <div class="chart-value">${code.count}</div>
            </div>
        </div>
    `).join('') || '<p style="color: var(--text-secondary);">No data yet</p>';
    if (codeCountsAll.length > 4) {
        codeChart.innerHTML += `
            <div class="stats-show-more-wrap">
                <button type="button" class="btn btn-secondary stats-show-more-btn" onclick="toggleStatsMostUsedCodes()">
                    ${statsDashboardUiState.showAllMostUsedCodes ? 'Show less' : 'Show more'}
                </button>
            </div>
        `;
    }
    
    const docProgressAll = appData.documents.map(doc => ({
        name: doc.title,
        count: getDocSegmentCountFast(doc.id)
    })).sort((a, b) => b.count - a.count);

    const docProgress = statsDashboardUiState.showAllCodingProgressDocs
        ? docProgressAll
        : docProgressAll.slice(0, 4);
    const maxDocCount = Math.max(...docProgressAll.map(d => d.count), 1);

    const documentChart = document.getElementById('documentChart');
    documentChart.innerHTML = docProgress.map(doc => `
        <div class="chart-bar">
            <div class="chart-label">${escapeHtml(doc.name)}</div>
            <div class="chart-bar-bg">
                <div class="chart-bar-fill" style="width: ${(doc.count / maxDocCount * 100)}%"></div>
                <div class="chart-value">${doc.count}</div>
            </div>
        </div>
    `).join('') || '<p style="color: var(--text-secondary);">No documents yet</p>';
    if (docProgressAll.length > 4) {
        documentChart.innerHTML += `
            <div class="stats-show-more-wrap">
                <button type="button" class="btn btn-secondary stats-show-more-btn" onclick="toggleStatsCodingProgressDocs()">
                    ${statsDashboardUiState.showAllCodingProgressDocs ? 'Show less' : 'Show more'}
                </button>
            </div>
        `;
    }

    renderCaseAnalysisInStats();
}

function toggleStatsMostUsedCodes() {
    statsDashboardUiState.showAllMostUsedCodes = !statsDashboardUiState.showAllMostUsedCodes;
    renderStatistics();
}

function toggleStatsCodingProgressDocs() {
    statsDashboardUiState.showAllCodingProgressDocs = !statsDashboardUiState.showAllCodingProgressDocs;
    renderStatistics();
}

function ensureCaseAnalysisDefaults() {
    const topCodes = appData.codes
        .map((code) => ({ codeId: code.id, count: getCodeSegmentCountFast(code.id) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((item) => item.codeId);
    const validCodeIds = new Set(appData.codes.map((code) => code.id));
    caseAnalysisUiState.matrix.selectedCodeIds = caseAnalysisUiState.matrix.selectedCodeIds.filter((codeId) => validCodeIds.has(codeId));
    if (caseAnalysisUiState.matrix.selectedCodeIds.length === 0) {
        caseAnalysisUiState.matrix.selectedCodeIds = topCodes;
    }
    if (!caseAnalysisUiState.filter.codeId || !validCodeIds.has(caseAnalysisUiState.filter.codeId)) {
        caseAnalysisUiState.filter.codeId = topCodes[0] || (appData.codes[0]?.id || '');
    }
    const validCaseIds = new Set(appData.cases.map((caseItem) => caseItem.id));
    caseAnalysisUiState.filter.caseIds = caseAnalysisUiState.filter.caseIds.filter((caseId) => validCaseIds.has(caseId));
    if (!caseAnalysisUiState.summary.caseId || !validCaseIds.has(caseAnalysisUiState.summary.caseId)) {
        caseAnalysisUiState.summary.caseId = appData.cases[0]?.id || '';
    }
}

function rebuildCaseAnalysisCacheIfNeeded() {
    if (caseAnalysisCache.revision === appDataRevision) return caseAnalysisCache;

    const caseById = new Map(appData.cases.map((caseItem) => [caseItem.id, caseItem]));
    const docById = new Map(appData.documents.map((doc) => [doc.id, doc]));
    const caseDocIds = new Map();
    const docCaseIds = new Map();
    const attrValuesByKey = new Map();
    const caseIdsByAttrPair = new Map();

    appData.cases.forEach((caseItem) => {
        const docIds = new Set(Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds.filter((docId) => docById.has(docId)) : []);
        caseDocIds.set(caseItem.id, docIds);

        Object.entries(caseItem.attributes || {}).forEach(([rawKey, rawValue]) => {
            const key = String(rawKey || '').trim();
            if (!key) return;
            const value = String(rawValue == null ? '' : rawValue).trim();
            if (!attrValuesByKey.has(key)) attrValuesByKey.set(key, new Set());
            attrValuesByKey.get(key).add(value);
            const pairKey = `${key}\u0000${value}`;
            if (!caseIdsByAttrPair.has(pairKey)) caseIdsByAttrPair.set(pairKey, new Set());
            caseIdsByAttrPair.get(pairKey).add(caseItem.id);
        });
    });

    appData.documents.forEach((doc) => {
        const ids = new Set(Array.isArray(doc.caseIds) ? doc.caseIds.filter((caseId) => caseById.has(caseId)) : []);
        docCaseIds.set(doc.id, ids);
    });

    caseDocIds.forEach((docIds, caseId) => {
        docIds.forEach((docId) => {
            if (!docCaseIds.has(docId)) docCaseIds.set(docId, new Set());
            docCaseIds.get(docId).add(caseId);
        });
    });

    caseAnalysisCache = {
        revision: appDataRevision,
        caseById,
        docById,
        caseDocIds,
        docCaseIds,
        attrValuesByKey,
        caseIdsByAttrPair
    };
    if (caseCodeReferenceCountCache.revision !== appDataRevision) {
        caseCodeReferenceCountCache.revision = appDataRevision;
        caseCodeReferenceCountCache.values = new Map();
    }
    return caseAnalysisCache;
}

function getSortedCodesByHierarchy() {
    const children = new Map();
    appData.codes.forEach((code) => {
        const key = code.parentId || '__root__';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(code);
    });
    const sortFn = (a, b) => {
        const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
        const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aCreated = new Date(a.created || 0).getTime();
        const bCreated = new Date(b.created || 0).getTime();
        if (aCreated !== bCreated) return aCreated - bCreated;
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    };
    children.forEach((items) => items.sort(sortFn));

    const rows = [];
    const walk = (parentId, depth, visited) => {
        const key = parentId || '__root__';
        const items = children.get(key) || [];
        items.forEach((code) => {
            if (visited.has(code.id)) return;
            const nextVisited = new Set(visited);
            nextVisited.add(code.id);
            rows.push({ codeId: code.id, name: code.name, depth });
            walk(code.id, depth + 1, nextVisited);
        });
    };
    walk(null, 0, new Set());
    return rows;
}

function getSortedCasesByHierarchy(searchQuery = '') {
    const normalizedQuery = String(searchQuery || '').trim().toLowerCase();
    const children = new Map();
    appData.cases.forEach((caseItem) => {
        const key = caseItem.parentId || '__root__';
        if (!children.has(key)) children.set(key, []);
        children.get(key).push(caseItem);
    });
    children.forEach((items) => {
        if (typeof sortCasesByAppOrder === 'function') {
            const sorted = sortCasesByAppOrder(items);
            items.length = 0;
            items.push(...sorted);
            return;
        }
        items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    });

    const rows = [];
    const walk = (parentId, depth, visited) => {
        const key = parentId || '__root__';
        const items = children.get(key) || [];
        items.forEach((caseItem) => {
            if (visited.has(caseItem.id)) return;
            const nextVisited = new Set(visited);
            nextVisited.add(caseItem.id);
            const include = !normalizedQuery ||
                String(caseItem.name || '').toLowerCase().includes(normalizedQuery) ||
                String(caseItem.type || '').toLowerCase().includes(normalizedQuery);
            if (include) rows.push({ caseId: caseItem.id, name: caseItem.name, type: caseItem.type || '', depth });
            walk(caseItem.id, depth + 1, nextVisited);
        });
    };
    walk(null, 0, new Set());
    return rows;
}

function renderCaseAnalysisInStats() {
    const host = document.getElementById('caseAnalysisSection');
    if (!host) return;

    ensureCaseAnalysisDefaults();
    const cache = rebuildCaseAnalysisCacheIfNeeded();
    const panelFilterOpen = caseAnalysisUiState.expandedPanels.filter;
    const panelSummaryOpen = caseAnalysisUiState.expandedPanels.summary;
    const panelMatrixOpen = caseAnalysisUiState.expandedPanels.matrix;
    const panelCooccurrenceOpen = caseAnalysisUiState.expandedPanels.cooccurrence;

    const filterResults = getCaseAnalysisFilterResults();
    const summaryData = getCaseSummaryData(caseAnalysisUiState.summary.caseId);
    const matrixData = getCaseCodeMatrixData();

    const attrKeys = Array.from(cache.attrValuesByKey.keys())
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const attrValues = caseAnalysisUiState.filter.attrKey
        ? Array.from(cache.attrValuesByKey.get(caseAnalysisUiState.filter.attrKey) || []).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        : [];
    const caseRowsForFilter = getSortedCasesByHierarchy(caseAnalysisUiState.filter.caseQuery);
    const codeRowsForFilter = getSortedCodesByHierarchy().filter((row) => {
        const q = String(caseAnalysisUiState.filter.codeQuery || '').trim().toLowerCase();
        if (!q) return true;
        return String(row.name || '').toLowerCase().includes(q);
    });
    const summaryCaseRows = getSortedCasesByHierarchy(caseAnalysisUiState.summary.caseQuery);
    const matrixCodeRows = getSortedCodesByHierarchy().filter((row) => {
        const q = String(caseAnalysisUiState.matrix.codeQuery || '').trim().toLowerCase();
        if (!q) return true;
        return String(row.name || '').toLowerCase().includes(q);
    });

    host.innerHTML = `
        <h3 style="font-size: 16px; margin-bottom: 12px;">Case analysis</h3>
        <div class="case-analysis-panels">
            <section class="case-analysis-panel">
                <button class="case-analysis-panel-toggle" onclick="toggleCaseAnalysisPanel('filter')">
                    <span>Filter coded references</span>
                    <span>${panelFilterOpen ? '▾' : '▸'}</span>
                </button>
                ${panelFilterOpen ? `
                    <div class="case-analysis-panel-body">
                        <div class="case-analysis-controls-grid">
                            <div class="case-analysis-control">
                                <label class="form-label">Code</label>
                                <input class="form-input" type="text" placeholder="Search codes..." value="${escapeHtmlAttrValue(caseAnalysisUiState.filter.codeQuery)}" oninput="updateCaseAnalysisField('filter.codeQuery', this.value)">
                                <div class="case-analysis-picker-list">
                                    ${codeRowsForFilter.length === 0
                                        ? '<div class="empty-state-hint">No matching codes.</div>'
                                        : codeRowsForFilter.map((row) => `
                                            <label class="case-analysis-picker-item" style="padding-left:${8 + row.depth * 14}px;">
                                                <input type="radio" name="caseAnalysisFilterCode" value="${escapeHtmlAttrValue(row.codeId)}" ${caseAnalysisUiState.filter.codeId === row.codeId ? 'checked' : ''} onchange="updateCaseAnalysisField('filter.codeId', this.value)">
                                                <span>${escapeHtml(row.name)}</span>
                                            </label>
                                        `).join('')}
                                </div>
                            </div>
                            <div class="case-analysis-control">
                                <label class="form-label">Case filter</label>
                                <select class="form-select" onchange="updateCaseAnalysisField('filter.caseMode', this.value)">
                                    <option value="any" ${caseAnalysisUiState.filter.caseMode === 'any' ? 'selected' : ''}>Any case</option>
                                    <option value="specific" ${caseAnalysisUiState.filter.caseMode === 'specific' ? 'selected' : ''}>Specific cases...</option>
                                </select>
                                ${caseAnalysisUiState.filter.caseMode === 'specific' ? `
                                    <input class="form-input" type="text" placeholder="Search cases..." value="${escapeHtmlAttrValue(caseAnalysisUiState.filter.caseQuery)}" oninput="updateCaseAnalysisField('filter.caseQuery', this.value)">
                                    <div class="case-analysis-picker-list">
                                        ${caseRowsForFilter.length === 0
                                            ? '<div class="empty-state-hint">No matching cases.</div>'
                                            : caseRowsForFilter.map((row) => `
                                                <label class="case-analysis-picker-item" style="padding-left:${8 + row.depth * 14}px;">
                                                    <input type="checkbox" value="${escapeHtmlAttrValue(row.caseId)}" ${caseAnalysisUiState.filter.caseIds.includes(row.caseId) ? 'checked' : ''} onchange="toggleCaseAnalysisFilterCase('${escapeJsForSingleQuotedString(row.caseId)}', this.checked)">
                                                    <span>${escapeHtml(row.name)}</span>
                                                </label>
                                            `).join('')}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="case-analysis-control">
                                <label class="form-label">Attribute filter</label>
                                <select class="form-select" onchange="updateCaseAnalysisField('filter.attrKey', this.value)">
                                    <option value="">Any attribute</option>
                                    ${attrKeys.map((key) => `<option value="${escapeHtmlAttrValue(key)}" ${caseAnalysisUiState.filter.attrKey === key ? 'selected' : ''}>${escapeHtml(key)}</option>`).join('')}
                                </select>
                                <input class="form-input" list="caseAnalysisAttributeValues" type="text" placeholder="Exact value" value="${escapeHtmlAttrValue(caseAnalysisUiState.filter.attrValue)}" oninput="updateCaseAnalysisField('filter.attrValue', this.value)">
                                <datalist id="caseAnalysisAttributeValues">
                                    ${attrValues.map((value) => `<option value="${escapeHtmlAttrValue(value)}"></option>`).join('')}
                                </datalist>
                            </div>
                        </div>
                        <div class="case-analysis-result-summary">${filterResults.totalCount} matching coded segment${filterResults.totalCount === 1 ? '' : 's'}${filterResults.truncated ? ` (showing first ${filterResults.matches.length})` : ''}</div>
                        <div class="case-analysis-results-list">
                            ${filterResults.matches.length === 0
                                ? '<div class="empty-state-hint">No matches for the selected filters.</div>'
                                : filterResults.matches.map((match) => `
                                    <div class="case-analysis-result-row">
                                        <div class="case-analysis-result-main">
                                            <div class="case-analysis-result-meta"><strong>${escapeHtml(match.docTitle)}</strong> · ${escapeHtml(match.codeName)}</div>
                                            <div class="case-analysis-result-snippet">${preserveLineBreaks(escapeHtml(match.snippet))}</div>
                                        </div>
                                        <button class="btn btn-secondary case-analysis-go-btn" onclick="goToCaseAnalysisResult('${escapeJsForSingleQuotedString(match.docId)}', '${escapeJsForSingleQuotedString(match.segmentId)}')">Go to</button>
                                    </div>
                                `).join('')}
                        </div>
                    </div>
                ` : ''}
            </section>

            <section class="case-analysis-panel">
                <button class="case-analysis-panel-toggle" onclick="toggleCaseAnalysisPanel('summary')">
                    <span>Case summary</span>
                    <span>${panelSummaryOpen ? '▾' : '▸'}</span>
                </button>
                ${panelSummaryOpen ? `
                    <div class="case-analysis-panel-body">
                        <div class="case-analysis-controls-grid">
                            <div class="case-analysis-control">
                                <label class="form-label">Case</label>
                                <input class="form-input" type="text" placeholder="Search cases..." value="${escapeHtmlAttrValue(caseAnalysisUiState.summary.caseQuery)}" oninput="updateCaseAnalysisField('summary.caseQuery', this.value)">
                                <div class="case-analysis-picker-list">
                                    ${summaryCaseRows.length === 0
                                        ? '<div class="empty-state-hint">No matching cases.</div>'
                                        : summaryCaseRows.map((row) => `
                                            <label class="case-analysis-picker-item" style="padding-left:${8 + row.depth * 14}px;">
                                                <input type="radio" name="caseAnalysisSummaryCase" value="${escapeHtmlAttrValue(row.caseId)}" ${caseAnalysisUiState.summary.caseId === row.caseId ? 'checked' : ''} onchange="updateCaseAnalysisField('summary.caseId', this.value)">
                                                <span>${escapeHtml(row.name)}</span>
                                            </label>
                                        `).join('')}
                                </div>
                            </div>
                        </div>
                        ${summaryData ? `
                            <div class="case-analysis-summary-card">
                                <div class="case-analysis-summary-title">${escapeHtml(summaryData.name)}${summaryData.type ? ` · ${escapeHtml(summaryData.type)}` : ''}</div>
                                <div class="case-analysis-summary-meta">
                                    <span>${summaryData.linkedDocCount} linked document${summaryData.linkedDocCount === 1 ? '' : 's'}</span>
                                    <span>${summaryData.totalSegments} coded segment${summaryData.totalSegments === 1 ? '' : 's'}</span>
                                </div>
                                ${summaryData.attrPreview.length > 0 ? `
                                    <div class="case-analysis-attr-preview">
                                        ${summaryData.attrPreview.map((entry) => `<span>${escapeHtml(entry.key)}: ${escapeHtml(entry.value)}</span>`).join('')}
                                    </div>
                                ` : ''}
                            </div>
                            <div class="case-analysis-results-list">
                                ${summaryData.topCodes.length === 0
                                    ? '<div class="empty-state-hint">No coded segments found in linked documents.</div>'
                                    : summaryData.topCodes.map((row) => `
                                        <button class="case-analysis-summary-code-row" onclick="openCaseSummaryCodeInFilter('${escapeJsForSingleQuotedString(row.codeId)}', '${escapeJsForSingleQuotedString(summaryData.caseId)}')">
                                            <span>${escapeHtml(row.codeName)}</span>
                                            <span>${row.count}</span>
                                        </button>
                                    `).join('')}
                            </div>
                        ` : '<div class="empty-state-hint">Select a case to see summary details.</div>'}
                    </div>
                ` : ''}
            </section>

            <section class="case-analysis-panel">
                <button class="case-analysis-panel-toggle" onclick="toggleCaseAnalysisPanel('matrix')">
                    <span>Code × case matrix</span>
                    <span>${panelMatrixOpen ? '▾' : '▸'}</span>
                </button>
                ${panelMatrixOpen ? `
                    <div class="case-analysis-panel-body">
                        <div class="case-analysis-controls-grid">
                            <div class="case-analysis-control">
                                <label class="form-label">Row dimension</label>
                                <select class="form-select" onchange="updateCaseAnalysisField('matrix.rowMode', this.value)">
                                    <option value="cases" ${caseAnalysisUiState.matrix.rowMode === 'cases' ? 'selected' : ''}>Cases</option>
                                    <option value="attribute" ${caseAnalysisUiState.matrix.rowMode === 'attribute' ? 'selected' : ''}>Case attribute</option>
                                </select>
                                ${caseAnalysisUiState.matrix.rowMode === 'attribute' ? `
                                    <select class="form-select" onchange="updateCaseAnalysisField('matrix.rowAttributeKey', this.value)">
                                        <option value="">Select attribute key</option>
                                        ${attrKeys.map((key) => `<option value="${escapeHtmlAttrValue(key)}" ${caseAnalysisUiState.matrix.rowAttributeKey === key ? 'selected' : ''}>${escapeHtml(key)}</option>`).join('')}
                                    </select>
                                ` : ''}
                            </div>
                            <div class="case-analysis-control">
                                <label class="form-label">Column dimension</label>
                                <select class="form-select" onchange="updateCaseAnalysisField('matrix.codeMode', this.value)">
                                    <option value="selected" ${caseAnalysisUiState.matrix.codeMode === 'selected' ? 'selected' : ''}>Selected codes</option>
                                    <option value="group" ${caseAnalysisUiState.matrix.codeMode === 'group' ? 'selected' : ''}>Code group</option>
                                </select>
                                ${caseAnalysisUiState.matrix.codeMode === 'group' ? `
                                    <select class="form-select" onchange="updateCaseAnalysisField('matrix.codeGroupId', this.value)">
                                        <option value="">Select code group</option>
                                        ${matrixCodeRows.filter((row) => appData.codes.some((codeItem) => codeItem.parentId === row.codeId)).map((row) => `<option value="${escapeHtmlAttrValue(row.codeId)}" ${caseAnalysisUiState.matrix.codeGroupId === row.codeId ? 'selected' : ''}>${escapeHtml(row.name)}</option>`).join('')}
                                    </select>
                                ` : `
                                    <input class="form-input" type="text" placeholder="Search codes..." value="${escapeHtmlAttrValue(caseAnalysisUiState.matrix.codeQuery)}" oninput="updateCaseAnalysisField('matrix.codeQuery', this.value)">
                                    <div class="case-analysis-picker-list">
                                        ${matrixCodeRows.length === 0
                                            ? '<div class="empty-state-hint">No matching codes.</div>'
                                            : matrixCodeRows.map((row) => `
                                                <label class="case-analysis-picker-item" style="padding-left:${8 + row.depth * 14}px;">
                                                    <input type="checkbox" value="${escapeHtmlAttrValue(row.codeId)}" ${caseAnalysisUiState.matrix.selectedCodeIds.includes(row.codeId) ? 'checked' : ''} onchange="toggleCaseAnalysisMatrixCode('${escapeJsForSingleQuotedString(row.codeId)}', this.checked)">
                                                    <span>${escapeHtml(row.name)}</span>
                                                </label>
                                            `).join('')}
                                    </div>
                                `}
                            </div>
                            <div class="case-analysis-control">
                                <label class="form-label">Metric</label>
                                <select class="form-select" onchange="updateCaseAnalysisField('matrix.metric', this.value)">
                                    <option value="references" ${caseAnalysisUiState.matrix.metric === 'references' ? 'selected' : ''}>References (count)</option>
                                </select>
                            </div>
                        </div>
                        ${matrixData.columns.length === 0 || matrixData.rows.length === 0
                            ? '<div class="empty-state-hint">Choose rows and codes to render the matrix.</div>'
                            : `
                                <div class="case-analysis-matrix-wrap">
                                    <table class="case-analysis-matrix">
                                        <thead>
                                            <tr>
                                                <th>Case</th>
                                                ${matrixData.columns.map((col) => `<th>${escapeHtml(col.codeName)}</th>`).join('')}
                                                <th>Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${matrixData.rows.map((row) => `
                                                <tr>
                                                    <th>${escapeHtml(row.label)}</th>
                                                    ${row.cells.map((cell) => `
                                                        <td><button class="case-analysis-matrix-cell" onclick="openMatrixCellInFilter('${escapeJsForSingleQuotedString(cell.codeId)}', '${escapeJsForSingleQuotedString(cell.caseIds.join(','))}')">${cell.count}</button></td>
                                                    `).join('')}
                                                    <td class="case-analysis-matrix-total">${row.total}</td>
                                                </tr>
                                            `).join('')}
                                            <tr class="case-analysis-matrix-footer">
                                                <th>Total</th>
                                                ${matrixData.columnTotals.map((count) => `<td class="case-analysis-matrix-total">${count}</td>`).join('')}
                                                <td class="case-analysis-matrix-total">${matrixData.grandTotal}</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            `}
                    </div>
                ` : ''}
            </section>

            <section class="case-analysis-panel">
                <button class="case-analysis-panel-toggle" onclick="toggleCaseAnalysisPanel('cooccurrence')">
                    <span>Code co-occurrence</span>
                    <span>${panelCooccurrenceOpen ? '▾' : '▸'}</span>
                </button>
                ${panelCooccurrenceOpen ? `
                    <div class="case-analysis-panel-body">
                        <div class="cooc-layout">
                            <div class="cooc-matrix-wrap">
                                <div id="cooccurrenceMatrix"></div>
                            </div>
                            <div class="cooc-side">
                                <div class="cooc-controls">
                                    <select id="coocCodeA" class="form-select" onchange="updateCaseAnalysisCooccurrenceSelection('A', this.value)"></select>
                                    <select id="coocCodeB" class="form-select" onchange="updateCaseAnalysisCooccurrenceSelection('B', this.value)"></select>
                                </div>
                                <div id="cooccurrenceOverlaps" class="cooc-overlaps"></div>
                            </div>
                        </div>
                    </div>
                ` : ''}
            </section>
        </div>
    `;

    if (panelCooccurrenceOpen) renderCooccurrenceMatrix();
}

function toggleCaseAnalysisPanel(panelKey) {
    if (!Object.prototype.hasOwnProperty.call(caseAnalysisUiState.expandedPanels, panelKey)) return;
    caseAnalysisUiState.expandedPanels[panelKey] = !caseAnalysisUiState.expandedPanels[panelKey];
    renderCaseAnalysisInStats();
}

function updateCaseAnalysisCooccurrenceSelection(which, value) {
    const normalized = String(value || '');
    if (which === 'A') caseAnalysisUiState.cooccurrence.codeAId = normalized;
    if (which === 'B') caseAnalysisUiState.cooccurrence.codeBId = normalized;
    renderCooccurrenceOverlaps();
}

function updateCaseAnalysisField(path, value) {
    const parts = String(path || '').split('.');
    if (parts.length !== 2) return;
    const [group, key] = parts;
    if (!caseAnalysisUiState[group] || !Object.prototype.hasOwnProperty.call(caseAnalysisUiState[group], key)) return;
    caseAnalysisUiState[group][key] = String(value == null ? '' : value);

    if (group === 'filter' && key === 'caseMode' && caseAnalysisUiState.filter.caseMode !== 'specific') {
        caseAnalysisUiState.filter.caseIds = [];
        caseAnalysisUiState.filter.caseQuery = '';
    }
    if (group === 'filter' && key === 'attrKey') {
        caseAnalysisUiState.filter.attrValue = '';
    }
    if (group === 'matrix' && key === 'rowMode' && caseAnalysisUiState.matrix.rowMode !== 'attribute') {
        caseAnalysisUiState.matrix.rowAttributeKey = '';
    }

    renderCaseAnalysisInStats();
}

function toggleCaseAnalysisFilterCase(caseId, checked) {
    const next = new Set(caseAnalysisUiState.filter.caseIds);
    if (checked) next.add(caseId);
    else next.delete(caseId);
    caseAnalysisUiState.filter.caseIds = Array.from(next);
    renderCaseAnalysisInStats();
}

function toggleCaseAnalysisMatrixCode(codeId, checked) {
    const next = new Set(caseAnalysisUiState.matrix.selectedCodeIds);
    if (checked) next.add(codeId);
    else next.delete(codeId);
    caseAnalysisUiState.matrix.selectedCodeIds = Array.from(next);
    renderCaseAnalysisInStats();
}

function getDocIdSetForCaseIds(caseIds) {
    const cache = rebuildCaseAnalysisCacheIfNeeded();
    const out = new Set();
    caseIds.forEach((caseId) => {
        const docs = cache.caseDocIds.get(caseId);
        if (!docs) return;
        docs.forEach((docId) => out.add(docId));
    });
    return out;
}

function getCaseIdsFromAttributeFilter(key, value) {
    if (!key || !value) return null;
    const cache = rebuildCaseAnalysisCacheIfNeeded();
    return new Set(cache.caseIdsByAttrPair.get(`${key}\u0000${value}`) || []);
}

function getCaseAnalysisFilterDocSet() {
    const specificCaseSet = caseAnalysisUiState.filter.caseMode === 'specific'
        ? new Set(caseAnalysisUiState.filter.caseIds)
        : null;
    const attrCaseSet = getCaseIdsFromAttributeFilter(
        caseAnalysisUiState.filter.attrKey,
        caseAnalysisUiState.filter.attrValue
    );

    let effectiveCaseSet = null;
    if (specificCaseSet && attrCaseSet) {
        effectiveCaseSet = new Set(Array.from(specificCaseSet).filter((caseId) => attrCaseSet.has(caseId)));
    } else if (specificCaseSet) {
        effectiveCaseSet = specificCaseSet;
    } else if (attrCaseSet) {
        effectiveCaseSet = attrCaseSet;
    }

    if (!effectiveCaseSet) return null;
    return getDocIdSetForCaseIds(Array.from(effectiveCaseSet));
}

function getCaseAnalysisFilterResults() {
    const codeId = caseAnalysisUiState.filter.codeId;
    if (!codeId) {
        return { matches: [], totalCount: 0, truncated: false };
    }
    const code = appData.codes.find((item) => item.id === codeId);
    if (!code) return { matches: [], totalCount: 0, truncated: false };

    const allowedDocSet = getCaseAnalysisFilterDocSet();
    const allMatches = getSegmentsForCode(codeId).filter((segment) => {
        if (!allowedDocSet) return true;
        return allowedDocSet.has(segment.docId);
    });
    const docTitleById = new Map(
        appData.documents.map((doc) => [doc.id, String(doc.title || '')])
    );

    allMatches.sort((a, b) => {
        const aDoc = docTitleById.get(a.docId) || '';
        const bDoc = docTitleById.get(b.docId) || '';
        const titleCmp = aDoc.localeCompare(bDoc, undefined, { sensitivity: 'base' });
        if (titleCmp !== 0) return titleCmp;
        return Number(a.startIndex || 0) - Number(b.startIndex || 0);
    });

    const limited = allMatches.slice(0, caseAnalysisUiState.filter.resultLimit).map((segment) => {
        const docTitle = docTitleById.get(segment.docId);
        const snippet = String(segment.text || '').trim() || '[No text available]';
        return {
            segmentId: segment.id,
            docId: segment.docId,
            docTitle: docTitle || 'Unknown document',
            codeId,
            codeName: code.name,
            snippet: snippet.length > 240 ? `${snippet.slice(0, 237)}...` : snippet
        };
    });

    return {
        matches: limited,
        totalCount: allMatches.length,
        truncated: allMatches.length > limited.length
    };
}

function getCaseSummaryData(caseId) {
    const caseItem = appData.cases.find((item) => item.id === caseId);
    if (!caseItem) return null;

    const linkedDocIds = Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds : [];
    const linkedDocIdSet = new Set(linkedDocIds);
    const codeCounts = new Map();
    let totalSegments = 0;

    linkedDocIds.forEach((docId) => {
        const segments = getSegmentsForDoc(docId);
        totalSegments += segments.length;
        segments.forEach((segment) => {
            (segment.codeIds || []).forEach((codeId) => {
                codeCounts.set(codeId, (codeCounts.get(codeId) || 0) + 1);
            });
        });
    });
    const codeNameById = new Map(appData.codes.map((item) => [item.id, item.name]));

    const topCodes = Array.from(codeCounts.entries())
        .map(([codeId, count]) => {
            const codeName = codeNameById.get(codeId);
            return codeName ? { codeId, codeName, count } : null;
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.codeName.localeCompare(b.codeName, undefined, { sensitivity: 'base' });
        })
        .slice(0, 15);

    const attrPreview = Object.entries(caseItem.attributes || {})
        .slice(0, 3)
        .map(([key, value]) => ({ key, value: String(value == null ? '' : value) }));

    return {
        caseId: caseItem.id,
        name: caseItem.name,
        type: caseItem.type || '',
        attrPreview,
        linkedDocCount: linkedDocIdSet.size,
        totalSegments,
        topCodes
    };
}

function getCaseCodeReferenceCount(caseId, codeId) {
    if (!caseId || !codeId) return 0;
    rebuildCaseAnalysisCacheIfNeeded();
    const cacheKey = `${caseId}\u0000${codeId}`;
    if (caseCodeReferenceCountCache.revision === appDataRevision && caseCodeReferenceCountCache.values.has(cacheKey)) {
        return caseCodeReferenceCountCache.values.get(cacheKey) || 0;
    }

    const docSet = getDocIdSetForCaseIds([caseId]);
    let count = 0;
    getSegmentsForCode(codeId).forEach((segment) => {
        if (docSet.has(segment.docId)) count += 1;
    });
    caseCodeReferenceCountCache.values.set(cacheKey, count);
    return count;
}

function getCodeColumnsForMatrix() {
    const codeById = new Map(appData.codes.map((code) => [code.id, code]));

    if (caseAnalysisUiState.matrix.codeMode === 'group') {
        const rootId = caseAnalysisUiState.matrix.codeGroupId;
        const root = codeById.get(rootId);
        if (!root) return [];
        let codeIds = [rootId];
        if (typeof getDescendantCodeIds === 'function') {
            codeIds = codeIds.concat(getDescendantCodeIds(rootId));
        }
        return Array.from(new Set(codeIds))
            .map((codeId) => codeById.get(codeId))
            .filter(Boolean)
            .map((code) => ({ codeId: code.id, codeName: code.name }));
    }

    const valid = new Set(appData.codes.map((code) => code.id));
    return caseAnalysisUiState.matrix.selectedCodeIds
        .filter((codeId) => valid.has(codeId))
        .map((codeId) => codeById.get(codeId))
        .filter(Boolean)
        .map((code) => ({ codeId: code.id, codeName: code.name }));
}

function getMatrixRowBuckets() {
    if (caseAnalysisUiState.matrix.rowMode === 'attribute') {
        const key = caseAnalysisUiState.matrix.rowAttributeKey;
        if (!key) return [];
        const groups = new Map();
        appData.cases.forEach((caseItem) => {
            const rawValue = caseItem.attributes && Object.prototype.hasOwnProperty.call(caseItem.attributes, key)
                ? caseItem.attributes[key]
                : '(missing)';
            const value = String(rawValue == null ? '(missing)' : rawValue).trim() || '(missing)';
            if (!groups.has(value)) groups.set(value, []);
            groups.get(value).push(caseItem.id);
        });
        return Array.from(groups.entries())
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
            .map(([label, caseIds]) => ({ label, caseIds }));
    }

    return getSortedCasesByHierarchy()
        .map((row) => ({
            label: `${row.depth > 0 ? `${' '.repeat(row.depth * 2)}↳ ` : ''}${row.name}`,
            caseIds: [row.caseId]
        }));
}

function getMatrixCodeDocCountMap(columns) {
    const map = new Map();
    columns.forEach((col) => {
        const perDoc = new Map();
        getSegmentsForCode(col.codeId).forEach((segment) => {
            const docId = segment.docId;
            perDoc.set(docId, (perDoc.get(docId) || 0) + 1);
        });
        map.set(col.codeId, perDoc);
    });
    return map;
}

function getCaseCodeMatrixData() {
    const columns = getCodeColumnsForMatrix();
    const rowBuckets = getMatrixRowBuckets();
    if (columns.length === 0 || rowBuckets.length === 0) {
        return { columns: [], rows: [], columnTotals: [], grandTotal: 0 };
    }

    const perCodePerDoc = getMatrixCodeDocCountMap(columns);
    const rows = [];
    const columnTotals = Array(columns.length).fill(0);
    let grandTotal = 0;

    rowBuckets.forEach((bucket) => {
        const docSet = getDocIdSetForCaseIds(bucket.caseIds);
        const cells = columns.map((col, idx) => {
            let count = 0;
            if (caseAnalysisUiState.matrix.rowMode === 'cases' && bucket.caseIds.length === 1) {
                count = getCaseCodeReferenceCount(bucket.caseIds[0], col.codeId);
            } else {
                const perDoc = perCodePerDoc.get(col.codeId) || new Map();
                docSet.forEach((docId) => {
                    count += (perDoc.get(docId) || 0);
                });
            }
            columnTotals[idx] += count;
            grandTotal += count;
            return {
                codeId: col.codeId,
                caseIds: bucket.caseIds,
                count
            };
        });
        const total = cells.reduce((sum, cell) => sum + cell.count, 0);
        rows.push({
            label: bucket.label,
            caseIds: bucket.caseIds,
            cells,
            total
        });
    });

    return { columns, rows, columnTotals, grandTotal };
}

function goToCaseAnalysisResult(docId, segmentId) {
    closeStatsModal();
    goToSegmentLocation(docId, segmentId);
}

function openCaseSummaryCodeInFilter(codeId, caseId) {
    caseAnalysisUiState.filter.codeId = codeId;
    caseAnalysisUiState.filter.caseMode = 'specific';
    caseAnalysisUiState.filter.caseIds = [caseId];
    caseAnalysisUiState.expandedPanels.filter = true;
    caseAnalysisUiState.expandedPanels.summary = false;
    renderCaseAnalysisInStats();
}

function openMatrixCellInFilter(codeId, caseIdsCsv) {
    const caseIds = String(caseIdsCsv || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    caseAnalysisUiState.filter.codeId = codeId;
    if (caseIds.length > 0) {
        caseAnalysisUiState.filter.caseMode = 'specific';
        caseAnalysisUiState.filter.caseIds = caseIds;
    } else {
        caseAnalysisUiState.filter.caseMode = 'any';
        caseAnalysisUiState.filter.caseIds = [];
    }
    caseAnalysisUiState.expandedPanels.filter = true;
    caseAnalysisUiState.expandedPanels.matrix = false;
    renderCaseAnalysisInStats();
}

let lastHealthCheckReport = null;

function getHealthIssueReport() {
    const docIds = new Set(appData.documents.map(doc => doc.id));
    const codeIds = new Set(appData.codes.map(code => code.id));
    const segmentIds = new Set(appData.segments.map(seg => seg.id));

    const emptyCodes = appData.codes.filter(code => getCodeSegmentCountFast(code.id) === 0);
    const orphanSegments = appData.segments.filter(seg => !docIds.has(seg.docId));
    const segmentsWithoutCodes = appData.segments.filter(seg => !Array.isArray(seg.codeIds) || seg.codeIds.length === 0);
    const segmentsWithUnknownCodes = appData.segments.filter(seg =>
        Array.isArray(seg.codeIds) && seg.codeIds.some(codeId => !codeIds.has(codeId))
    );

    const duplicateNameGroups = {};
    appData.codes.forEach(code => {
        const key = String(code.name || '').trim().toLowerCase();
        if (!key) return;
        if (!duplicateNameGroups[key]) duplicateNameGroups[key] = [];
        duplicateNameGroups[key].push(code.id);
    });
    const duplicateCodeGroups = Object.values(duplicateNameGroups).filter(group => group.length > 1);

    const looseCodeNameGroups = {};
    appData.codes.forEach(code => {
        const loose = String(code.name || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
        if (!loose) return;
        if (!looseCodeNameGroups[loose]) looseCodeNameGroups[loose] = [];
        looseCodeNameGroups[loose].push(code.id);
    });
    const nearDuplicateGroups = Object.values(looseCodeNameGroups).filter(group => {
        if (group.length < 2) return false;
        const strictNames = new Set(group.map(id => {
            const code = appData.codes.find(c => c.id === id);
            return String(code?.name || '').trim().toLowerCase();
        }));
        return strictNames.size > 1;
    });

    const docsMissingMetadata = appData.documents.filter(doc => {
        const meta = doc.metadata || {};
        return !String(meta.participantId || '').trim() &&
            !String(meta.date || '').trim() &&
            !String(meta.location || '').trim();
    });

    const memoTargetsMissing = appData.memos.filter(memo => {
        if (!memo.targetId) return false;
        if (memo.type === 'document') return !docIds.has(memo.targetId);
        if (memo.type === 'code') return !codeIds.has(memo.targetId);
        if (memo.type === 'segment') {
            if (!segmentIds.has(memo.targetId)) return true;
            const memoCodeId = String(memo.codeId || '').trim();
            if (!memoCodeId) return false;
            if (!codeIds.has(memoCodeId)) return true;
            const segment = appData.segments.find(seg => seg.id === memo.targetId);
            return !(segment && Array.isArray(segment.codeIds) && segment.codeIds.includes(memoCodeId));
        }
        return false;
    });

    const invalidPdfRegions = appData.segments.filter(seg => {
        if (!seg.pdfRegion) return false;
        const r = seg.pdfRegion;
        if (!Number.isFinite(Number(r.pageNum)) || Number(r.pageNum) < 1) return true;
        const vals = [r.xNorm, r.yNorm, r.wNorm, r.hNorm, r.x, r.y, r.width, r.height];
        return vals.some(v => v !== undefined && !Number.isFinite(Number(v)));
    });

    const memosMissingEdited = appData.memos.filter(memo => !memo.edited);

    const findings = [];
    if (emptyCodes.length) findings.push({ label: 'Empty codes', count: emptyCodes.length });
    if (orphanSegments.length) findings.push({ label: 'Orphan segments (missing document)', count: orphanSegments.length });
    if (segmentsWithoutCodes.length) findings.push({ label: 'Segments with no codes', count: segmentsWithoutCodes.length });
    if (segmentsWithUnknownCodes.length) findings.push({ label: 'Segments referencing unknown/deleted codes', count: segmentsWithUnknownCodes.length });
    if (duplicateCodeGroups.length) findings.push({ label: 'Duplicate code-name groups (case-insensitive)', count: duplicateCodeGroups.length });
    if (nearDuplicateGroups.length) findings.push({ label: 'Near-duplicate code-name groups (punctuation/spacing)', count: nearDuplicateGroups.length });
    if (docsMissingMetadata.length) findings.push({ label: 'Documents missing core metadata (ID/date/location)', count: docsMissingMetadata.length });
    if (memoTargetsMissing.length) findings.push({ label: 'Annotations linked to missing targets', count: memoTargetsMissing.length });
    if (invalidPdfRegions.length) findings.push({ label: 'Segments with invalid PDF region data', count: invalidPdfRegions.length });
    if (memosMissingEdited.length) findings.push({ label: 'Annotations missing edited timestamp', count: memosMissingEdited.length });

    const fixes = [];
    if (orphanSegments.length) fixes.push({ id: 'remove-orphan-segments', label: `Remove orphan segments (${orphanSegments.length})` });
    if (segmentsWithoutCodes.length) fixes.push({ id: 'remove-empty-segments', label: `Remove segments with no codes (${segmentsWithoutCodes.length})` });
    if (segmentsWithUnknownCodes.length) fixes.push({ id: 'strip-unknown-code-refs', label: `Strip unknown code refs from segments (${segmentsWithUnknownCodes.length})` });
    if (duplicateCodeGroups.length) fixes.push({ id: 'rename-duplicate-codes', label: `Auto-rename duplicate code names (${duplicateCodeGroups.length} groups)` });
    if (memoTargetsMissing.length) fixes.push({ id: 'remove-orphan-memos', label: `Remove annotations linked to missing targets (${memoTargetsMissing.length})` });
    if (invalidPdfRegions.length) fixes.push({ id: 'normalize-pdf-regions', label: `Normalize PDF region geometry (${invalidPdfRegions.length})` });
    if (memosMissingEdited.length) fixes.push({ id: 'fill-memo-edited', label: `Fill missing annotation edited timestamps (${memosMissingEdited.length})` });

    return {
        summary: {
            documents: appData.documents.length,
            codes: appData.codes.length,
            segments: appData.segments.length,
            annotations: appData.memos.length
        },
        findings,
        fixes
    };
}

function renderProjectHealthCheckModal(report) {
    const summaryEl = document.getElementById('healthCheckSummary');
    const findingsEl = document.getElementById('healthCheckFindings');
    const fixesEl = document.getElementById('healthCheckFixes');
    if (!summaryEl || !findingsEl || !fixesEl) return;

    summaryEl.innerHTML = `
        <span><strong>Documents:</strong> ${report.summary.documents}</span>
        <span><strong>Codes:</strong> ${report.summary.codes}</span>
        <span><strong>Segments:</strong> ${report.summary.segments}</span>
        <span><strong>Annotations:</strong> ${report.summary.annotations}</span>
    `;

    if (report.findings.length === 0) {
        findingsEl.innerHTML = '<div class="health-check-ok">No structural issues detected.</div>';
    } else {
        findingsEl.innerHTML = report.findings.map(item => `
            <div class="health-check-item">
                <span>${escapeHtml(item.label)}</span>
                <strong>${item.count}</strong>
            </div>
        `).join('');
    }

    if (report.fixes.length === 0) {
        fixesEl.innerHTML = '<div class="health-check-ok">No automatic fixes available.</div>';
    } else {
        fixesEl.innerHTML = report.fixes.map((fix, idx) => `
            <label class="health-fix-item">
                <input type="checkbox" class="health-fix-checkbox" value="${escapeHtmlAttrValue(fix.id)}" ${idx === 0 ? 'checked' : ''}>
                <span>${escapeHtml(fix.label)}</span>
            </label>
        `).join('');
    }
}

function runProjectHealthCheck() {
    lastHealthCheckReport = getHealthIssueReport();
    renderProjectHealthCheckModal(lastHealthCheckReport);
    const modal = document.getElementById('healthCheckModal');
    if (modal) modal.classList.add('show');
}

function closeHealthCheckModal() {
    const modal = document.getElementById('healthCheckModal');
    if (modal) modal.classList.remove('show');
}

function applySelectedHealthFixes() {
    const modal = document.getElementById('healthCheckModal');
    if (!modal) return;
    const selectedFixIds = Array.from(modal.querySelectorAll('.health-fix-checkbox:checked')).map(cb => cb.value);
    if (selectedFixIds.length === 0) return;

    if (!confirm(`Apply ${selectedFixIds.length} selected fix${selectedFixIds.length === 1 ? '' : 'es'}?`)) {
        return;
    }

    saveHistory();
    let changed = 0;

    const docIds = new Set(appData.documents.map(doc => doc.id));
    const codeIds = new Set(appData.codes.map(code => code.id));
    if (selectedFixIds.includes('remove-orphan-segments')) {
        const before = appData.segments.length;
        appData.segments = appData.segments.filter(seg => docIds.has(seg.docId));
        changed += (before - appData.segments.length);
    }

    if (selectedFixIds.includes('remove-empty-segments')) {
        const before = appData.segments.length;
        appData.segments = appData.segments.filter(seg => Array.isArray(seg.codeIds) && seg.codeIds.length > 0);
        changed += (before - appData.segments.length);
    }

    if (selectedFixIds.includes('strip-unknown-code-refs')) {
        appData.segments.forEach(seg => {
            if (!Array.isArray(seg.codeIds)) return;
            const beforeLen = seg.codeIds.length;
            seg.codeIds = seg.codeIds.filter(codeId => codeIds.has(codeId));
            if (seg.codeIds.length !== beforeLen) changed += 1;
        });
        const before = appData.segments.length;
        appData.segments = appData.segments.filter(seg => Array.isArray(seg.codeIds) && seg.codeIds.length > 0);
        changed += (before - appData.segments.length);
    }

    if (selectedFixIds.includes('rename-duplicate-codes')) {
        const seen = {};
        appData.codes.forEach(code => {
            const base = String(code.name || '').trim() || 'Code';
            const key = base.toLowerCase();
            seen[key] = (seen[key] || 0) + 1;
            if (seen[key] > 1) {
                code.name = `${base} (${seen[key]})`;
                changed += 1;
            }
        });
    }

    if (selectedFixIds.includes('remove-orphan-memos')) {
        const before = appData.memos.length;
        appData.memos = appData.memos.filter(memo => {
            if (!memo.targetId) return true;
            if (memo.type === 'document') return appData.documents.some(doc => doc.id === memo.targetId);
            if (memo.type === 'code') return appData.codes.some(code => code.id === memo.targetId);
            if (memo.type === 'segment') {
                const segment = appData.segments.find(seg => seg.id === memo.targetId);
                if (!segment) return false;
                const memoCodeId = String(memo.codeId || '').trim();
                if (!memoCodeId) return true;
                if (!appData.codes.some(code => code.id === memoCodeId)) return false;
                return Array.isArray(segment.codeIds) && segment.codeIds.includes(memoCodeId);
            }
            return true;
        });
        changed += (before - appData.memos.length);
    }

    if (selectedFixIds.includes('normalize-pdf-regions')) {
        appData.segments.forEach(seg => {
            if (!seg.pdfRegion) return;
            if (typeof normalizePdfRegionShape === 'function') {
                seg.pdfRegion = normalizePdfRegionShape(seg.pdfRegion);
                changed += 1;
            }
        });
    }

    if (selectedFixIds.includes('fill-memo-edited')) {
        appData.memos.forEach(memo => {
            if (memo.edited) return;
            memo.edited = memo.created || new Date().toISOString();
            changed += 1;
        });
    }

    if (changed > 0) {
        saveData();
        renderAll();
    }

    lastHealthCheckReport = getHealthIssueReport();
    renderProjectHealthCheckModal(lastHealthCheckReport);
}

function getTopCodesForCooccurrence(limit = 24) {
    return appData.codes
        .map(code => ({ code, count: getCodeSegmentCountFast(code.id) }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(item => item.code);
}

function renderCooccurrenceMatrix() {
    const wrap = document.getElementById('cooccurrenceMatrix');
    const selectA = document.getElementById('coocCodeA');
    const selectB = document.getElementById('coocCodeB');
    if (!wrap || !selectA || !selectB) return;

    const codes = getTopCodesForCooccurrence(24);
    if (codes.length < 2) {
        wrap.innerHTML = '<p style="color: var(--text-secondary);">Need at least two codes for co-occurrence analysis.</p>';
        selectA.innerHTML = '<option value="">Select code</option>';
        selectB.innerHTML = '<option value="">Select code</option>';
        renderCooccurrenceOverlaps();
        return;
    }

    const codeOptions = '<option value="">Select code</option>' + codes
        .map(c => `<option value="${escapeHtmlAttrValue(c.id)}">${escapeHtml(c.name)}</option>`)
        .join('');
    selectA.innerHTML = codeOptions;
    selectB.innerHTML = codeOptions;
    if (caseAnalysisUiState.cooccurrence.codeAId && codes.some((c) => c.id === caseAnalysisUiState.cooccurrence.codeAId)) {
        selectA.value = caseAnalysisUiState.cooccurrence.codeAId;
    }
    if (caseAnalysisUiState.cooccurrence.codeBId && codes.some((c) => c.id === caseAnalysisUiState.cooccurrence.codeBId)) {
        selectB.value = caseAnalysisUiState.cooccurrence.codeBId;
    }
    if (!selectA.value && codes[0]) selectA.value = codes[0].id;
    if (!selectB.value && codes[1]) selectB.value = codes[1].id;
    caseAnalysisUiState.cooccurrence.codeAId = selectA.value || '';
    caseAnalysisUiState.cooccurrence.codeBId = selectB.value || '';

    const indexById = new Map(codes.map((c, idx) => [c.id, idx]));
    const matrix = Array.from({ length: codes.length }, () => Array(codes.length).fill(0));
    appData.segments.forEach(seg => {
        const ids = Array.isArray(seg.codeIds) ? Array.from(new Set(seg.codeIds.filter(id => indexById.has(id)))) : [];
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const a = indexById.get(ids[i]);
                const b = indexById.get(ids[j]);
                matrix[a][b] += 1;
                matrix[b][a] += 1;
            }
        }
    });

    let html = '<table class="cooc-table"><thead><tr><th>Code</th>';
    html += codes.map(c => `<th title="${escapeHtmlAttrValue(c.name)}">${escapeHtml(c.name).slice(0, 18)}</th>`).join('');
    html += '</tr></thead><tbody>';
    codes.forEach((rowCode, i) => {
        html += `<tr><th title="${escapeHtmlAttrValue(rowCode.name)}">${escapeHtml(rowCode.name).slice(0, 18)}</th>`;
        for (let j = 0; j < codes.length; j++) {
            if (i === j) {
                html += '<td>—</td>';
            } else {
                const v = matrix[i][j];
                html += `<td class="cooc-cell" title="Find overlaps" onclick="selectCooccurrencePair('${escapeJsForSingleQuotedString(rowCode.id)}','${escapeJsForSingleQuotedString(codes[j].id)}')">${v}</td>`;
            }
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    renderCooccurrenceOverlaps();
}

function selectCooccurrencePair(codeAId, codeBId) {
    const selectA = document.getElementById('coocCodeA');
    const selectB = document.getElementById('coocCodeB');
    if (!selectA || !selectB) return;
    selectA.value = codeAId;
    selectB.value = codeBId;
    caseAnalysisUiState.cooccurrence.codeAId = selectA.value || '';
    caseAnalysisUiState.cooccurrence.codeBId = selectB.value || '';
    renderCooccurrenceOverlaps();
}

function renderCooccurrenceOverlaps() {
    const selectA = document.getElementById('coocCodeA');
    const selectB = document.getElementById('coocCodeB');
    const out = document.getElementById('cooccurrenceOverlaps');
    if (!selectA || !selectB || !out) return;
    const codeAId = selectA.value;
    const codeBId = selectB.value;
    caseAnalysisUiState.cooccurrence.codeAId = codeAId || '';
    caseAnalysisUiState.cooccurrence.codeBId = codeBId || '';
    if (!codeAId || !codeBId || codeAId === codeBId) {
        out.innerHTML = '<p style="color: var(--text-secondary); margin: 4px;">Select two different codes.</p>';
        return;
    }

    const codeA = appData.codes.find(c => c.id === codeAId);
    const codeB = appData.codes.find(c => c.id === codeBId);
    const overlaps = appData.segments
        .filter(seg => Array.isArray(seg.codeIds) && seg.codeIds.includes(codeAId) && seg.codeIds.includes(codeBId))
        .sort((a, b) => {
            if (a.docId !== b.docId) return String(a.docId).localeCompare(String(b.docId));
            const ap = a.pdfRegion ? (a.pdfRegion.pageNum || 0) * 100000 + Math.floor((a.pdfRegion.yNorm || 0) * 10000) : (a.startIndex || 0);
            const bp = b.pdfRegion ? (b.pdfRegion.pageNum || 0) * 100000 + Math.floor((b.pdfRegion.yNorm || 0) * 10000) : (b.startIndex || 0);
            return ap - bp;
        });

    if (overlaps.length === 0) {
        out.innerHTML = `<p style="color: var(--text-secondary); margin: 4px;">No overlaps between ${escapeHtml(codeA?.name || 'Code A')} and ${escapeHtml(codeB?.name || 'Code B')}.</p>`;
        return;
    }

    out.innerHTML = `
        <div style="font-size:12px;color:var(--text-secondary);margin:4px 0 8px;">
            ${overlaps.length} overlap${overlaps.length !== 1 ? 's' : ''} · ${escapeHtml(codeA?.name || '')} × ${escapeHtml(codeB?.name || '')}
        </div>
        ${overlaps.map(seg => {
            const doc = appData.documents.find(d => d.id === seg.docId);
            const loc = seg.pdfRegion ? `Page ${seg.pdfRegion.pageNum || '?'}` : `Char ${seg.startIndex || 0}`;
            const snippet = escapeHtml(String(seg.text || '').slice(0, 220));
            return `<div class="cooc-overlap-item" onclick="goToCaseAnalysisResult('${escapeJsForSingleQuotedString(seg.docId)}','${escapeJsForSingleQuotedString(seg.id)}')">
                <div><strong>${escapeHtml(doc?.title || 'Document')}</strong> · ${escapeHtml(loc)}</div>
                <div>${snippet}${snippet.length >= 220 ? '…' : ''}</div>
            </div>`;
        }).join('')}
    `;
}
