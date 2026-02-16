/**
 * Quackdas - UI Utilities
 * Context menus, modals, zoom, save status, statistics
 */

// Text prompt modal state
let _textPromptResolve = null;

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
            <div class="chart-label">${code.name}</div>
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
