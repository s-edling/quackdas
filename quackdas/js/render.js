/**
 * Quackdas - Rendering Functions
 * All UI rendering logic
 */

function renderAll() {
    renderDocuments();
    renderCodes();
    if (typeof renderCases === 'function') renderCases();
    renderCurrentDocument();
    applyZoom();
    if (typeof refreshInPageSearchAfterRender === 'function') refreshInPageSearchAfterRender();
    if (typeof updateHeaderPrimaryAction === 'function') updateHeaderPrimaryAction();
}

function updateCompactDocumentTitleLineClasses(scope) {
    const root = scope || document;
    const titleEls = root.querySelectorAll('.document-item.document-item-compact .document-item-title-text');
    titleEls.forEach((titleEl) => {
        const card = titleEl.closest('.document-item.document-item-compact');
        if (!card) return;
        const isSingleLine = Math.ceil(titleEl.scrollHeight) <= Math.ceil(titleEl.clientHeight) + 1;
        card.classList.toggle('document-item-single-line-title', isSingleLine);
    });
}

function renderDocuments() {
    const allList = document.getElementById('documentsList');
    const recentList = document.getElementById('recentDocumentsList');
    const ROOT_KEY = '__root__';
    const folderChildrenByParent = new Map();
    const docsByFolder = new Map();
    const docTitleCompare = (a, b) => String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    const folderIconSvg = `<svg class="toolbar-icon folder-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-1.2 8a2 2 0 0 1-2 1.7H6.2a2 2 0 0 1-2-1.7z"/></svg>`;

    for (const folder of appData.folders) {
        const parentKey = folder.parentId || ROOT_KEY;
        if (!folderChildrenByParent.has(parentKey)) folderChildrenByParent.set(parentKey, []);
        folderChildrenByParent.get(parentKey).push(folder);
    }
    for (const doc of appData.documents) {
        const folderKey = doc.folderId || ROOT_KEY;
        if (!docsByFolder.has(folderKey)) docsByFolder.set(folderKey, []);
        docsByFolder.get(folderKey).push(doc);
    }
    docsByFolder.forEach((docs) => docs.sort(docTitleCompare));
    
    // Helper to render a document item (draggable)
    const renderDocItem = (doc, indent = 0) => {
        const safeDocIdJs = escapeJsForSingleQuotedString(doc.id);
        const safeDocIdAttr = escapeHtmlAttrValue(doc.id);
        const memoCount = getMemoCountForTarget('document', doc.id);
        const memoIndicator = memoCount > 0 ? `<span class="memo-indicator" title="${memoCount} annotation(s)">💭${memoCount}</span>` : '';
        const titleText = String(doc.title || 'Untitled document');
        const indentStyle = indent > 0 ? `style="margin-left: ${12 + indent * 16}px;"` : '';
        const isPdf = doc.type === 'pdf';
        const typeIndicator = isPdf ? '<span class="doc-type-badge" title="PDF document">PDF</span>' : '';
        const contentInfo = isPdf ? `${doc.pdfPages?.length || '?'} pages` : `${doc.content.length} chars`;
        const codeCount = getDocSegmentCountFast(doc.id);
        const codeLabel = `${codeCount} code${codeCount !== 1 ? 's' : ''}`;
        const metaParts = [contentInfo];
        if (doc.metadata?.participantId) {
            metaParts.push(`ID: ${escapeHtml(doc.metadata.participantId)}`);
        }
        const extraMeta = metaParts.join(' • ');
        
        const isSelected = Array.isArray(appData.selectedDocIds) && appData.selectedDocIds.includes(doc.id);
        return `
            <div class="document-item document-item-compact ${doc.id === appData.currentDocId ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
                 ${indentStyle} 
                 draggable="true"
                 data-doc-id="${safeDocIdAttr}"
                 ondragstart="handleDocDragStart(event, '${safeDocIdJs}')"
                 ondragend="handleDocDragEnd(event)"
                onclick="selectDocumentFromList(event, '${safeDocIdJs}')" 
                oncontextmenu="openDocumentContextMenu('${safeDocIdJs}', event)">
                <div class="document-item-main-row">
                    <div class="document-item-title-wrap">
                        ${typeIndicator}
                        <span class="document-item-title-text" title="${escapeHtmlAttrValue(titleText)}">${escapeHtml(titleText)}</span>
                        ${memoIndicator}
                    </div>
                    <span class="document-item-code-badge" title="${escapeHtmlAttrValue(`${codeCount} coded segment${codeCount !== 1 ? 's' : ''}`)}">${escapeHtml(codeLabel)}</span>
                    <button class="code-action-btn document-item-settings-btn" onclick="openDocumentMetadata('${safeDocIdJs}', event)" title="Edit metadata"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
                </div>
                <div class="document-item-meta">${extraMeta}</div>
            </div>
        `;
    };
    
    // Helper to render a folder item (with drop zone for documents)
    const renderFolderItem = (folder, indent = 0) => {
        const safeFolderIdJs = escapeJsForSingleQuotedString(folder.id);
        const safeFolderIdAttr = escapeHtmlAttrValue(folder.id);
        const isExpanded = folder.expanded !== false;
        const expandIcon = isExpanded ? '▼' : '▶';
        const indentStyle = indent > 0 ? `padding-left: ${12 + indent * 16}px;` : '';
        
        return `
            <div class="folder-item" style="${indentStyle}" 
                 data-folder-id="${safeFolderIdAttr}"
                 draggable="true"
                 ondragstart="handleFolderItemDragStart(event, '${safeFolderIdJs}')"
                 ondragend="handleFolderItemDragEnd(event)"
                 ondragover="handleFolderDragOver(event)" 
                 ondragleave="handleFolderDragLeave(event)" 
                 ondrop="handleDocumentDropOnFolder(event, '${safeFolderIdJs}')"
                 oncontextmenu="openFolderContextMenu('${safeFolderIdJs}', event)">
                <span class="folder-expand" onclick="toggleFolderExpanded('${safeFolderIdJs}', event)">${expandIcon}</span>
                <span class="folder-icon">${folderIconSvg}</span>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <button class="folder-settings-btn" onclick="openFolderInfo('${safeFolderIdJs}', event)" title="Folder info"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
            </div>
        `;
    };
    
    // Recursive function to render folder tree with documents
    // Includes cycle detection to prevent infinite loops
    const renderFolderTree = (parentId, indent = 0, visited = new Set()) => {
        // Safety: max depth and cycle detection
        if (indent > 10 || visited.size > 100) return '';
        
        let html = '';
        
        // Get folders at this level
        const folders = folderChildrenByParent.get(parentId || ROOT_KEY) || [];
        folders.forEach(folder => {
            // Skip if already visited (cycle detection)
            if (visited.has(folder.id)) return;
            visited.add(folder.id);
            
            html += renderFolderItem(folder, indent);
            
            if (folder.expanded !== false) {
                // Render subfolders before documents on the same level.
                html += renderFolderTree(folder.id, indent + 1, visited);

                // Render documents in this folder
                const docsInFolder = docsByFolder.get(folder.id) || [];
                docsInFolder.forEach(doc => {
                    html += renderDocItem(doc, indent + 1);
                });
            }
        });
        
        return html;
    };
    
    if (appData.documents.length === 0 && appData.folders.length === 0) {
        allList.innerHTML = `
            <div class="empty-state" style="padding: 40px 20px;"><p style="font-size: 13px;">No documents yet</p></div>
        `;
        recentList.innerHTML = '<div class="empty-state" style="padding: 20px;"><p style="font-size: 13px;">No recent documents</p></div>';
        return;
    }
    
    // Build the document tree
    let allHtml = '';
    
    // Render root-level folders and their contents
    allHtml += renderFolderTree(null, 0);
    
    // Render root-level documents (no folder)
    const rootDocs = docsByFolder.get(ROOT_KEY) || [];
    if (appData.folders.length > 0 && rootDocs.length > 0) {
        allHtml += `
            <div class="root-doc-separator"
                 ondragover="handleFolderDragOver(event)"
                 ondragleave="handleFolderDragLeave(event)"
                 ondrop="handleDocumentDropOnFolder(event, null)"></div>
        `;
    }
    rootDocs.forEach(doc => {
        allHtml += renderDocItem(doc, 0);
    });
    
    // Add root drop zone for moving documents out of folders
    allHtml += `
        <div class="root-drop-zone" 
             ondragover="handleFolderDragOver(event)" 
             ondragleave="handleFolderDragLeave(event)" 
             ondrop="handleDocumentDropOnFolder(event, null)">
            Drop here to move to root
        </div>
    `;
    
    allList.innerHTML = allHtml;
    updateCompactDocumentTitleLineClasses(allList);
    
    // Render recent documents (5 most recently accessed)
    const recentDocs = appData.documents
        .filter(doc => doc.lastAccessed)
        .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
        .slice(0, 5);
    
    if (recentDocs.length === 0) {
        recentList.innerHTML = '<div class="empty-state" style="padding: 20px;"><p style="font-size: 13px;">No recent documents</p></div>';
        sizeRecentDocumentsListViewport(recentList);
    } else {
        recentList.innerHTML = recentDocs.map(doc => renderDocItem(doc, 0)).join('');
        updateCompactDocumentTitleLineClasses(recentList);
        sizeRecentDocumentsListViewport(recentList);
    }
}

function sizeRecentDocumentsListViewport(recentList) {
    if (!recentList) return;
    const fixedPx = 176; // ~three compact cards at two-line title height
    recentList.style.height = `${fixedPx}px`;
    recentList.style.maxHeight = `${fixedPx}px`;
}

// getDocSegmentCount is now getDocSegmentCountFast in state.js

function renderCodes() {
    const list = document.getElementById('codesList');
    const parentSelect = document.getElementById('parentCode');
    
    if (appData.codes.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 40px 20px;"><p style="font-size: 13px;">No codes yet</p></div>';
        return;
    }

    // Update parent select
    parentSelect.innerHTML = '<option value="">None (Top-level code)</option>' + 
        appData.codes.filter(c => !c.parentId).map(c => 
            `<option value="${escapeHtmlAttrValue(c.id)}">${escapeHtml(c.name)}</option>`
        ).join('');

    // Render code tree sorted by sortOrder (user-defined via drag-and-drop)
    const topLevelCodes = appData.codes
        .filter(c => !c.parentId)
        .sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            // Fall back to creation time for codes without sortOrder
            return new Date(a.created || 0) - new Date(b.created || 0);
        });
    
    list.innerHTML = topLevelCodes.map((code, index) => renderCodeItem(code, false, index)).join('');
    
    // Setup drag-and-drop handlers
    setupCodeDragAndDrop();
}

function renderCodeItem(code, isChild = false, index = 0) {
    const safeCodeIdJs = escapeJsForSingleQuotedString(code.id);
    const safeCodeIdAttr = escapeHtmlAttrValue(code.id);
    const count = getCodeSegmentCountFast(code.id);
    const children = appData.codes.filter(c => c.parentId === code.id);
    const isSelected = appData.filterCodeId === code.id;
    const shortcutBadge = code.shortcut ? `<span style="font-size: 11px; opacity: 0.6; margin-left: 4px;">[${escapeHtml(code.shortcut)}]</span>` : '';
    const memoCount = getMemoCountForTarget('code', code.id);
    const memoIndicator = memoCount > 0 ? `<span class="memo-indicator" title="${memoCount} annotation(s)">💭</span>` : '';
    const titleAttr = code.description ? `title="${escapeHtmlAttrValue(code.description)}"` : '';
    const dragAttr = `draggable="true" data-code-id="${safeCodeIdAttr}" data-sort-index="${index}"`;
    
    let html = `
        <div class="code-item draggable-code ${isChild ? 'child' : ''} ${isSelected ? 'selected' : ''}" onclick="filterByCode('${safeCodeIdJs}', event)" oncontextmenu="openCodeContextMenu('${safeCodeIdJs}', event)" ${titleAttr} ${dragAttr}>
            <span class="drag-handle" title="Drag onto another code to make child">⠿</span>
            <div class="code-color" style="background: ${escapeHtml(code.color)};"></div>
            <div class="code-name">${escapeHtml(code.name)}${shortcutBadge}${memoIndicator}</div>
            <div class="code-count">${count}</div>
            <div class="code-actions">
                <button class="code-action-btn" onclick="deleteCode('${safeCodeIdJs}', event)" title="Delete">×</button>
            </div>
        </div>
    `;
    
    if (children.length > 0) {
        // Sort children by sortOrder too
        const sortedChildren = children.sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(a.created || 0) - new Date(b.created || 0);
        });
        html += sortedChildren.map((child, idx) => renderCodeItem(child, true, idx)).join('');
    }
    
    return html;
}

// getCodeSegmentCount is now getCodeSegmentCountFast in state.js

function setDocumentViewMode(isPdf) {
    const panel = document.querySelector('.content-panel');
    const nav = document.getElementById('pdfNavControls');
    const status = document.getElementById('pdfSelectionStatus');
    if (panel) panel.classList.toggle('pdf-mode', !!isPdf);
    if (nav) nav.hidden = !isPdf;
    if (status && !isPdf) {
        status.hidden = true;
        status.classList.remove('warning');
        status.textContent = 'Region selected. Click a code to apply. Press Esc to clear.';
    }
    if (!isPdf && typeof dismissPdfRegionAnnotationInline === 'function') {
        dismissPdfRegionAnnotationInline();
    }
}

function setZoomControlsVisible(visible) {
    const zoom = document.getElementById('docZoomControls');
    if (!zoom) return;
    zoom.style.display = visible ? 'inline-flex' : 'none';
}

function renderCurrentDocument() {
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    const contentElement = document.getElementById('documentContent');
    const contentBody = document.querySelector('.content-body');
    if (!appData.filterCodeId) {
        if (contentElement) contentElement.classList.remove('code-view-mode');
        if (contentBody) contentBody.classList.remove('code-view-mode');
        destroyFilterVirtualization();
        if (codeInspectorState.segmentId) {
            codeInspectorState.segmentId = null;
            codeInspectorState.docId = null;
        }
        renderCodeInspector();
    }
    
    // If in filtered view, we show all documents regardless of current selection
    const setDocumentTitleText = (titleText) => {
        const titleEl = document.getElementById('documentTitle');
        if (!titleEl) return;
        const safeTitle = String(titleText || '');
        titleEl.textContent = safeTitle;
        titleEl.title = safeTitle;
    };

    if (appData.filterCodeId) {
        if (contentElement) contentElement.classList.add('code-view-mode');
        if (contentBody) contentBody.classList.add('code-view-mode');
        setDocumentViewMode(false);
        setZoomControlsVisible(false);
        if (typeof renderDocumentCasesControl === 'function') renderDocumentCasesControl();
        const code = appData.codes.find(c => c.id === appData.filterCodeId);
        setDocumentTitleText(`Code view · ${code ? code.name : 'Code'}`);
        renderFilteredView();
        renderCodeInspector();
        return;
    }

    if (appData.selectedCaseId && typeof renderCaseSheet === 'function') {
        if (contentElement) contentElement.classList.add('code-view-mode');
        if (contentBody) contentBody.classList.add('code-view-mode');
        setDocumentViewMode(false);
        setZoomControlsVisible(false);
        if (typeof renderDocumentCasesControl === 'function') renderDocumentCasesControl();
        const selectedCase = appData.cases.find(c => c.id === appData.selectedCaseId);
        setDocumentTitleText(selectedCase ? `Case view · ${selectedCase.name}` : 'Case view');
        renderCaseSheet(appData.selectedCaseId);
        renderCodeInspector();
        return;
    }
    
    if (!doc) {
        setDocumentViewMode(false);
        setZoomControlsVisible(true);
        if (typeof renderDocumentCasesControl === 'function') renderDocumentCasesControl();
        // Show empty state if no document selected
        const content = document.getElementById('documentContent');
        content.innerHTML = `
            <div class="empty-state">
                <h3>Start coding your data</h3>
                <p>Import a document or paste text to begin qualitative analysis. Create codes in the left panel and apply them to text selections.</p>
                <div class="empty-state-actions">
                    <button class="empty-state-btn" onclick="openImportModal()"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9,15 12,12 15,15"/></svg>Import Document</button>
                    <button class="empty-state-btn" onclick="openPasteModal()" style="background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border);"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:16px;height:16px;"><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>Paste Text</button>
                </div>
                <p class="empty-state-hint">Or drag and drop a .txt, .docx, or .pdf file anywhere</p>
            </div>
        `;
        setDocumentTitleText('Select or add a document');
        // Clean up any PDF state
        if (typeof cleanupPdfState === 'function') cleanupPdfState();
        return;
    }

    setDocumentTitleText(doc.title);
    if (typeof renderDocumentCasesControl === 'function') renderDocumentCasesControl();
    
    // Check if this is a PDF document
    if (doc.type === 'pdf') {
        setDocumentViewMode(true);
        setZoomControlsVisible(true);
        if (typeof closeInPageSearch === 'function') closeInPageSearch();
        const content = document.getElementById('documentContent');
        if (!doc.pdfData) {
            content.innerHTML = `
                <div class="pdf-error">
                    <p>This PDF's binary data is not currently loaded, so it cannot be rendered as pages.</p>
                    <p>Re-open the project file (QDPX) that contains the original PDF data, or re-import this PDF.</p>
                </div>
            `;
            return;
        }

        if (typeof renderPdfDocument === 'function') {
            renderPdfDocument(doc, content);
        } else {
            content.innerHTML = `
                <div class="pdf-error">
                    <p>PDF rendering is not available.</p>
                    <p>The PDF.js library may not be loaded.</p>
                </div>
            `;
        }
        return;
    }
    
    // Clean up PDF state when switching to non-PDF document
    setDocumentViewMode(false);
    setZoomControlsVisible(true);
    if (typeof cleanupPdfState === 'function') cleanupPdfState();
    
    renderFullDocument(doc);
}

function renderFullDocument(doc) {
    const content = document.getElementById('documentContent');
    const segments = getSegmentsForDoc(doc.id);
    
    if (segments.length === 0) {
        // No segments, just render the plain text
        const html = escapeHtml(doc.content);
        content.innerHTML = html || '<p style="color: var(--text-secondary);"><em>Document is empty</em></p>';
        content.onmouseup = handleTextSelection;
        clearDocumentSegmentMarkers(content);
        return;
    }
    
    // Interval-based rendering: O(m log m) where m = number of segments
    // Instead of building a per-character map, we collect boundary events
    // and sweep through them to build spans.
    
    // Collect all boundary events (segment starts and ends)
    const events = [];
    segments.forEach(segment => {
        events.push({ pos: segment.startIndex, type: 'start', segment });
        events.push({ pos: segment.endIndex, type: 'end', segment });
    });
    
    // Sort events by position, with ends before starts at same position
    events.sort((a, b) => {
        if (a.pos !== b.pos) return a.pos - b.pos;
        // At same position: ends come before starts
        return a.type === 'end' ? -1 : 1;
    });
    
    // Sweep through document, tracking active segments
    let html = '';
    let pos = 0;
    const activeSegments = new Set();
    
    for (const event of events) {
        // Output text from current position to this event
        if (event.pos > pos) {
            if (activeSegments.size === 0) {
                // Uncoded text
                html += escapeHtml(doc.content.substring(pos, event.pos));
            } else {
                // Coded text - render with current active segments
                const text = doc.content.substring(pos, event.pos);
                html += renderCodedSpan(text, Array.from(activeSegments));
            }
            pos = event.pos;
        }
        
        // Update active segments
        if (event.type === 'start') {
            activeSegments.add(event.segment);
        } else {
            activeSegments.delete(event.segment);
        }
    }
    
    // Output any remaining text after the last segment
    if (pos < doc.content.length) {
        html += escapeHtml(doc.content.substring(pos));
    }
    
    content.innerHTML = html || '<p style="color: var(--text-secondary);"><em>Document is empty</em></p>';
    content.onmouseup = handleTextSelection;
    renderDocumentSegmentMarkers(content);
}

function parseHexColorToRgb(hex) {
    const raw = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) return null;
    const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
    const intVal = parseInt(full, 16);
    return {
        r: (intVal >> 16) & 255,
        g: (intVal >> 8) & 255,
        b: intVal & 255
    };
}

function rgbToString(rgb) {
    return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

function darkenRgb(rgb, factor = 0.74) {
    return {
        r: Math.max(0, Math.round(rgb.r * factor)),
        g: Math.max(0, Math.round(rgb.g * factor)),
        b: Math.max(0, Math.round(rgb.b * factor))
    };
}

function buildSegmentVisualStyleFromCodes(codes) {
    const codeColors = (codes || [])
        .map(code => String(code?.color || '').trim())
        .filter(Boolean);
    const uniqueColors = Array.from(new Set(codeColors));
    const rgbList = uniqueColors
        .map(hex => parseHexColorToRgb(hex))
        .filter(Boolean);

    if (rgbList.length === 0) {
        rgbList.push({ r: 136, g: 136, b: 136 });
    }

    const darkList = rgbList.map(rgb => darkenRgb(rgb, 0.72));
    const segCount = rgbList.length;

    const buildSteppedBlendGradient = (list, alpha) => {
        if (list.length <= 1) {
            const solid = `rgba(${rgbToString(list[0])}, ${alpha})`;
            return `linear-gradient(90deg, ${solid} 0%, ${solid} 100%)`;
        }
        const step = 100 / list.length;
        const blend = Math.min(7, step * 0.42);
        const blendHalf = blend / 2;
        const stops = [];
        stops.push(`rgba(${rgbToString(list[0])}, ${alpha}) 0%`);
        for (let i = 0; i < list.length - 1; i++) {
            const boundary = (i + 1) * step;
            const left = Math.max(0, boundary - blendHalf).toFixed(4);
            const right = Math.min(100, boundary + blendHalf).toFixed(4);
            stops.push(`rgba(${rgbToString(list[i])}, ${alpha}) ${left}%`);
            stops.push(`rgba(${rgbToString(list[i + 1])}, ${alpha}) ${right}%`);
        }
        stops.push(`rgba(${rgbToString(list[list.length - 1])}, ${alpha}) 100%`);
        return `linear-gradient(90deg, ${stops.join(', ')})`;
    };

    const highlightGradient = buildSteppedBlendGradient(rgbList, 0.25);
    const underlineGradient = buildSteppedBlendGradient(darkList, 0.96);

    const markerStep = 4;
    const markerLine = 2;
    const markerWidth = Math.max(markerLine, ((darkList.length - 1) * markerStep) + markerLine);
    const markerGradient = `linear-gradient(90deg, ${darkList.map((rgb, idx) => {
        const start = idx * markerStep;
        const end = start + markerLine;
        return `rgba(${rgbToString(rgb)}, 0.96) ${start}px, rgba(${rgbToString(rgb)}, 0.96) ${end}px, transparent ${end}px, transparent ${start + markerStep}px`;
    }).join(', ')})`;

    return `--seg-highlight:${highlightGradient};--seg-underline:${underlineGradient};--seg-marker-gradient:${markerGradient};--seg-marker-width:${markerWidth}px;`;
}

function clearDocumentSegmentMarkers(contentEl) {
    if (!contentEl) return;
    const existingLayer = contentEl.querySelector(':scope > .document-segment-marker-layer');
    if (existingLayer) existingLayer.remove();
}

function getGroupedRectBands(rects) {
    if (!rects.length) return [];
    const sorted = rects
        .slice()
        .sort((a, b) => (a.top - b.top) || (a.left - b.left));
    const baseHeight = Math.max(8, sorted[0].height || 0);
    const gapThreshold = Math.max(10, baseHeight * 0.9);
    const bands = [];
    let currentTop = sorted[0].top;
    let currentBottom = sorted[0].bottom;

    for (let i = 1; i < sorted.length; i++) {
        const rect = sorted[i];
        if ((rect.top - currentBottom) > gapThreshold) {
            bands.push({ top: currentTop, bottom: currentBottom });
            currentTop = rect.top;
            currentBottom = rect.bottom;
        } else {
            currentBottom = Math.max(currentBottom, rect.bottom);
        }
    }

    bands.push({ top: currentTop, bottom: currentBottom });
    return bands;
}

function renderDocumentSegmentMarkers(contentEl) {
    if (!contentEl || contentEl.classList.contains('code-view-mode')) return;
    clearDocumentSegmentMarkers(contentEl);

    const spans = Array.from(contentEl.querySelectorAll('.coded-segment'));
    if (spans.length === 0) return;

    const contentRect = contentEl.getBoundingClientRect();
    if (!contentRect.width || !contentRect.height) return;

    const layer = document.createElement('div');
    layer.className = 'document-segment-marker-layer';
    const baseLeft = contentEl.clientWidth + 10;
    const markerSpecs = [];
    let maxMarkerWidth = 2;

    spans.forEach((span) => {
        const rawText = span.textContent || '';
        // Avoid visual artifacts for spans that only carry whitespace/newline boundaries.
        if (!rawText.replace(/\s/g, '')) return;

        const rects = Array.from(span.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
        if (rects.length === 0) return;

        const computed = window.getComputedStyle(span);
        const markerWidth = Math.max(2, parseFloat(computed.getPropertyValue('--seg-marker-width')) || 2);
        const markerGradient = computed.getPropertyValue('--seg-marker-gradient').trim() || 'rgba(101, 101, 101, 0.95)';
        const bands = getGroupedRectBands(rects);
        const memoCount = Number(span.dataset.memoCount || 0);
        const firstSegmentId = String(span.dataset.primarySegmentId || '').trim();
        if (bands.length === 0) return;
        if (markerWidth > maxMarkerWidth) maxMarkerWidth = markerWidth;
        markerSpecs.push({
            markerWidth,
            markerGradient,
            bands,
            memoCount,
            firstSegmentId
        });
    });

    const annotationLaneLeft = baseLeft + maxMarkerWidth + 8;
    markerSpecs.forEach((spec) => {
        spec.bands.forEach((band) => {
            const height = Math.max(2, band.bottom - band.top);
            const marker = document.createElement('span');
            marker.className = 'document-segment-marker';
            marker.style.left = `${baseLeft}px`;
            marker.style.top = `${band.top - contentRect.top}px`;
            marker.style.height = `${height}px`;
            marker.style.width = `${spec.markerWidth}px`;
            marker.style.background = spec.markerGradient;
            layer.appendChild(marker);
        });

        if (spec.memoCount > 0 && spec.firstSegmentId) {
            const firstBand = spec.bands[0];
            const indicator = document.createElement('button');
            indicator.type = 'button';
            indicator.className = 'document-segment-annotation-indicator';
            indicator.style.left = `${annotationLaneLeft}px`;
            indicator.style.top = `${firstBand.top - contentRect.top + 2}px`;
            indicator.title = `${spec.memoCount} annotation${spec.memoCount === 1 ? '' : 's'}`;
            indicator.setAttribute('aria-label', indicator.title);
            indicator.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openMemoModal('segment', spec.firstSegmentId, event);
            });
            layer.appendChild(indicator);
        }
    });

    if (layer.childElementCount > 0) {
        contentEl.appendChild(layer);
    }
}

// Render a span of coded text with the given active segments
function renderCodedSpan(text, activeSegments) {

    // Collect all unique codes from active segments
    const codes = [];
    const seenCodeIds = new Set();
    const codeById = getCodeLookupMap();
    activeSegments.forEach(seg => {
        seg.codeIds.forEach(codeId => {
            if (seenCodeIds.has(codeId)) return;
            const code = codeById.get(codeId);
            if (!code) return;
            seenCodeIds.add(codeId);
            codes.push(code);
        });
    });
    
    // Create visual representation
    const codeNames = codes.map(c => c.name).join(', ');
    const segmentStyle = buildSegmentVisualStyleFromCodes(codes);

    const segmentIdsList = activeSegments.map(s => s.id);
    const segmentIds = segmentIdsList.join(',');
    const safeSegmentIdsJs = escapeJsForSingleQuotedString(segmentIds);
    const codeIdsList = codes.map(c => c.id);
    const codeIds = codeIdsList.join(',');
    const primarySegmentId = activeSegments[0]?.id || '';
    const segmentMemoCount = primarySegmentId ? getSegmentMemoCount(primarySegmentId) : 0;

    return `<span class="coded-segment" style="${segmentStyle}" data-primary-segment-id="${escapeHtmlAttrValue(primarySegmentId)}" data-segment-ids="${escapeHtmlAttrValue(segmentIds)}" data-code-ids="${escapeHtmlAttrValue(codeIds)}" data-memo-count="${segmentMemoCount}" data-tooltip="${escapeHtmlAttrValue(codeNames)} • Right-click for options" oncontextmenu="showSegmentContextMenu('${safeSegmentIdsJs}', event)"><span class="coded-segment-text">${escapeHtml(text)}</span></span>`;
}

const codeLookupCache = {
    projectRef: null,
    revision: null,
    map: new Map()
};

function getCodeLookupMap() {
    const revision = (typeof appDataRevision === 'number') ? appDataRevision : -1;
    if (codeLookupCache.projectRef === appData && codeLookupCache.revision === revision && codeLookupCache.map) {
        return codeLookupCache.map;
    }
    const map = new Map();
    (Array.isArray(appData.codes) ? appData.codes : []).forEach((code) => {
        if (!code || !code.id) return;
        map.set(code.id, code);
    });
    codeLookupCache.projectRef = appData;
    codeLookupCache.revision = revision;
    codeLookupCache.map = map;
    return map;
}

const codeViewUiState = {
    mode: 'segments',
    annotationQuery: '',
    annotationCodeId: '',
    annotationDocId: '',
    annotationDateRange: 'all',
    segmentsDocId: '',
    segmentsMemoFilter: 'all',
    segmentsIncludeSubcodes: false,
    segmentsSort: 'document',
    presetsExpanded: false,
    notesExpanded: false
};

const codeInspectorState = {
    segmentId: null,
    docId: null
};

const filterVirtualState = {
    active: false,
    rows: [],
    heights: [],
    offsets: [],
    totalHeight: 0,
    listEl: null,
    contentBodyEl: null,
    rafId: null,
    forceRender: false,
    onScroll: null,
    lastStart: -1,
    lastEnd: -1
};

function setCodeViewMode(mode) {
    codeViewUiState.mode = (mode === 'annotations') ? 'annotations' : 'segments';
    renderCurrentDocument();
}

function toggleCodeViewNotes() {
    codeViewUiState.notesExpanded = !codeViewUiState.notesExpanded;
    renderCurrentDocument();
}

function updateAnnotationViewFilter(key, value) {
    if (!Object.prototype.hasOwnProperty.call(codeViewUiState, key)) return;
    codeViewUiState[key] = value;
    renderCurrentDocument();
}

function toggleCodeViewPresetsExpanded() {
    codeViewUiState.presetsExpanded = !codeViewUiState.presetsExpanded;
    renderCurrentDocument();
}

function ensureCodeViewPresetsStore() {
    if (!Array.isArray(appData.codeViewPresets)) appData.codeViewPresets = [];
    return appData.codeViewPresets;
}

function getCodeViewPresetState() {
    return {
        filterCodeId: appData.filterCodeId || '',
        mode: codeViewUiState.mode,
        annotationQuery: codeViewUiState.annotationQuery,
        annotationCodeId: codeViewUiState.annotationCodeId,
        annotationDocId: codeViewUiState.annotationDocId,
        annotationDateRange: codeViewUiState.annotationDateRange,
        segmentsDocId: codeViewUiState.segmentsDocId,
        segmentsMemoFilter: codeViewUiState.segmentsMemoFilter,
        segmentsIncludeSubcodes: !!codeViewUiState.segmentsIncludeSubcodes,
        segmentsSort: codeViewUiState.segmentsSort
    };
}

async function saveCurrentCodeViewPreset() {
    const presets = ensureCodeViewPresetsStore();
    const currentCode = appData.codes.find(c => c.id === appData.filterCodeId);
    const defaultName = currentCode ? `${currentCode.name} view` : 'Code view preset';
    if (typeof openTextPrompt !== 'function') return;
    const name = await openTextPrompt('Save retrieval preset', defaultName);
    if (name === null) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    saveHistory();
    const existing = presets.find(p => String(p.name || '').toLowerCase() === trimmed.toLowerCase());
    const payload = {
        id: existing?.id || ('preset_' + Date.now()),
        name: trimmed,
        state: getCodeViewPresetState(),
        updated: new Date().toISOString()
    };
    if (existing) {
        Object.assign(existing, payload);
    } else {
        presets.push(payload);
    }
    saveData();
    renderCurrentDocument();
}

function applyCodeViewPreset(presetId) {
    if (!presetId) return;
    const presets = ensureCodeViewPresetsStore();
    const preset = presets.find(p => p.id === presetId);
    if (!preset || !preset.state) return;
    const state = preset.state;

    if (state.filterCodeId && appData.codes.some(c => c.id === state.filterCodeId)) {
        appData.filterCodeId = state.filterCodeId;
    }
    codeViewUiState.mode = (state.mode === 'annotations') ? 'annotations' : 'segments';
    codeViewUiState.annotationQuery = String(state.annotationQuery || '');
    codeViewUiState.annotationCodeId = String(state.annotationCodeId || appData.filterCodeId || '');
    codeViewUiState.annotationDocId = String(state.annotationDocId || '');
    codeViewUiState.annotationDateRange = String(state.annotationDateRange || 'all');
    codeViewUiState.segmentsDocId = String(state.segmentsDocId || '');
    codeViewUiState.segmentsMemoFilter = String(state.segmentsMemoFilter || 'all');
    codeViewUiState.segmentsIncludeSubcodes = !!state.segmentsIncludeSubcodes;
    codeViewUiState.segmentsSort = String(state.segmentsSort || 'document');
    renderAll();
}

function getDescendantCodeIds(codeId) {
    const descendants = [];
    const queue = [codeId];
    const seen = new Set([codeId]);
    while (queue.length > 0) {
        const current = queue.shift();
        const children = appData.codes.filter(c => c.parentId === current);
        children.forEach((child) => {
            if (seen.has(child.id)) return;
            seen.add(child.id);
            descendants.push(child.id);
            queue.push(child.id);
        });
    }
    return descendants;
}

function goToParentCodeFromCodeView() {
    const current = appData.codes.find(c => c.id === appData.filterCodeId);
    if (!current || !current.parentId) return;
    const parent = appData.codes.find(c => c.id === current.parentId);
    if (!parent) return;
    appData.filterCodeId = parent.id;
    codeViewUiState.segmentsIncludeSubcodes = false;
    renderAll();
}

function toggleCodeViewSubcodes() {
    codeViewUiState.segmentsIncludeSubcodes = !codeViewUiState.segmentsIncludeSubcodes;
    renderCurrentDocument();
}

function segmentSourceLabel(segment) {
    if (!segment) return '';
    if (segment.pdfRegion) {
        return `Page ${segment.pdfRegion.pageNum || '?'}`;
    }
    return `Char ${Number(segment.startIndex || 0)}-${Number(segment.endIndex || 0)}`;
}

function renderCodeInspector() {
    const panel = document.getElementById('codeInspectorPanel');
    if (!panel) return;
    const isVisible = !!(appData.filterCodeId && codeViewUiState.mode === 'segments' && codeInspectorState.segmentId);
    panel.hidden = !isVisible;
    if (!isVisible) {
        panel.innerHTML = '';
        return;
    }

    const segment = appData.segments.find(s => s.id === codeInspectorState.segmentId);
    if (!segment) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
    }
    const doc = appData.documents.find(d => d.id === segment.docId);
    const memos = getMemosForTarget('segment', segment.id).slice().sort((a, b) => memoTimeForSort(b) - memoTimeForSort(a));
    const created = segment.created ? new Date(segment.created).toLocaleString() : 'Unknown';
    const modified = segment.modified ? new Date(segment.modified).toLocaleString() : created;
    const codes = appData.codes.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const codeChecklist = codes.map(code => {
        const checked = Array.isArray(segment.codeIds) && segment.codeIds.includes(code.id);
        return `<label class="inspector-code-item">
            <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleInspectorSegmentCode('${segment.id}', '${code.id}', this.checked)">
            <span class="inspector-code-dot" style="background:${escapeHtml(code.color || '#999')};"></span>
            <span>${escapeHtml(code.name || 'Untitled code')}</span>
        </label>`;
    }).join('');

    panel.innerHTML = `
        <div class="inspector-head">
            <strong>Coding inspector</strong>
            <button type="button" class="doc-action-btn in-page-search-btn" onclick="clearCodeInspectorSelection()" title="Close">✕</button>
        </div>
        <div class="inspector-meta">
            <div><strong>Source:</strong> ${escapeHtml(doc?.title || 'Document')} · ${escapeHtml(segmentSourceLabel(segment))}</div>
            <div><strong>Created:</strong> ${escapeHtml(created)}</div>
            <div><strong>Modified:</strong> ${escapeHtml(modified)}</div>
        </div>
        <div class="inspector-section">
            <div class="inspector-section-title">Codes</div>
            <div class="inspector-code-list">${codeChecklist}</div>
        </div>
        <div class="inspector-section">
            <div class="inspector-section-title">Annotations</div>
            <div class="inspector-memo-list">
                ${memos.length === 0 ? '<div class="inspector-empty">No annotations yet.</div>' : memos.map(m => `
                    <div class="inspector-memo-item">
                        <div class="inspector-memo-date">${escapeHtml(new Date(m.edited || m.created).toLocaleString())}</div>
                        ${m.tag ? `<div class="memo-tag-badge">${escapeHtml(m.tag)}</div>` : ''}
                        <div>${preserveLineBreaks(escapeHtml(m.content || ''))}</div>
                    </div>
                `).join('')}
            </div>
            <div class="inspector-add-row">
                <div class="inspector-add-fields">
                    <textarea id="inspectorMemoInput" class="form-textarea inspector-memo-input" rows="2" placeholder="Add annotation..."></textarea>
                    <input id="inspectorMemoTag" type="text" class="form-input inspector-memo-tag-input" maxlength="40" placeholder="Tag (optional)">
                </div>
                <button type="button" class="btn btn-primary" onclick="addInspectorSegmentMemo('${escapeJsForSingleQuotedString(segment.id)}')">Save</button>
            </div>
        </div>
        <div class="inspector-actions">
            <button type="button" class="btn btn-secondary" onclick="goToSegmentLocation('${escapeJsForSingleQuotedString(segment.docId)}', '${escapeJsForSingleQuotedString(segment.id)}')">Go to source</button>
        </div>
    `;
}

function clearCodeInspectorSelection() {
    codeInspectorState.segmentId = null;
    codeInspectorState.docId = null;
    renderCodeInspector();
    document.querySelectorAll('.filter-snippet.inspector-selected').forEach(el => el.classList.remove('inspector-selected'));
}

function selectSegmentInCodeView(segmentId, docId, event) {
    if (event) {
        const target = event.target;
        if (target && target.closest('.filter-pdf-preview-btn')) {
            return;
        }
    }
    codeInspectorState.segmentId = segmentId;
    codeInspectorState.docId = docId;
    document.querySelectorAll('.filter-snippet.inspector-selected').forEach(el => el.classList.remove('inspector-selected'));
    const row = document.querySelector(`.filter-snippet[data-segment-id="${segmentId}"]`);
    if (row) row.classList.add('inspector-selected');
    renderCodeInspector();
}

function toggleInspectorSegmentCode(segmentId, codeId, isChecked) {
    const segment = appData.segments.find(s => s.id === segmentId);
    if (!segment) return;
    saveHistory();
    if (!Array.isArray(segment.codeIds)) segment.codeIds = [];
    const hasCode = segment.codeIds.includes(codeId);
    if (isChecked && !hasCode) {
        segment.codeIds.push(codeId);
    } else if (!isChecked && hasCode) {
        segment.codeIds = segment.codeIds.filter(id => id !== codeId);
    }
    if (segment.codeIds.length === 0) {
        appData.segments = appData.segments.filter(s => s.id !== segmentId);
        clearCodeInspectorSelection();
    } else {
        segment.modified = new Date().toISOString();
    }
    saveData();
    renderAll();
}

function addInspectorSegmentMemo(segmentId) {
    const input = document.getElementById('inspectorMemoInput');
    const tagInput = document.getElementById('inspectorMemoTag');
    if (!input) return;
    const text = String(input.value || '').trim();
    const tag = String(tagInput?.value || '').trim().slice(0, 40);
    if (!text && !tag) return;
    saveHistory();
    const now = new Date().toISOString();
    const segment = appData.segments.find(s => s.id === segmentId);
    const scopedCodeId = (
        segment &&
        String(appData.filterCodeId || '').trim() &&
        Array.isArray(segment.codeIds) &&
        segment.codeIds.includes(appData.filterCodeId)
    ) ? appData.filterCodeId : '';
    const memo = {
        id: 'memo_' + Date.now(),
        type: 'segment',
        targetId: segmentId,
        content: text,
        tag: tag,
        created: now,
        edited: now
    };
    if (scopedCodeId) memo.codeId = scopedCodeId;
    appData.memos.push(memo);
    if (segment) segment.modified = now;
    saveData();
    renderCodeInspector();
    input.value = '';
    if (tagInput) tagInput.value = '';
    renderCurrentDocument();
}

function memoTimeForSort(memo) {
    const t = memo.edited || memo.created;
    const ms = new Date(t || 0).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function getMemoLinkedDocId(memo) {
    if (!memo) return null;
    if (memo.type === 'document') return memo.targetId || null;
    if (memo.type === 'segment') {
        const seg = appData.segments.find(s => s.id === memo.targetId);
        return seg?.docId || null;
    }
    return null;
}

function getMemoLinkedCodeIds(memo) {
    if (!memo) return [];
    if (memo.type === 'code' && memo.targetId) return [memo.targetId];
    if (memo.type === 'segment') {
        const memoCodeId = String(memo.codeId || '').trim();
        if (memoCodeId) return [memoCodeId];
        const seg = appData.segments.find(s => s.id === memo.targetId);
        return Array.isArray(seg?.codeIds) ? seg.codeIds : [];
    }
    return [];
}

function getAnnotationSearchText(memo) {
    const parts = [memo.content || '', memo.tag || ''];
    if (memo.type === 'document') {
        const doc = appData.documents.find(d => d.id === memo.targetId);
        if (doc) parts.push(doc.title || '');
    }
    if (memo.type === 'code') {
        const code = appData.codes.find(c => c.id === memo.targetId);
        if (code) parts.push(code.name || '');
    }
    if (memo.type === 'segment') {
        const seg = appData.segments.find(s => s.id === memo.targetId);
        const doc = seg ? appData.documents.find(d => d.id === seg.docId) : null;
        if (doc) parts.push(doc.title || '');
    }
    getMemoLinkedCodeIds(memo).forEach((codeId) => {
        const code = appData.codes.find(c => c.id === codeId);
        if (code && code.name) parts.push(code.name);
    });
    return parts.join(' ').toLowerCase();
}

function memoMatchesDateRange(memo, range) {
    if (!range || range === 'all') return true;
    const t = memoTimeForSort(memo);
    if (!t) return false;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (range === 'today') return (now - t) <= dayMs;
    if (range === '7d') return (now - t) <= (7 * dayMs);
    if (range === '30d') return (now - t) <= (30 * dayMs);
    return true;
}

function goToAnnotationSource(memoId) {
    const memo = appData.memos.find(m => m.id === memoId);
    if (!memo) return;

    if (memo.type === 'code' && memo.targetId && appData.codes.some(c => c.id === memo.targetId)) {
        appData.filterCodeId = memo.targetId;
        codeViewUiState.mode = 'segments';
        renderAll();
        return;
    }
    if (memo.type === 'document' && memo.targetId && appData.documents.some(d => d.id === memo.targetId)) {
        appData.filterCodeId = null;
        selectDocument(memo.targetId);
        return;
    }
    if (memo.type === 'segment' && memo.targetId) {
        const segment = appData.segments.find(s => s.id === memo.targetId);
        if (segment && segment.docId) {
            goToSegmentLocation(segment.docId, segment.id);
        }
    }
}

// Helper escapeHtml and preserveLineBreaks below

function preserveLineBreaks(text) {
    // Convert line breaks to <br> tags without removing any characters
    // This preserves the exact character count and positions
    return text.replace(/\n/g, '<br>');
}

function destroyFilterVirtualization() {
    if (!filterVirtualState.active) return;
    if (filterVirtualState.contentBodyEl && filterVirtualState.onScroll) {
        filterVirtualState.contentBodyEl.removeEventListener('scroll', filterVirtualState.onScroll);
    }
    if (filterVirtualState.rafId) {
        cancelAnimationFrame(filterVirtualState.rafId);
    }
    filterVirtualState.active = false;
    filterVirtualState.rows = [];
    filterVirtualState.heights = [];
    filterVirtualState.offsets = [];
    filterVirtualState.totalHeight = 0;
    filterVirtualState.listEl = null;
    filterVirtualState.contentBodyEl = null;
    filterVirtualState.rafId = null;
    filterVirtualState.forceRender = false;
    filterVirtualState.onScroll = null;
    filterVirtualState.lastStart = -1;
    filterVirtualState.lastEnd = -1;
}

function estimateFilterRowHeight(row) {
    if (!row) return 56;
    if (row.type === 'header') return 24;
    const textLen = String(row.text || '').length;
    if (row.isPdf) return 320;
    const textLines = Math.max(1, Math.ceil(textLen / 120));
    const memoLines = row.hasMemo ? Math.max(1, Math.ceil(String(row.memoText || '').length / 120)) : 0;
    return 22 + (textLines * 12) + (memoLines * 9);
}

function recomputeFilterVirtualOffsets() {
    const offsets = new Array(filterVirtualState.heights.length);
    let running = 0;
    for (let i = 0; i < filterVirtualState.heights.length; i++) {
        offsets[i] = running;
        running += filterVirtualState.heights[i];
    }
    filterVirtualState.offsets = offsets;
    filterVirtualState.totalHeight = running;
    if (filterVirtualState.listEl) {
        filterVirtualState.listEl.style.height = `${Math.max(1, running)}px`;
    }
}

function findFilterVirtualRowIndex(y) {
    const arr = filterVirtualState.offsets;
    if (!arr || arr.length === 0) return 0;
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (arr[mid] <= y) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function getFilterVirtualVisibleRange() {
    const contentBody = filterVirtualState.contentBodyEl;
    const listEl = filterVirtualState.listEl;
    if (!contentBody || !listEl || filterVirtualState.rows.length === 0) return { start: 0, end: -1 };
    const overscanPx = 800;
    const listTop = listEl.offsetTop;
    const localTop = Math.max(0, contentBody.scrollTop - listTop);
    const localBottom = localTop + contentBody.clientHeight;
    const startY = Math.max(0, localTop - overscanPx);
    const endY = Math.max(0, localBottom + overscanPx);
    const start = findFilterVirtualRowIndex(startY);
    let end = findFilterVirtualRowIndex(endY);
    if (end < filterVirtualState.rows.length - 1) end += 1;
    return {
        start: Math.max(0, start),
        end: Math.min(filterVirtualState.rows.length - 1, end)
    };
}

function renderFilterVirtualWindow(force = false) {
    if (!filterVirtualState.active || !filterVirtualState.listEl) return;
    const range = getFilterVirtualVisibleRange();
    if (!force && range.start === filterVirtualState.lastStart && range.end === filterVirtualState.lastEnd) return;
    filterVirtualState.lastStart = range.start;
    filterVirtualState.lastEnd = range.end;

    const rows = filterVirtualState.rows;
    let html = '';
    for (let i = range.start; i <= range.end; i++) {
        const row = rows[i];
        const top = filterVirtualState.offsets[i] || 0;
        html += `<div class="filter-virtual-row" data-row-index="${i}" style="top:${top}px;">${row.html}</div>`;
    }
    filterVirtualState.listEl.innerHTML = html;

    let changed = false;
    const renderedRows = filterVirtualState.listEl.querySelectorAll('.filter-virtual-row');
    renderedRows.forEach((el) => {
        const idx = Number(el.dataset.rowIndex);
        if (!Number.isFinite(idx)) return;
        const measured = Math.max(24, Math.ceil(el.offsetHeight));
        if (measured !== filterVirtualState.heights[idx]) {
            filterVirtualState.heights[idx] = measured;
            changed = true;
        }
    });

    if (changed) {
        recomputeFilterVirtualOffsets();
        renderFilterVirtualWindow(true);
        return;
    }
    hydrateFilterPdfRegionPreviews(filterVirtualState.listEl);
}

function scheduleFilterVirtualRender(force = false) {
    if (!filterVirtualState.active) return;
    if (force) {
        filterVirtualState.forceRender = true;
    }
    if (filterVirtualState.rafId) return;
    filterVirtualState.rafId = requestAnimationFrame(() => {
        filterVirtualState.rafId = null;
        const shouldForce = !!filterVirtualState.forceRender;
        filterVirtualState.forceRender = false;
        renderFilterVirtualWindow(shouldForce);
    });
}

function initFilterVirtualization(rows) {
    destroyFilterVirtualization();
    const listEl = document.getElementById('filterVirtualizedList');
    const contentBody = document.querySelector('.content-body');
    if (!listEl || !contentBody || !Array.isArray(rows) || rows.length === 0) return;

    filterVirtualState.active = true;
    filterVirtualState.rows = rows;
    filterVirtualState.heights = rows.map(estimateFilterRowHeight);
    filterVirtualState.listEl = listEl;
    filterVirtualState.contentBodyEl = contentBody;
    filterVirtualState.onScroll = scheduleFilterVirtualRender;
    contentBody.addEventListener('scroll', filterVirtualState.onScroll, { passive: true });
    recomputeFilterVirtualOffsets();
    renderFilterVirtualWindow(true);
}

function renderFilteredView() {
    const code = appData.codes.find(c => c.id === appData.filterCodeId);
    if (!code) return;
    
    const childCodes = appData.codes.filter(c => c.parentId === code.id);
    const hasChildren = childCodes.length > 0;
    const parentCode = code.parentId ? appData.codes.find(c => c.id === code.parentId) : null;
    const includedCodeIds = [code.id];
    if (hasChildren && codeViewUiState.segmentsIncludeSubcodes) {
        includedCodeIds.push(...getDescendantCodeIds(code.id));
    }
    const includedCodeIdSet = new Set(includedCodeIds);
    const getRelevantSegmentMemos = (segment) => {
        const memos = getMemosForTarget('segment', segment.id);
        if (memos.length === 0) return [];
        return memos.filter((memo) => {
            const memoCodeId = String(memo?.codeId || '').trim();
            if (!memoCodeId) return true;
            return includedCodeIdSet.has(memoCodeId);
        });
    };
    const rawSegments = Array.from(new Map(
        includedCodeIds
            .flatMap((id) => getSegmentsForCode(id))
            .map((segment) => [segment.id, segment])
    ).values());
    const allSegments = rawSegments
        .filter(segment => !codeViewUiState.segmentsDocId || segment.docId === codeViewUiState.segmentsDocId)
        .filter(segment => {
            if (codeViewUiState.segmentsMemoFilter === 'with') return getRelevantSegmentMemos(segment).length > 0;
            if (codeViewUiState.segmentsMemoFilter === 'without') return getRelevantSegmentMemos(segment).length === 0;
            return true;
        });
    
    // Group segments by document
    const segmentsByDoc = {};
    allSegments.forEach(segment => {
        if (!segmentsByDoc[segment.docId]) {
            segmentsByDoc[segment.docId] = [];
        }
        segmentsByDoc[segment.docId].push(segment);
    });
    
    // Sort documents by active sort mode
    const sortedDocs = appData.documents
        .filter(doc => segmentsByDoc[doc.id])
        .sort((a, b) => {
            if (codeViewUiState.segmentsSort === 'date') {
                const aLatest = Math.max(...segmentsByDoc[a.id].map(s => new Date(s.modified || s.created || 0).getTime()));
                const bLatest = Math.max(...segmentsByDoc[b.id].map(s => new Date(s.modified || s.created || 0).getTime()));
                return bLatest - aLatest;
            }
            if (codeViewUiState.segmentsSort === 'metadata') {
                const am = String(a.metadata?.participantId || a.metadata?.location || '').toLowerCase();
                const bm = String(b.metadata?.participantId || b.metadata?.location || '').toLowerCase();
                const cmp = am.localeCompare(bm);
                if (cmp !== 0) return cmp;
                return String(a.title || '').localeCompare(String(b.title || ''));
            }
            return new Date(a.created) - new Date(b.created);
        });
    
    const content = document.getElementById('documentContent');
    
    // Count total segments
    const totalSegments = allSegments.length;
    const docCount = sortedDocs.length;
    
    // Shortcut display
    const shortcutAction = code.shortcut 
        ? `<span class="filter-shortcut" onclick="assignShortcut('${escapeJsForSingleQuotedString(code.id)}')" title="Click to change shortcut">Shortcut: ${code.shortcut}</span>`
        : `<span class="filter-shortcut" onclick="assignShortcut('${escapeJsForSingleQuotedString(code.id)}')" title="Click to assign shortcut">Assign shortcut</span>`;
    const includeSubcodesControl = hasChildren ? `
        <span class="filter-shortcut" onclick="toggleCodeViewSubcodes()" title="Include codings from all descendant subcodes">
            ${codeViewUiState.segmentsIncludeSubcodes ? 'Hide subcodes' : 'Show subcodes'}
        </span>
    ` : '';
    const goToParentControl = parentCode ? `
        <span class="filter-shortcut" onclick="goToParentCodeFromCodeView()" title="Switch to parent code">
            Go to parent code
        </span>
    ` : '';
    const hasDescription = !!(code.description && code.description.trim());
    const hasNotes = !!(code.notes && code.notes.trim());
    const descriptionText = hasDescription ? preserveLineBreaks(escapeHtml(code.description)) : 'No description yet.';
    const notesText = hasNotes ? preserveLineBreaks(escapeHtml(code.notes)) : 'No notes yet.';
    const descriptionHtml = `<div class="filter-code-description ${hasDescription ? '' : 'empty'}">
            <div class="filter-code-description-main">
                <span class="filter-code-description-label"><strong>Description and notes:</strong></span>
                <span class="filter-code-description-text">${descriptionText}</span>
            </div>
            <div class="filter-code-description-actions">
                <span class="filter-shortcut" onclick="toggleCodeViewNotes()">${codeViewUiState.notesExpanded ? 'Hide notes' : 'Show notes'}</span>
                <button class="filter-description-btn" onclick="editFilterCodeDescription('${escapeJsForSingleQuotedString(code.id)}')">Add description and notes</button>
            </div>
            ${codeViewUiState.notesExpanded ? `<div class="filter-code-notes-block">${notesText}</div>` : ''}
        </div>`;
    
    if (!codeViewUiState.annotationCodeId) {
        codeViewUiState.annotationCodeId = code?.id || '';
    }
    const presets = ensureCodeViewPresetsStore();
    const presetOptions = presets.map(p => `<option value="${escapeHtmlAttrValue(p.id)}">${escapeHtml(p.name || 'Preset')}</option>`).join('');
    const docOptions = appData.documents
        .filter(d => segmentsByDoc[d.id] || codeViewUiState.segmentsDocId === d.id)
        .map(d => `<option value="${escapeHtmlAttrValue(d.id)}" ${d.id === codeViewUiState.segmentsDocId ? 'selected' : ''}>${escapeHtml(d.title)}</option>`)
        .join('');

    let html = `
        <div class="code-view-banner code-view-banner-main">
            <span class="filter-title"><strong>Code: ${escapeHtml(code.name)}</strong></span>
            <span class="filter-meta">${totalSegments} segment${totalSegments !== 1 ? 's' : ''} · ${docCount} document${docCount !== 1 ? 's' : ''}</span>
            ${shortcutAction}
            ${includeSubcodesControl}
            ${goToParentControl}
        </div>
        ${descriptionHtml}
        <div class="code-view-banner code-view-presets">
            <div class="code-view-presets-toggle-row" onclick="toggleCodeViewPresetsExpanded()">
                <button type="button" class="code-view-switch-btn presets-chevron">${codeViewUiState.presetsExpanded ? '▾' : '▸'}</button>
                <span class="filter-meta"><strong>Retrieval presets</strong></span>
            </div>
            ${codeViewUiState.presetsExpanded ? `
            <div class="code-view-presets-controls">
                <button type="button" class="code-view-switch-btn" onclick="saveCurrentCodeViewPreset()">Save preset</button>
                <select class="form-select annotation-filter-select" onchange="applyCodeViewPreset(this.value)">
                    <option value="">Load preset...</option>
                    ${presetOptions}
                </select>
                ${codeViewUiState.mode === 'segments' ? `
                    <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('segmentsDocId', this.value)">
                        <option value="">All documents</option>
                        ${docOptions}
                    </select>
                    <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('segmentsMemoFilter', this.value)">
                        <option value="all" ${codeViewUiState.segmentsMemoFilter === 'all' ? 'selected' : ''}>All snippets</option>
                        <option value="with" ${codeViewUiState.segmentsMemoFilter === 'with' ? 'selected' : ''}>With annotation</option>
                        <option value="without" ${codeViewUiState.segmentsMemoFilter === 'without' ? 'selected' : ''}>Without annotation</option>
                    </select>
                    <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('segmentsSort', this.value)">
                        <option value="document" ${codeViewUiState.segmentsSort === 'document' ? 'selected' : ''}>Sort: document</option>
                        <option value="date" ${codeViewUiState.segmentsSort === 'date' ? 'selected' : ''}>Sort: date</option>
                        <option value="metadata" ${codeViewUiState.segmentsSort === 'metadata' ? 'selected' : ''}>Sort: metadata</option>
                    </select>
                ` : ''}
            </div>
            ` : ''}
        </div>
        <div class="code-view-banner code-view-banner-switch">
            <button type="button" class="code-view-switch-btn ${codeViewUiState.mode === 'segments' ? 'active' : ''}" onclick="setCodeViewMode('segments')">Segments</button>
            <button type="button" class="code-view-switch-btn ${codeViewUiState.mode === 'annotations' ? 'active' : ''}" onclick="setCodeViewMode('annotations')">Annotations</button>
        </div>
        <div class="code-view-content">
    `;

    if (codeViewUiState.mode === 'annotations') {
        destroyFilterVirtualization();
        clearCodeInspectorSelection();
        const codeOptions = [{ id: '', name: 'All codes' }]
            .concat(appData.codes.map(c => ({ id: c.id, name: c.name })));
        const docsWithAnnotations = Array.from(new Set(appData.memos.map(getMemoLinkedDocId).filter(Boolean)));
        const docOptions = [{ id: '', name: 'All documents' }]
            .concat(docsWithAnnotations.map(id => {
                const d = appData.documents.find(doc => doc.id === id);
                return d ? { id: d.id, name: d.title } : null;
            }).filter(Boolean));

        if (!codeOptions.some(opt => opt.id === codeViewUiState.annotationCodeId)) {
            codeViewUiState.annotationCodeId = code?.id || '';
        }
        if (!docOptions.some(opt => opt.id === codeViewUiState.annotationDocId)) {
            codeViewUiState.annotationDocId = '';
        }

        const filteredMemos = appData.memos
            .filter(m => m && m.content && String(m.content).trim().length > 0)
            .filter(m => {
                if (codeViewUiState.annotationCodeId) {
                    const linked = getMemoLinkedCodeIds(m);
                    if (!linked.includes(codeViewUiState.annotationCodeId)) return false;
                }
                return true;
            })
            .filter(m => {
                if (!codeViewUiState.annotationDocId) return true;
                return getMemoLinkedDocId(m) === codeViewUiState.annotationDocId;
            })
            .filter(m => memoMatchesDateRange(m, codeViewUiState.annotationDateRange))
            .filter(m => {
                const q = (codeViewUiState.annotationQuery || '').trim().toLowerCase();
                if (!q) return true;
                return getAnnotationSearchText(m).includes(q);
            })
            .sort((a, b) => memoTimeForSort(b) - memoTimeForSort(a));

        html += `
            <div class="annotation-filters">
                <input type="text" class="form-input annotation-search-input" value="${escapeHtmlAttrValue(codeViewUiState.annotationQuery)}"
                    placeholder="Search annotations..." oninput="updateAnnotationViewFilter('annotationQuery', this.value)">
                <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('annotationCodeId', this.value)">
                    ${codeOptions.map(opt => `<option value="${escapeHtmlAttrValue(opt.id)}" ${opt.id === codeViewUiState.annotationCodeId ? 'selected' : ''}>${escapeHtml(opt.name)}</option>`).join('')}
                </select>
                <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('annotationDocId', this.value)">
                    ${docOptions.map(opt => `<option value="${escapeHtmlAttrValue(opt.id)}" ${opt.id === codeViewUiState.annotationDocId ? 'selected' : ''}>${escapeHtml(opt.name)}</option>`).join('')}
                </select>
                <select class="form-select annotation-filter-select" onchange="updateAnnotationViewFilter('annotationDateRange', this.value)">
                    <option value="all" ${codeViewUiState.annotationDateRange === 'all' ? 'selected' : ''}>All dates</option>
                    <option value="today" ${codeViewUiState.annotationDateRange === 'today' ? 'selected' : ''}>Today</option>
                    <option value="7d" ${codeViewUiState.annotationDateRange === '7d' ? 'selected' : ''}>Last 7 days</option>
                    <option value="30d" ${codeViewUiState.annotationDateRange === '30d' ? 'selected' : ''}>Last 30 days</option>
                </select>
            </div>
            <div class="annotation-list">
        `;

        if (filteredMemos.length === 0) {
            html += '<p style="color: var(--text-secondary);">No annotations match these filters.</p>';
        } else {
            const docOrder = appData.documents
                .slice()
                .sort((a, b) => new Date(a.created) - new Date(b.created))
                .map(doc => doc.id);
            const docOrderMap = new Map(docOrder.map((id, idx) => [id, idx]));

            const getMemoLocation = (memo) => {
                if (memo.type === 'segment') {
                    const seg = appData.segments.find(s => s.id === memo.targetId);
                    if (!seg) return { rank: 3, a: Number.MAX_SAFE_INTEGER, b: 0, label: 'Snippet' };
                    if (seg.pdfRegion) {
                        return {
                            rank: 2,
                            a: seg.pdfRegion.pageNum || 0,
                            b: seg.pdfRegion.yNorm || 0,
                            label: `Page ${seg.pdfRegion.pageNum || '?'}`
                        };
                    }
                    return {
                        rank: 1,
                        a: Number(seg.startIndex || 0),
                        b: 0,
                        label: `Char ${Number(seg.startIndex || 0)}`
                    };
                }
                if (memo.type === 'document') {
                    return { rank: 0, a: 0, b: 0, label: 'Document note' };
                }
                return { rank: 4, a: Number.MAX_SAFE_INTEGER, b: 0, label: 'Code note' };
            };

            const groupsByDoc = {};
            const otherGroup = [];
            filteredMemos.forEach((memo) => {
                const linkedDocId = getMemoLinkedDocId(memo);
                if (linkedDocId) {
                    if (!groupsByDoc[linkedDocId]) groupsByDoc[linkedDocId] = [];
                    groupsByDoc[linkedDocId].push(memo);
                } else {
                    otherGroup.push(memo);
                }
            });

            const orderedDocIds = Object.keys(groupsByDoc).sort((a, b) => {
                const ai = docOrderMap.has(a) ? docOrderMap.get(a) : Number.MAX_SAFE_INTEGER;
                const bi = docOrderMap.has(b) ? docOrderMap.get(b) : Number.MAX_SAFE_INTEGER;
                return ai - bi;
            });

            const renderMemoCard = (memo) => {
                const linkedDocId = getMemoLinkedDocId(memo);
                const linkedDoc = linkedDocId ? appData.documents.find(d => d.id === linkedDocId) : null;
                const linkedCodeIds = getMemoLinkedCodeIds(memo);
                const linkedCodes = linkedCodeIds.map(id => appData.codes.find(c => c.id === id)?.name).filter(Boolean);
                const updated = memo.edited || memo.created;
                const typeLabel = memo.type === 'segment' ? 'Snippet' : (memo.type === 'document' ? 'Document' : 'Code');
                const location = getMemoLocation(memo);
                return `
                    <div class="annotation-item" data-memo-id="${escapeHtmlAttrValue(memo.id)}">
                        <div class="annotation-item-head">
                            <span class="annotation-item-type">${typeLabel}</span>
                            <span class="annotation-item-date">${escapeHtml(new Date(updated).toLocaleString())}</span>
                        </div>
                        <div class="annotation-item-text">${preserveLineBreaks(escapeHtml(memo.content || ''))}</div>
                        <div class="annotation-item-meta">
                            ${memo.tag ? `<span class="memo-tag-badge">${escapeHtml(memo.tag)}</span>` : ''}
                            <span>${escapeHtml(location.label)}</span>
                            ${linkedDoc ? `<span>${escapeHtml(linkedDoc.title)}</span>` : ''}
                            ${linkedCodes.length > 0 ? `<span>${escapeHtml(linkedCodes.slice(0, 3).join(', '))}</span>` : ''}
                        </div>
                    </div>
                `;
            };

            const sortByDocumentLocation = (a, b) => {
                const la = getMemoLocation(a);
                const lb = getMemoLocation(b);
                if (la.rank !== lb.rank) return la.rank - lb.rank;
                if (la.a !== lb.a) return la.a - lb.a;
                if (la.b !== lb.b) return la.b - lb.b;
                return memoTimeForSort(a) - memoTimeForSort(b);
            };

            orderedDocIds.forEach((docId) => {
                const linkedDoc = appData.documents.find(d => d.id === docId);
                const group = groupsByDoc[docId] || [];
                group.sort(sortByDocumentLocation);
                html += `<div class="filter-doc-header" data-doc-id="${escapeHtmlAttrValue(docId)}" title="Click to open document">${escapeHtml(linkedDoc?.title || 'Document')}<span class="filter-doc-meta">(${group.length} annotation${group.length !== 1 ? 's' : ''})</span></div>`;
                html += group.map(renderMemoCard).join('');
            });

            if (otherGroup.length > 0) {
                otherGroup.sort((a, b) => memoTimeForSort(b) - memoTimeForSort(a));
                html += `<div class="filter-doc-header">Project / code annotations<span class="filter-doc-meta">(${otherGroup.length})</span></div>`;
                html += otherGroup.map(renderMemoCard).join('');
            }
        }
        html += '</div>';
    } else if (sortedDocs.length === 0) {
        destroyFilterVirtualization();
        html += '<p style="color: var(--text-secondary);">No segments found for this code.</p>';
    } else {
        const rows = [];
        const codeById = new Map(appData.codes.map((code) => [code.id, code]));
        sortedDocs.forEach(doc => {
            const docSegments = segmentsByDoc[doc.id];
            const segmentCreatedMs = (segment) => {
                const ms = new Date(segment?.created || 0).getTime();
                return Number.isFinite(ms) ? ms : 0;
            };
            // Default view: keep snippets/regions in coding order (created ascending).
            // Other sort modes keep existing behavior.
            docSegments.sort((a, b) => {
                if (codeViewUiState.segmentsSort === 'date') {
                    return new Date(b.modified || b.created || 0) - new Date(a.modified || a.created || 0);
                }
                const createdDiff = segmentCreatedMs(a) - segmentCreatedMs(b);
                if (createdDiff !== 0) return createdDiff;
                if (!!a.pdfRegion !== !!b.pdfRegion) return a.pdfRegion ? 1 : -1;
                if (a.pdfRegion && b.pdfRegion) {
                    if ((a.pdfRegion.pageNum || 0) !== (b.pdfRegion.pageNum || 0)) return (a.pdfRegion.pageNum || 0) - (b.pdfRegion.pageNum || 0);
                    if ((a.pdfRegion.yNorm || 0) !== (b.pdfRegion.yNorm || 0)) return (a.pdfRegion.yNorm || 0) - (b.pdfRegion.yNorm || 0);
                    return (a.pdfRegion.xNorm || 0) - (b.pdfRegion.xNorm || 0);
                }
                return (a.startIndex || 0) - (b.startIndex || 0);
            });
            
            const segmentCount = docSegments.length;
            rows.push({
                type: 'header',
                html: `<div class="filter-doc-header" data-doc-id="${escapeHtmlAttrValue(doc.id)}" title="Click to open document">${escapeHtml(doc.title)}<span class="filter-doc-meta">(${segmentCount} segment${segmentCount !== 1 ? 's' : ''})</span></div>`
            });
            
            docSegments.forEach((segment) => {
                const snippetText = segment.pdfRegion
                    ? `[PDF page ${segment.pdfRegion.pageNum}] ${segment.text || 'Region selection'}`
                    : segment.text;
                const memos = getRelevantSegmentMemos(segment);
                const memoHtml = memos.length > 0
                    ? `<div class="filter-snippet-memo">${preserveLineBreaks(escapeHtml(memos[0].content || ''))}</div>`
                    : '<div class="filter-snippet-memo empty">No annotation.</div>';
                const inlineTextMemoHtml = (!segment.pdfRegion && memos.length > 0)
                    ? `<div class="filter-snippet-memo-inline">${preserveLineBreaks(escapeHtml(memos[0].content || ''))}</div>`
                    : '';
                const segmentCodes = Array.isArray(segment.codeIds)
                    ? segment.codeIds.map((id) => codeById.get(id)).filter(Boolean)
                    : [];
                const previewHtml = segment.pdfRegion
                    ? `<div class="filter-pdf-row">
                            <div class="filter-pdf-preview" data-segment-id="${escapeHtmlAttrValue(segment.id)}" data-doc-id="${escapeHtmlAttrValue(doc.id)}">
                                <div class="filter-pdf-preview-loading">Loading region preview...</div>
                            </div>
                            <div class="filter-pdf-side">${memoHtml}</div>
                        </div>`
                    : '';
                rows.push({
                    type: 'snippet',
                    isPdf: !!segment.pdfRegion,
                    text: snippetText,
                    hasMemo: memos.length > 0,
                    memoText: memos[0]?.content || '',
                    html: `<div class="filter-snippet ${segment.pdfRegion ? 'pdf-snippet' : ''} ${codeInspectorState.segmentId === segment.id ? 'inspector-selected' : ''}" data-segment-id="${escapeHtmlAttrValue(segment.id)}" data-doc-id="${escapeHtmlAttrValue(doc.id)}">
                        ${previewHtml}
                        <div class="filter-snippet-main">
                            <span class="coded-segment" style="${buildSegmentVisualStyleFromCodes(segmentCodes)}"><span class="coded-segment-text">${preserveLineBreaks(escapeHtml(snippetText))}${inlineTextMemoHtml}</span><span class="coded-segment-marker" aria-hidden="true"></span></span>
                        </div>
                    </div>`
                });
            });
        });
        const hasPdfRows = rows.some(r => r && r.type === 'snippet' && r.isPdf);
        if (hasPdfRows) {
            // Mixed-height PDF previews can break absolute-position virtualization.
            // Use normal document flow for robust layout.
            destroyFilterVirtualization();
            html += rows.map(r => r.html).join('');
            content.innerHTML = `${html}</div>`;
            hydrateFilterPdfRegionPreviews(content);
        } else {
            html += '<div id="filterVirtualizedList" class="filter-virtualized-list"></div>';
            content.innerHTML = `${html}</div>`;
            initFilterVirtualization(rows);
        }
        return;
    }
    
    html += '</div>';
    content.innerHTML = html;
    if (codeViewUiState.mode === 'segments') hydrateFilterPdfRegionPreviews();
}

async function hydrateFilterPdfRegionPreviews(rootEl = document) {
    const scope = rootEl || document;
    const holders = Array.from(scope.querySelectorAll('.filter-pdf-preview'));
    if (holders.length === 0) return;

    const VISIBLE_LIMIT = (scope === document) ? 16 : 32;
    const visible = holders.slice(0, VISIBLE_LIMIT);
    const background = holders.slice(VISIBLE_LIMIT);
    const thumbFn = (typeof queuePdfRegionThumbnail === 'function')
        ? queuePdfRegionThumbnail
        : getPdfRegionThumbnail;

    const requestThumb = (el, priority) => {
        if (!el || el.dataset.hydrated === '1') return;
        const segmentId = el.dataset.segmentId;
        const docId = el.dataset.docId;
        const segment = appData.segments.find(s => s.id === segmentId);
        const doc = appData.documents.find(d => d.id === docId);
        if (!segment || !segment.pdfRegion || !doc) {
            el.innerHTML = '<div class="filter-pdf-preview-note">Region unavailable.</div>';
            el.dataset.hydrated = '1';
            return;
        }

        Promise.resolve(thumbFn(doc, segment.pdfRegion, { width: 312, priority }))
            .then((dataUrl) => {
                if (!dataUrl) {
                    if (el.dataset.hydrated !== '1') {
                        el.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
                        el.dataset.hydrated = '1';
                    }
                    return;
                }
                if (!el.isConnected) return;
                if (el.dataset.segmentId !== segmentId || el.dataset.docId !== docId) return;
                el.innerHTML = `<button type="button" class="filter-pdf-preview-btn" data-segment-id="${escapeHtmlAttrValue(segment.id)}" data-doc-id="${escapeHtmlAttrValue(doc.id)}" title="Open full-size preview">
                    <img src="${escapeHtmlAttrValue(dataUrl)}" alt="PDF region preview" class="filter-pdf-preview-img" onload="handleFilterPreviewImageLoaded()">
                </button>`;
                el.dataset.hydrated = '1';
                scheduleFilterVirtualRender(true);
                const imgEl = el.querySelector('.filter-pdf-preview-img');
                if (imgEl && imgEl.complete) {
                    requestAnimationFrame(() => scheduleFilterVirtualRender(true));
                }
            })
            .catch(() => {
                if (el.dataset.hydrated !== '1') {
                    el.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
                    el.dataset.hydrated = '1';
                }
            });
    };

    visible.forEach((el, idx) => requestThumb(el, 120 - idx));
    background.forEach((el, idx) => {
        if (el.dataset.hydrated === '1') return;
        el.innerHTML = '<div class="filter-pdf-preview-note">Preparing preview...</div>';
        requestThumb(el, 20 - Math.min(19, idx));
    });
}

function handleFilterPreviewImageLoaded() {
    scheduleFilterVirtualRender(true);
}

async function editFilterCodeDescription(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;
    openCodeDescriptionModal(codeId);
}

let currentCodeDescriptionEditId = null;

function openCodeDescriptionModal(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;
    currentCodeDescriptionEditId = codeId;

    const modal = document.getElementById('codeDescriptionModal');
    const shortInput = document.getElementById('codeDescriptionShortInput');
    const notesInput = document.getElementById('codeDescriptionNotesInput');
    if (!modal || !shortInput || !notesInput) return;

    shortInput.value = code.description || '';
    notesInput.value = code.notes || '';
    modal.classList.add('show');
    setTimeout(() => shortInput.focus(), 0);
}

function closeCodeDescriptionModal() {
    const modal = document.getElementById('codeDescriptionModal');
    if (modal) modal.classList.remove('show');
    currentCodeDescriptionEditId = null;
}

function saveCodeDescriptionFromModal(event) {
    if (event) event.preventDefault();
    const code = appData.codes.find(c => c.id === currentCodeDescriptionEditId);
    if (!code) {
        closeCodeDescriptionModal();
        return;
    }

    const shortInput = document.getElementById('codeDescriptionShortInput');
    const notesInput = document.getElementById('codeDescriptionNotesInput');
    const nextDescription = (shortInput?.value || '').trim();
    const nextNotes = String(notesInput?.value || '');

    if (nextDescription === (code.description || '') && nextNotes === (code.notes || '')) {
        closeCodeDescriptionModal();
        return;
    }

    saveHistory();
    code.description = nextDescription;
    code.notes = nextNotes;
    saveData();
    closeCodeDescriptionModal();
    renderAll();
}

async function openPdfRegionPreviewModal(segmentId, docId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const modal = document.getElementById('pdfRegionPreviewModal');
    const titleEl = document.getElementById('pdfRegionPreviewTitle');
    const imageWrap = document.getElementById('pdfRegionPreviewImageWrap');
    const notesEl = document.getElementById('pdfRegionPreviewNotes');
    const segment = appData.segments.find(s => s.id === segmentId);
    const doc = appData.documents.find(d => d.id === docId);
    if (!modal || !titleEl || !imageWrap || !notesEl || !segment || !doc || !segment.pdfRegion) return;

    titleEl.textContent = `${doc.title} · Page ${segment.pdfRegion.pageNum}`;
    imageWrap.innerHTML = '<div class="filter-pdf-preview-loading">Loading full-size preview...</div>';
    const memos = getMemosForTarget('segment', segment.id);
    if (memos.length === 0) {
        notesEl.innerHTML = '<div class="pdf-region-preview-note-empty">No annotations.</div>';
    } else {
        notesEl.innerHTML = memos.map((memo, idx) => `
            <div class="pdf-region-preview-note-item">
                <div class="pdf-region-preview-note-head">Annotation ${idx + 1}</div>
                <div>${preserveLineBreaks(escapeHtml(memo.content || ''))}</div>
            </div>
        `).join('');
    }
    modal.classList.add('show');

    try {
        const dataUrl = await getPdfRegionThumbnail(doc, segment.pdfRegion, { width: 900 });
        if (!dataUrl) {
            imageWrap.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
            return;
        }
        imageWrap.innerHTML = `<img src="${escapeHtmlAttrValue(dataUrl)}" alt="PDF region full preview" class="pdf-region-preview-image">`;
    } catch (_) {
        imageWrap.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
    }
}

function closePdfRegionPreviewModal() {
    const modal = document.getElementById('pdfRegionPreviewModal');
    if (modal) modal.classList.remove('show');
}

let codeViewDelegationBound = false;
function initCodeViewDelegatedHandlers() {
    if (codeViewDelegationBound) return;
    const content = document.getElementById('documentContent');
    if (!content) return;

    content.addEventListener('click', (event) => {
        const previewBtn = event.target.closest('.filter-pdf-preview-btn[data-segment-id][data-doc-id]');
        if (previewBtn) {
            event.preventDefault();
            event.stopPropagation();
            openPdfRegionPreviewModal(previewBtn.dataset.segmentId, previewBtn.dataset.docId, event);
            return;
        }

        const memoItem = event.target.closest('.annotation-item[data-memo-id]');
        if (memoItem) {
            event.preventDefault();
            goToAnnotationSource(memoItem.dataset.memoId);
            return;
        }

        const header = event.target.closest('.filter-doc-header[data-doc-id]');
        if (header) {
            event.preventDefault();
            goToDocumentFromFilter(header.dataset.docId);
            return;
        }

        const snippet = event.target.closest('.filter-snippet[data-segment-id][data-doc-id]');
        if (snippet) {
            if (event.target.closest('.filter-pdf-preview-btn')) return;
            selectSegmentInCodeView(snippet.dataset.segmentId, snippet.dataset.docId, event);
        }
    });

    content.addEventListener('contextmenu', (event) => {
        const snippet = event.target.closest('.filter-snippet[data-segment-id][data-doc-id]');
        if (!snippet) return;
        showFilterSnippetContextMenu(snippet.dataset.segmentId, snippet.dataset.docId, event);
    });

    codeViewDelegationBound = true;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function goToDocumentFromFilter(docId) {
    appData.filterCodeId = null;
    selectDocument(docId);
}

function openCodingInspectorForSegment(segmentId, preferredCodeId = '') {
    const segment = appData.segments.find(s => s.id === segmentId);
    if (!segment) return;

    const preferred = String(preferredCodeId || '').trim();
    const availableCodeIds = Array.isArray(segment.codeIds) ? segment.codeIds.filter(Boolean) : [];
    const targetCodeId = (preferred && availableCodeIds.includes(preferred))
        ? preferred
        : (availableCodeIds[0] || '');

    if (!targetCodeId) return;

    appData.filterCodeId = targetCodeId;
    codeViewUiState.mode = 'segments';
    codeInspectorState.segmentId = segment.id;
    codeInspectorState.docId = segment.docId;
    renderAll();
}

function showFilterSnippetContextMenu(segmentId, docId, event) {
    event.preventDefault();
    event.stopPropagation();
    
    const doc = appData.documents.find(d => d.id === docId);
    const docName = doc ? doc.title : 'document';
    
    showContextMenu([
        { label: 'Annotations', onClick: () => openMemoModal('segment', segmentId) },
        { label: 'Remove coding', onClick: () => deleteCodingFromFilter(segmentId), danger: true },
        { type: 'sep' },
        { label: `Go to location in "${docName}"`, onClick: () => goToSegmentLocation(docId, segmentId) }
    ], event.clientX, event.clientY);
}

function deleteCodingFromFilter(segmentId) {
    const segment = appData.segments.find(s => s.id === segmentId);
    if (!segment) return;
    if (!confirm('Remove this coding?')) return;

    saveHistory();
    appData.segments = appData.segments.filter(s => s.id !== segmentId);
    saveData();
    renderAll();
}

function goToSegmentLocation(docId, segmentId) {
    // Clear filter and navigate to document
    appData.filterCodeId = null;
    selectDocument(docId);
    
    // After render, scroll to and highlight the segment location
    setTimeout(() => {
        const segment = appData.segments.find(s => s.id === segmentId);
        if (!segment) return;
        const doc = appData.documents.find(d => d.id === docId);
        if (doc && doc.type === 'pdf' && segment.pdfRegion && typeof pdfGoToRegion === 'function') {
            pdfGoToRegion(doc, segment.pdfRegion, segment.id);
        } else {
            scrollToCharacterPosition(segment.startIndex || 0);
        }
    }, 50);
}

function scrollToCharacterPosition(charIndex) {
    const contentElement = document.getElementById('documentContent');
    if (!contentElement) return;
    
    // Walk through text nodes to find the position
    const walker = document.createTreeWalker(contentElement, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_ACCEPT;
            if (p.classList.contains('memo-indicator') || p.classList.contains('code-actions')) return NodeFilter.FILTER_REJECT;
            if (p.closest && p.closest('.code-actions')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    
    let currentPos = 0;
    let targetNode = null;
    let targetOffset = 0;
    
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const len = (node.nodeValue || '').length;
        
        if (currentPos + len >= charIndex) {
            targetNode = node;
            targetOffset = charIndex - currentPos;
            break;
        }
        currentPos += len;
    }
    
    if (targetNode) {
        // Create a temporary range to get position
        const range = document.createRange();
        range.setStart(targetNode, Math.min(targetOffset, targetNode.length));
        range.setEnd(targetNode, Math.min(targetOffset, targetNode.length));
        
        const rect = range.getBoundingClientRect();
        const contentBody = document.querySelector('.content-body');
        
        if (contentBody && rect) {
            // Scroll so the target is roughly in the upper third of the view
            const containerRect = contentBody.getBoundingClientRect();
            const scrollOffset = rect.top - containerRect.top + contentBody.scrollTop - (containerRect.height / 3);
            contentBody.scrollTo({ top: scrollOffset, behavior: 'smooth' });
            
            // Briefly highlight the area with a visual indicator
            flashLocationIndicator(rect.left, rect.top);
        }
    }
}

function flashLocationIndicator(x, y) {
    const indicator = document.createElement('div');
    indicator.className = 'location-indicator';
    indicator.style.left = (x - 10) + 'px';
    indicator.style.top = (y - 10) + 'px';
    document.body.appendChild(indicator);
    
    setTimeout(() => {
        indicator.classList.add('fade-out');
        setTimeout(() => indicator.remove(), 300);
    }, 500);
}
