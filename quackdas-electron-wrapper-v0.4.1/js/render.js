/**
 * Quackdas - Rendering Functions
 * All UI rendering logic
 */

function renderAll() {
    renderDocuments();
    renderCodes();
    renderCurrentDocument();
    applyZoom();
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
        
        return `
            <div class="document-item ${doc.id === appData.currentDocId ? 'active' : ''}" 
                 ${indentStyle} 
                 draggable="true"
                 data-doc-id="${doc.id}"
                 ondragstart="handleDocDragStart(event, '${doc.id}')"
                 ondragend="handleDocDragEnd(event)"
                 onclick="selectDocument('${doc.id}')" 
                 oncontextmenu="openDocumentContextMenu('${doc.id}', event)">
                <div class="document-item-title">
                    ${typeIndicator}${escapeHtml(doc.title)}${memoIndicator}
                    <button class="code-action-btn" onclick="openDocumentMetadata('${doc.id}', event)" title="Edit metadata" style="float: right;"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
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
        const hasDescription = folder.description && folder.description.trim();
        const descIndicator = hasDescription ? ' •' : '';
        
        return `
            <div class="folder-item" style="${indentStyle}" 
                 data-folder-id="${folder.id}"
                 ondragover="handleFolderDragOver(event)" 
                 ondragleave="handleFolderDragLeave(event)" 
                 ondrop="handleDocumentDropOnFolder(event, '${folder.id}')"
                 oncontextmenu="openFolderContextMenu('${folder.id}', event)">
                <span class="folder-expand" onclick="toggleFolderExpanded('${folder.id}', event)">${expandIcon}</span>
                <span class="folder-icon">📁</span>
                <span class="folder-name">${escapeHtml(folder.name)}${descIndicator}</span>
                <button class="folder-settings-btn" onclick="openFolderInfo('${folder.id}', event)" title="Folder info"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
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
                <button class="code-action-btn" onclick="openMemoModal('code', '${code.id}', event)" title="Add/view memos">💭</button>
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
    if (panel) panel.classList.toggle('pdf-mode', !!isPdf);
    if (nav) nav.hidden = !isPdf;
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
    
    let html = `
        <div class="filter-active">
            <span class="filter-title">Filtering: ${code.name}${shortcutDisplay}</span>
            <span class="filter-meta">${totalSegments} segment${totalSegments !== 1 ? 's' : ''} · ${docCount} document${docCount !== 1 ? 's' : ''}</span>
            ${shortcutAction}
            <span class="filter-clear" onclick="clearFilter()">Clear filter</span>
        </div>
        <div class="document-text">
    `;
    
    if (sortedDocs.length === 0) {
        html += '<p style="color: var(--text-secondary);">No segments found for this code.</p>';
    } else {
        sortedDocs.forEach(doc => {
            const docSegments = segmentsByDoc[doc.id];
            // Sort segments by their position in the document
            docSegments.sort((a, b) => a.startIndex - b.startIndex);
            
            const segmentCount = docSegments.length;
            html += `<div class="filter-doc-header" onclick="goToDocumentFromFilter('${doc.id}')" title="Click to open document">${escapeHtml(doc.title)}<span class="filter-doc-meta">(${segmentCount} segment${segmentCount !== 1 ? 's' : ''})</span></div>`;
            
            docSegments.forEach((segment, i) => {
                html += `<div class="filter-snippet" oncontextmenu="showFilterSnippetContextMenu('${segment.id}', '${doc.id}', ${segment.startIndex}, event)"><span class="coded-segment" style="border-color: ${code.color};">${preserveLineBreaks(escapeHtml(segment.text))}</span></div>`;
            });
        });
    }
    
    html += '</div>';
    content.innerHTML = html;
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

function showFilterSnippetContextMenu(segmentId, docId, startIndex, event) {
    event.preventDefault();
    event.stopPropagation();
    
    const doc = appData.documents.find(d => d.id === docId);
    const docName = doc ? doc.title : 'document';
    
    showContextMenu([
        { label: `Go to location in "${docName}"`, onClick: () => goToSegmentLocation(docId, startIndex) }
    ], event.clientX, event.clientY);
}

function goToSegmentLocation(docId, startIndex) {
    // Clear filter and navigate to document
    appData.filterCodeId = null;
    selectDocument(docId);
    
    // After render, scroll to and highlight the segment location
    setTimeout(() => {
        scrollToCharacterPosition(startIndex);
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
