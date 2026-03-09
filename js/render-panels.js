/**
 * Quackdas - Sidebar Rendering
 * Document and code list rendering separated from the main document/detail renderer.
 */

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

    const renderDocItem = (doc, indent = 0) => {
        const safeDocIdAttr = escapeHtmlAttrValue(doc.id);
        const memoCount = getMemoCountForTarget('document', doc.id);
        const memoIndicator = memoCount > 0 ? `<span class="memo-indicator" title="${memoCount} annotation(s)">💭${memoCount}</span>` : '';
        const titleText = String(doc.title || 'Untitled document');
        const indentStyle = indent > 0 ? `style="margin-left: ${12 + indent * 16}px;"` : '';
        const isPdf = doc.type === 'pdf';
        const isFieldnote = doc.type === 'fieldnote';
        const typeIndicator = isPdf
            ? '<span class="doc-type-badge" title="PDF document">PDF</span>'
            : (isFieldnote ? '<span class="doc-type-badge" title="Online observation document">Online</span>' : '');
        const contentInfo = isPdf
            ? `${doc.pdfPages?.length || '?'} pages`
            : (isFieldnote ? `${doc.fieldnoteData?.sessions?.length || 0} sessions` : `${doc.content.length} chars`);
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
                 data-doc-id="${safeDocIdAttr}">
                <div class="document-item-main-row">
                    <div class="document-item-title-wrap">
                        <div class="document-item-text-block">
                            <div class="document-item-title-line">
                                <span class="document-item-title-text" title="${escapeHtmlAttrValue(titleText)}">${escapeHtml(titleText)}</span>
                                ${memoIndicator}
                            </div>
                            <div class="document-item-meta">${extraMeta}</div>
                        </div>
                    </div>
                    <div class="document-item-side">
                        <div class="document-item-badge-stack">
                            <span class="document-item-code-badge" title="${escapeHtmlAttrValue(`${codeCount} coded segment${codeCount !== 1 ? 's' : ''}`)}">${escapeHtml(codeLabel)}</span>
                            ${typeIndicator}
                        </div>
                    </div>
                </div>
            </div>
        `;
    };

    const renderFolderItem = (folder, indent = 0) => {
        const safeFolderIdAttr = escapeHtmlAttrValue(folder.id);
        const isExpanded = folder.expanded !== false;
        const expandIcon = isExpanded ? '▼' : '▶';
        const indentStyle = indent > 0 ? `padding-left: ${12 + indent * 16}px;` : '';

        return `
            <div class="folder-item" style="${indentStyle}" 
                 data-folder-id="${safeFolderIdAttr}"
                 draggable="true">
                <span class="folder-expand" data-action="toggleFolderExpandedFromList" data-folder-id="${safeFolderIdAttr}">${expandIcon}</span>
                <span class="folder-icon">${folderIconSvg}</span>
                <span class="folder-name">${escapeHtml(folder.name)}</span>
                <button class="folder-settings-btn" data-action="openFolderInfoFromList" data-folder-id="${safeFolderIdAttr}" title="Folder info"><svg class="toolbar-icon" viewBox="0 0 24 24" style="width:12px;height:12px;"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></button>
            </div>
        `;
    };

    const renderFolderTree = (parentId, indent = 0, visited = new Set()) => {
        if (indent > 10 || visited.size > 100) return '';

        let html = '';
        const folders = folderChildrenByParent.get(parentId || ROOT_KEY) || [];
        folders.forEach(folder => {
            if (visited.has(folder.id)) return;
            visited.add(folder.id);

            html += renderFolderItem(folder, indent);

            if (folder.expanded !== false) {
                html += renderFolderTree(folder.id, indent + 1, visited);
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

    let allHtml = '';
    allHtml += renderFolderTree(null, 0);

    const rootDocs = docsByFolder.get(ROOT_KEY) || [];
    if (appData.folders.length > 0 && rootDocs.length > 0) {
        allHtml += `
            <div class="root-doc-separator" data-folder-drop-zone=""></div>
        `;
    }
    rootDocs.forEach(doc => {
        allHtml += renderDocItem(doc, 0);
    });

    allHtml += `
        <div class="root-drop-zone" data-folder-drop-zone="">
            Drop here to move to root
        </div>
    `;

    allList.innerHTML = allHtml;
    updateCompactDocumentTitleLineClasses(allList);

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
    const fixedPx = 246;
    recentList.style.height = `${fixedPx}px`;
    recentList.style.maxHeight = `${fixedPx}px`;
}

function renderCodes() {
    const list = document.getElementById('codesList');
    const parentSelect = document.getElementById('parentCode');
    
    if (appData.codes.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 40px 20px;"><p style="font-size: 13px;">No codes yet</p></div>';
        return;
    }

    parentSelect.innerHTML = '<option value="">None (Top-level code)</option>' + 
        appData.codes.filter(c => !c.parentId).map(c => 
            `<option value="${escapeHtmlAttrValue(c.id)}">${escapeHtml(c.name)}</option>`
        ).join('');

    const topLevelCodes = appData.codes
        .filter(c => !c.parentId)
        .sort((a, b) => {
            const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
            const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
            if (aOrder !== bOrder) return aOrder - bOrder;
            return new Date(a.created || 0) - new Date(b.created || 0);
        });
    
    list.innerHTML = topLevelCodes.map((code, index) => renderCodeItem(code, false, index)).join('');
    setupCodeDragAndDrop();
}
