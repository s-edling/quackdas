/**
 * Quackdas - UI Utilities
 * Context menus, modals, zoom, save status, statistics
 */

// Text prompt modal state
let _textPromptResolve = null;
let projectBackupTimer = null;
let projectBackupInFlight = false;
let lastBackedUpRevision = 0;

function hasAnyProjectData() {
    return (appData.documents.length + appData.codes.length + appData.segments.length + appData.folders.length + appData.memos.length) > 0;
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
        let base64 = options.base64 || null;
        if (!base64) {
            if (typeof exportToQdpx !== 'function') return false;
            const blob = await exportToQdpx();
            const arrayBuffer = await blob.arrayBuffer();
            base64 = arrayBufferToBase64(arrayBuffer);
        }

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
    return (appData.documents.length + appData.codes.length + appData.segments.length + appData.folders.length + appData.memos.length) > 0;
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
                    <button class="btn btn-secondary backup-restore-btn" onclick="restoreBackupById('${escapeHtml(String(backup.id))}')">Restore</button>
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
    let html = `<div class="folder-selection-item ${!doc.folderId ? 'selected' : ''}" onclick="selectFolderForMove(null)">
        <span class="folder-icon">📁</span> Root (no folder)
    </div>`;
    
    html += renderFolderSelectionTree(null, 0, doc.folderId);
    
    list.innerHTML = html;
    modal.classList.add('show');
}

function renderFolderSelectionTree(parentId, depth, currentFolderId) {
    const folders = appData.folders.filter(f => f.parentId === parentId);
    if (folders.length === 0) return '';
    
    let html = '';
    folders.forEach(folder => {
        const isSelected = folder.id === currentFolderId;
        const indent = depth * 20;
        html += `<div class="folder-selection-item ${isSelected ? 'selected' : ''}" style="padding-left: ${16 + indent}px;" onclick="selectFolderForMove('${folder.id}')">
            <span class="folder-icon">📁</span> ${escapeHtml(folder.name)}
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
        { label: `Delete code: ${code.name}`, onClick: () => deleteCode(codeId, { stopPropagation: () => {} }), danger: true }
    ], event.clientX, event.clientY);
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
            // Generate QDPX blob
            if (typeof exportToQdpx !== 'function') {
                throw new Error('QDPX export not available');
            }
            
            const blob = await exportToQdpx();
            const arrayBuffer = await blob.arrayBuffer();
            const base64 = arrayBufferToBase64(arrayBuffer);
            
            const result = await window.electronAPI.saveProject(base64, { saveAs, isQdpx: true });
            if (result && result.ok) {
                appData.lastSaveTime = new Date().toISOString();
                appData.hasUnsavedChanges = false;
                updateSaveStatus();
                if (typeof createProjectBackup === 'function') {
                    createProjectBackup(saveAs ? 'manual-save-as' : 'manual-save', { force: true, base64 }).catch(() => {});
                }
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
            // Fall back to JSON if QDPX not available
            const dataStr = JSON.stringify(appData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `quackdas-project-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            return;
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
            <div class="stat-label">Total Documents</div>
            <div class="stat-value">${totalDocs}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total Codes</div>
            <div class="stat-value">${totalCodes}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Coded Segments</div>
            <div class="stat-value">${totalSegments}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Analytical Memos</div>
            <div class="stat-value">${totalMemos}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Avg Segments/Doc</div>
            <div class="stat-value">${avgCodesPerDoc}</div>
        </div>
    `;
    
    // Most used codes chart (using precomputed index)
    const codeCounts = appData.codes.map(code => ({
        name: code.name,
        count: getCodeSegmentCountFast(code.id)
    })).sort((a, b) => b.count - a.count).slice(0, 10);
    
    const maxCodeCount = Math.max(...codeCounts.map(c => c.count), 1);
    
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
    
    // Document coding progress chart (using precomputed index)
    const docProgress = appData.documents.map(doc => ({
        name: doc.title,
        count: getDocSegmentCountFast(doc.id)
    })).sort((a, b) => b.count - a.count);
    
    const maxDocCount = Math.max(...docProgress.map(d => d.count), 1);
    
    const documentChart = document.getElementById('documentChart');
    documentChart.innerHTML = docProgress.map(doc => `
        <div class="chart-bar">
            <div class="chart-label">${doc.name}</div>
            <div class="chart-bar-bg">
                <div class="chart-bar-fill" style="width: ${(doc.count / maxDocCount * 100)}%"></div>
                <div class="chart-value">${doc.count}</div>
            </div>
        </div>
    `).join('') || '<p style="color: var(--text-secondary);">No documents yet</p>';
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
        if (memo.type === 'segment') return !segmentIds.has(memo.targetId);
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
                <input type="checkbox" class="health-fix-checkbox" value="${escapeHtml(fix.id)}" ${idx === 0 ? 'checked' : ''}>
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
            if (memo.type === 'segment') return appData.segments.some(seg => seg.id === memo.targetId);
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

function openCooccurrenceModal() {
    const modal = document.getElementById('cooccurrenceModal');
    if (!modal) return;
    renderCooccurrenceMatrix();
    modal.classList.add('show');
}

function closeCooccurrenceModal() {
    const modal = document.getElementById('cooccurrenceModal');
    if (modal) modal.classList.remove('show');
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
        .map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
        .join('');
    selectA.innerHTML = codeOptions;
    selectB.innerHTML = codeOptions;
    if (!selectA.value && codes[0]) selectA.value = codes[0].id;
    if (!selectB.value && codes[1]) selectB.value = codes[1].id;

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
    html += codes.map(c => `<th title="${escapeHtml(c.name)}">${escapeHtml(c.name).slice(0, 18)}</th>`).join('');
    html += '</tr></thead><tbody>';
    codes.forEach((rowCode, i) => {
        html += `<tr><th title="${escapeHtml(rowCode.name)}">${escapeHtml(rowCode.name).slice(0, 18)}</th>`;
        for (let j = 0; j < codes.length; j++) {
            if (i === j) {
                html += '<td>—</td>';
            } else {
                const v = matrix[i][j];
                html += `<td class="cooc-cell" onclick="selectCooccurrencePair('${rowCode.id}', '${codes[j].id}')" title="Find overlaps">${v}</td>`;
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
    renderCooccurrenceOverlaps();
}

function renderCooccurrenceOverlaps() {
    const selectA = document.getElementById('coocCodeA');
    const selectB = document.getElementById('coocCodeB');
    const out = document.getElementById('cooccurrenceOverlaps');
    if (!selectA || !selectB || !out) return;
    const codeAId = selectA.value;
    const codeBId = selectB.value;
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
            return `<div class="cooc-overlap-item" onclick="goToSegmentLocation('${seg.docId}', '${seg.id}')">
                <div><strong>${escapeHtml(doc?.title || 'Document')}</strong> · ${escapeHtml(loc)}</div>
                <div>${snippet}${snippet.length >= 220 ? '…' : ''}</div>
            </div>`;
        }).join('')}
    `;
}
