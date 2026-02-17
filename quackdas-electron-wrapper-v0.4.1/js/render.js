/**
 * Quackdas - Rendering Functions
 * All UI rendering logic
 */

function renderAll() {
    renderDocuments();
    renderCodes();
    renderCurrentDocument();
    applyZoom();
    if (typeof updateHeaderPrimaryAction === 'function') updateHeaderPrimaryAction();
}

function renderDocuments() {
    const allList = document.getElementById('documentsList');
    const recentList = document.getElementById('recentDocumentsList');
    
    // Helper to render a document item (draggable)
    const renderDocItem = (doc, indent = 0) => {
        const memoCount = getMemoCountForTarget('document', doc.id);
        const memoIndicator = memoCount > 0 ? `<span class="memo-indicator" title="${memoCount} memo(s)">💭${memoCount}</span>` : '';
        const metaPreview = doc.metadata?.participantId ? ` • ID: ${escapeHtml(doc.metadata.participantId)}` : '';
        const indentStyle = indent > 0 ? `style="padding-left: ${12 + indent * 16}px;"` : '';
        const isPdf = doc.type === 'pdf';
        const typeIndicator = isPdf ? '<span class="doc-type-badge" title="PDF document">PDF</span>' : '';
        const contentInfo = isPdf ? `${doc.pdfPages?.length || '?'} pages` : `${doc.content.length} chars`;
        
        const isSelected = Array.isArray(appData.selectedDocIds) && appData.selectedDocIds.includes(doc.id);
        return `
            <div class="document-item ${doc.id === appData.currentDocId ? 'active' : ''} ${isSelected ? 'selected' : ''}" 
                 ${indentStyle} 
                 draggable="true"
                 data-doc-id="${doc.id}"
                 ondragstart="handleDocDragStart(event, '${doc.id}')"
                 ondragend="handleDocDragEnd(event)"
                onclick="selectDocumentFromList(event, '${doc.id}')" 
                oncontextmenu="openDocumentContextMenu('${doc.id}', event)">
                <div class="document-item-title">
                    ${typeIndicator}${escapeHtml(doc.title)}${memoIndicator}
                    <button class="code-action-btn" onclick="openDocumentMetadata('${doc.id}', event)" title="Edit metadata" style="float: right;"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
                </div>
                <div class="document-item-meta">${contentInfo} • ${getDocSegmentCountFast(doc.id)} codes${metaPreview}</div>
            </div>
        `;
    };
    
    // Helper to render a folder item (with drop zone for documents)
    const renderFolderItem = (folder, indent = 0) => {
        const isExpanded = folder.expanded !== false;
        const expandIcon = isExpanded ? '▼' : '▶';
        const indentStyle = indent > 0 ? `padding-left: ${12 + indent * 16}px;` : '';
        
        return `
            <div class="folder-item" style="${indentStyle}" 
                 data-folder-id="${folder.id}"
                 ondragover="handleFolderDragOver(event)" 
                 ondragleave="handleFolderDragLeave(event)" 
                 ondrop="handleDocumentDropOnFolder(event, '${folder.id}')"
                 oncontextmenu="openFolderContextMenu('${folder.id}', event)">
                <span class="folder-expand" onclick="toggleFolderExpanded('${folder.id}', event)">${expandIcon}</span>
                <span class="folder-icon">📁</span>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <button class="folder-settings-btn" onclick="openFolderInfo('${folder.id}', event)" title="Folder info"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
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
        const folders = appData.folders.filter(f => f.parentId === parentId);
        folders.forEach(folder => {
            // Skip if already visited (cycle detection)
            if (visited.has(folder.id)) return;
            visited.add(folder.id);
            
            html += renderFolderItem(folder, indent);
            
            if (folder.expanded !== false) {
                // Render documents in this folder
                const docsInFolder = appData.documents.filter(d => d.folderId === folder.id);
                docsInFolder.forEach(doc => {
                    html += renderDocItem(doc, indent + 1);
                });
                
                // Render subfolders
                html += renderFolderTree(folder.id, indent + 1, visited);
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
    const rootDocs = appData.documents.filter(d => !d.folderId);
    if (appData.folders.length > 0 && rootDocs.length > 0) {
        allHtml += '<div class="root-doc-separator"></div>';
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
    
    // Render recent documents (5 most recently accessed)
    const recentDocs = appData.documents
        .filter(doc => doc.lastAccessed)
        .sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed))
        .slice(0, 5);
    
    if (recentDocs.length === 0) {
        recentList.innerHTML = '<div class="empty-state" style="padding: 20px;"><p style="font-size: 13px;">No recent documents</p></div>';
    } else {
        recentList.innerHTML = recentDocs.map(doc => renderDocItem(doc, 0)).join('');
    }
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
            `<option value="${c.id}">${c.name}</option>`
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
    const count = getCodeSegmentCountFast(code.id);
    const children = appData.codes.filter(c => c.parentId === code.id);
    const isSelected = appData.filterCodeId === code.id;
    const shortcutBadge = code.shortcut ? `<span style="font-size: 11px; opacity: 0.6; margin-left: 4px;">[${escapeHtml(code.shortcut)}]</span>` : '';
    const memoCount = getMemoCountForTarget('code', code.id);
    const memoIndicator = memoCount > 0 ? `<span class="memo-indicator" title="${memoCount} memo(s)">💭</span>` : '';
    const titleAttr = code.description ? `title="${escapeHtml(code.description)}"` : '';
    const dragAttr = !isChild ? `draggable="true" data-code-id="${code.id}" data-sort-index="${index}"` : '';
    
    let html = `
        <div class="code-item ${isChild ? 'child' : 'draggable-code'} ${isSelected ? 'selected' : ''}" onclick="filterByCode('${code.id}', event)" oncontextmenu="openCodeContextMenu('${code.id}', event)" ${titleAttr} ${dragAttr}>
            ${!isChild ? '<span class="drag-handle" title="Drag to reorder">⠿</span>' : ''}
            <div class="code-color" style="background: ${escapeHtml(code.color)};"></div>
            <div class="code-name">${escapeHtml(code.name)}${shortcutBadge}${memoIndicator}</div>
            <div class="code-count">${count}</div>
            <div class="code-actions">
                <button class="code-action-btn" onclick="deleteCode('${code.id}', event)" title="Delete">×</button>
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

function renderCurrentDocument() {
    const doc = appData.documents.find(d => d.id === appData.currentDocId);
    
    // If in filtered view, we show all documents regardless of current selection
    if (appData.filterCodeId) {
        setDocumentViewMode(false);
        const code = appData.codes.find(c => c.id === appData.filterCodeId);
        document.getElementById('documentTitle').textContent = `All documents · ${code ? code.name : 'Code'}`;
        renderFilteredView();
        return;
    }
    
    if (!doc) {
        setDocumentViewMode(false);
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
        document.getElementById('documentTitle').textContent = 'Select or add a document';
        // Clean up any PDF state
        if (typeof cleanupPdfState === 'function') cleanupPdfState();
        return;
    }

    document.getElementById('documentTitle').textContent = doc.title;
    
    // Check if this is a PDF document
    if (doc.type === 'pdf') {
        setDocumentViewMode(true);
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
}

// Render a span of coded text with the given active segments
function renderCodedSpan(text, activeSegments) {
    // Collect all unique codes from active segments
    const codes = [];
    activeSegments.forEach(seg => {
        seg.codeIds.forEach(codeId => {
            const code = appData.codes.find(c => c.id === codeId);
            if (code && !codes.find(c => c.id === code.id)) {
                codes.push(code);
            }
        });
    });
    
    // Create visual representation
    const codeNames = codes.map(c => c.name).join(', ');
    const primaryColor = codes[0]?.color || '#999';
    
    // For multiple codes, show a gradient or multiple indicators
    let borderStyle = `border-bottom: 2px solid ${primaryColor};`;
    if (codes.length > 1) {
        const colors = codes.slice(0, 4).map(c => c.color).join(', ');
        borderStyle = `border-bottom: 3px solid; border-image: linear-gradient(to right, ${colors}) 1;`;
    }
    
    const segmentIds = activeSegments.map(s => s.id).join(',');
    const segmentMemoCount = activeSegments.reduce((sum, s) => sum + getMemoCountForTarget('segment', s.id), 0);
    const segmentMemoIndicator = segmentMemoCount > 0 ? `<span class="memo-indicator" onclick="openMemoModal('segment', '${activeSegments[0].id}', event)" title="${segmentMemoCount} memo(s)">💭</span>` : '';
    
    return `<span class="coded-segment" style="${borderStyle}" data-tooltip="${escapeHtml(codeNames)} • Right-click for options" onclick="showSegmentMenu('${segmentIds}', event)" oncontextmenu="showSegmentContextMenu('${segmentIds}', event)">${escapeHtml(text)}</span>${segmentMemoIndicator}`;
}

// Helper escapeHtml and preserveLineBreaks below

function preserveLineBreaks(text) {
    // Convert line breaks to <br> tags without removing any characters
    // This preserves the exact character count and positions
    return text.replace(/\n/g, '<br>');
}

function renderFilteredView() {
    const code = appData.codes.find(c => c.id === appData.filterCodeId);
    
    // Get all segments with this code across all documents (using index)
    const allSegments = getSegmentsForCode(appData.filterCodeId);
    
    // Group segments by document
    const segmentsByDoc = {};
    allSegments.forEach(segment => {
        if (!segmentsByDoc[segment.docId]) {
            segmentsByDoc[segment.docId] = [];
        }
        segmentsByDoc[segment.docId].push(segment);
    });
    
    // Sort documents by creation date (oldest first)
    const sortedDocs = appData.documents
        .filter(doc => segmentsByDoc[doc.id])
        .sort((a, b) => new Date(a.created) - new Date(b.created));
    
    const content = document.getElementById('documentContent');
    
    // Count total segments
    const totalSegments = allSegments.length;
    const docCount = sortedDocs.length;
    
    // Shortcut display
    const shortcutDisplay = code.shortcut ? ` [${code.shortcut}]` : '';
    const shortcutAction = code.shortcut 
        ? `<span class="filter-shortcut" onclick="assignShortcut('${code.id}')" title="Click to change shortcut">Shortcut: ${code.shortcut}</span>`
        : `<span class="filter-shortcut" onclick="assignShortcut('${code.id}')" title="Click to assign shortcut">Assign shortcut</span>`;
    const hasDescription = !!(code.description && code.description.trim());
    const descriptionText = hasDescription ? escapeHtml(code.description) : 'No description yet.';
    const descriptionHtml = hasDescription
        ? `<div class="filter-code-description">
                <span class="filter-code-description-label"><strong>Description and notes:</strong></span>
                <span class="filter-code-description-text">${preserveLineBreaks(descriptionText)}</span>
                <button class="filter-description-btn" onclick="editFilterCodeDescription('${code.id}')">Edit</button>
            </div>`
        : `<div class="filter-code-description empty">
                <span class="filter-code-description-label"><strong>Description and notes:</strong></span>
                <span class="filter-code-description-text">${descriptionText}</span>
                <button class="filter-description-btn" onclick="editFilterCodeDescription('${code.id}')">Add description</button>
            </div>`;
    
    let html = `
        <div class="code-view-banner">
            <span class="filter-title"><strong>Code: ${code.name}${shortcutDisplay}</strong></span>
            <span class="filter-meta">${totalSegments} segment${totalSegments !== 1 ? 's' : ''} · ${docCount} document${docCount !== 1 ? 's' : ''}</span>
            ${shortcutAction}
        </div>
        ${descriptionHtml}
        <div class="document-text">
    `;
    
    if (sortedDocs.length === 0) {
        html += '<p style="color: var(--text-secondary);">No segments found for this code.</p>';
    } else {
        sortedDocs.forEach(doc => {
            const docSegments = segmentsByDoc[doc.id];
            // Sort segments by their position in the document
            docSegments.sort((a, b) => {
                if (a.pdfRegion && b.pdfRegion) {
                    if (a.pdfRegion.pageNum !== b.pdfRegion.pageNum) return a.pdfRegion.pageNum - b.pdfRegion.pageNum;
                    return (a.pdfRegion.yNorm || 0) - (b.pdfRegion.yNorm || 0);
                }
                return (a.startIndex || 0) - (b.startIndex || 0);
            });
            
            const segmentCount = docSegments.length;
            html += `<div class="filter-doc-header" onclick="goToDocumentFromFilter('${doc.id}')" title="Click to open document">${escapeHtml(doc.title)}<span class="filter-doc-meta">(${segmentCount} segment${segmentCount !== 1 ? 's' : ''})</span></div>`;
            
            docSegments.forEach((segment, i) => {
                const snippetText = segment.pdfRegion
                    ? `[PDF page ${segment.pdfRegion.pageNum}] ${segment.text || 'Region selection'}`
                    : segment.text;
                const memos = getMemosForTarget('segment', segment.id);
                const memoHtml = memos.length > 0
                    ? `<div class="filter-snippet-memo">💭 ${preserveLineBreaks(escapeHtml(memos[0].content || ''))}</div>`
                    : '<div class="filter-snippet-memo empty">No annotation.</div>';
                const menuBtnHtml = memos.length > 0
                    ? `<button class="filter-snippet-menu-btn" onclick="openSegmentMemoFromFilter('${segment.id}', event)" title="Annotations">⋯</button>`
                    : '';
                const previewHtml = segment.pdfRegion
                    ? `<div class="filter-pdf-row">
                            <div class="filter-pdf-preview" data-segment-id="${segment.id}" data-doc-id="${doc.id}">
                                <div class="filter-pdf-preview-loading">Loading region preview...</div>
                            </div>
                            ${menuBtnHtml}
                            <div class="filter-pdf-side">${memoHtml}</div>
                        </div>`
                    : '';
                const inlineMemoHtml = segment.pdfRegion ? '' : (memos.length > 0 ? memoHtml : '');
                const textMenuBtnHtml = segment.pdfRegion ? '' : menuBtnHtml;
                html += `<div class="filter-snippet" oncontextmenu="showFilterSnippetContextMenu('${segment.id}', '${doc.id}', event)">
                    ${previewHtml}
                    <div class="filter-snippet-main">
                        <span class="coded-segment" style="border-color: ${code.color};">${preserveLineBreaks(escapeHtml(snippetText))}</span>
                        ${textMenuBtnHtml}
                    </div>
                    ${inlineMemoHtml}
                </div>`;
            });
        });
    }
    
    html += '</div>';
    content.innerHTML = html;
    hydrateFilterPdfRegionPreviews();
}

async function hydrateFilterPdfRegionPreviews() {
    const holders = Array.from(document.querySelectorAll('.filter-pdf-preview'));
    if (holders.length === 0) return;

    const PREVIEW_LIMIT = 12;
    const toRender = holders.slice(0, PREVIEW_LIMIT);
    const skipped = holders.slice(PREVIEW_LIMIT);

    for (const el of skipped) {
        el.innerHTML = '<div class="filter-pdf-preview-note">Preview omitted for performance. Use "Go to location".</div>';
    }

    for (const el of toRender) {
        const segmentId = el.dataset.segmentId;
        const docId = el.dataset.docId;
        const segment = appData.segments.find(s => s.id === segmentId);
        const doc = appData.documents.find(d => d.id === docId);
        if (!segment || !segment.pdfRegion || !doc) {
            el.innerHTML = '<div class="filter-pdf-preview-note">Region unavailable.</div>';
            continue;
        }
        if (typeof getPdfRegionThumbnail !== 'function') {
            el.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
            continue;
        }

        try {
            const dataUrl = await getPdfRegionThumbnail(doc, segment.pdfRegion, { width: 260 });
            if (!dataUrl) {
                el.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
                continue;
            }
            el.innerHTML = `<button type="button" class="filter-pdf-preview-btn" onclick="openPdfRegionPreviewModal('${segment.id}', '${doc.id}', event)" title="Open full-size preview">
                <img src="${dataUrl}" alt="PDF region preview" class="filter-pdf-preview-img">
            </button>`;
        } catch (_) {
            el.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
        }
    }
}

function openSegmentMemoFromFilter(segmentId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    openMemoModal('segment', segmentId);
}

async function editFilterCodeDescription(codeId) {
    const code = appData.codes.find(c => c.id === codeId);
    if (!code) return;
    const input = await openTextPrompt('Code description', code.description || '');
    if (input === null) return;

    saveHistory();
    code.description = input.trim();
    saveData();
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
                <div class="pdf-region-preview-note-head">Note ${idx + 1}</div>
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
        imageWrap.innerHTML = `<img src="${dataUrl}" alt="PDF region full preview" class="pdf-region-preview-image">`;
    } catch (_) {
        imageWrap.innerHTML = '<div class="filter-pdf-preview-note">Preview unavailable.</div>';
    }
}

function closePdfRegionPreviewModal() {
    const modal = document.getElementById('pdfRegionPreviewModal');
    if (modal) modal.classList.remove('show');
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

function showFilterSnippetContextMenu(segmentId, docId, event) {
    event.preventDefault();
    event.stopPropagation();
    
    const doc = appData.documents.find(d => d.id === docId);
    const docName = doc ? doc.title : 'document';
    
    showContextMenu([
        { label: 'Annotations', onClick: () => openMemoModal('segment', segmentId) },
        { type: 'sep' },
        { label: `Go to location in "${docName}"`, onClick: () => goToSegmentLocation(docId, segmentId) }
    ], event.clientX, event.clientY);
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
