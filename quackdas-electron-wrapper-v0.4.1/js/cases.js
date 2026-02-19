/**
 * Quackdas - Case Management
 * Case CRUD, hierarchy, attributes, and document linking
 */

let pendingCaseCreateContext = null;
let caseAddDocumentsTargetId = null;
let documentAssignCasesTargetId = null;
let draggedCaseId = null;

const documentCasePickerState = {
    open: false,
    query: ''
};

const caseViewUiState = {
    notesExpanded: false,
    editingDescription: false
};

function getCaseById(caseId) {
    return appData.cases.find((caseItem) => caseItem.id === caseId) || null;
}

function getCaseLinkedDocumentCount(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return 0;
    const linked = Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds : [];
    return linked.length;
}

function sortCasesByAppOrder(items) {
    return items.slice().sort((a, b) => {
        const aOrder = typeof a.sortOrder === 'number' ? a.sortOrder : Infinity;
        const bOrder = typeof b.sortOrder === 'number' ? b.sortOrder : Infinity;
        if (aOrder !== bOrder) return aOrder - bOrder;

        const aCreated = new Date(a.created || 0).getTime();
        const bCreated = new Date(b.created || 0).getTime();
        if (aCreated !== bCreated) return aCreated - bCreated;

        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
    });
}

function getOrderedCasesForParent(parentId) {
    return sortCasesByAppOrder(appData.cases.filter((caseItem) => (caseItem.parentId || null) === (parentId || null)));
}

function reindexCaseSortOrderForParent(parentId) {
    const siblings = getOrderedCasesForParent(parentId);
    siblings.forEach((caseItem, idx) => {
        caseItem.sortOrder = idx;
    });
}

function renderCases() {
    const list = document.getElementById('casesList');
    const parentSelect = document.getElementById('caseParent');
    if (!list) return;

    if (!Array.isArray(appData.cases) || appData.cases.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding: 20px;"><p style="font-size: 13px;">No cases yet</p></div>';
        if (parentSelect) {
            parentSelect.innerHTML = '<option value="">None (Top-level case)</option>';
        }
        return;
    }

    if (parentSelect) {
        parentSelect.innerHTML = '<option value="">None (Top-level case)</option>' +
            sortCasesByAppOrder(appData.cases).map((caseItem) =>
                `<option value="${escapeHtmlAttrValue(caseItem.id)}">${escapeHtml(caseItem.name)}</option>`
            ).join('');
    }

    const topLevelCases = sortCasesByAppOrder(appData.cases.filter((caseItem) => !caseItem.parentId));
    list.innerHTML = topLevelCases.map((caseItem) => renderCaseTreeItem(caseItem, 0, new Set())).join('');
    setupCaseDragAndDrop();
}

function renderCaseTreeItem(caseItem, depth, visited) {
    if (!caseItem || visited.has(caseItem.id) || depth > 20) return '';
    visited.add(caseItem.id);

    const safeCaseIdJs = escapeJsForSingleQuotedString(caseItem.id);
    const safeCaseIdAttr = escapeHtmlAttrValue(caseItem.id);
    const isSelected = appData.selectedCaseId === caseItem.id;
    const count = getCaseLinkedDocumentCount(caseItem.id);
    const children = sortCasesByAppOrder(appData.cases.filter((child) => child.parentId === caseItem.id));
    const hasChildren = children.length > 0;
    const expanded = caseItem.expanded !== false;

    const typeLine = String(caseItem.type || '').trim();
    const roleLine = String(caseItem.attributes?.Role || caseItem.attributes?.role || '').trim();
    const secondary = typeLine || roleLine;

    let html = `
        <div class="code-item case-item draggable-case ${isSelected ? 'selected' : ''} ${depth > 0 ? 'child' : ''}" style="margin-left:${depth * 12}px;" onclick="selectCase('${safeCaseIdJs}', event)" oncontextmenu="openCaseContextMenu('${safeCaseIdJs}', event)" draggable="true" data-case-id="${safeCaseIdAttr}">
            ${hasChildren ? `<button class="case-expand-btn" onclick="toggleCaseExpanded('${safeCaseIdJs}', event)" title="${expanded ? 'Collapse' : 'Expand'}">${expanded ? '▼' : '▶'}</button>` : '<span class="case-expand-spacer"></span>'}
            <div class="code-color case-color"></div>
            <div class="case-row-main">
                <div class="code-name">${escapeHtml(caseItem.name)}</div>
                ${secondary ? `<div class="case-row-secondary">${escapeHtml(secondary)}</div>` : ''}
            </div>
            <div class="code-count">${count}</div>
            <div class="code-actions">
                <button class="code-action-btn" onclick="deleteCase('${safeCaseIdJs}', event)" title="Delete">×</button>
            </div>
        </div>
    `;

    if (hasChildren && expanded) {
        html += children.map((child) => renderCaseTreeItem(child, depth + 1, new Set(visited))).join('');
    }

    return html;
}

function openCaseModal(context = null) {
    pendingCaseCreateContext = context && typeof context === 'object' ? context : null;

    const modal = document.getElementById('caseModal');
    const nameInput = document.getElementById('caseName');
    const typeInput = document.getElementById('caseType');
    const parentSelect = document.getElementById('caseParent');

    renderCases();

    if (nameInput) nameInput.value = String(pendingCaseCreateContext?.name || '').trim();
    if (typeInput) typeInput.value = String(pendingCaseCreateContext?.type || '').trim();
    if (parentSelect) parentSelect.value = String(pendingCaseCreateContext?.parentId || '');

    if (modal) modal.classList.add('show');
    setTimeout(() => {
        if (nameInput) {
            nameInput.focus();
            nameInput.select();
        }
    }, 0);
}

function closeCaseModal() {
    const modal = document.getElementById('caseModal');
    if (modal) modal.classList.remove('show');
    const nameInput = document.getElementById('caseName');
    const typeInput = document.getElementById('caseType');
    const parentSelect = document.getElementById('caseParent');
    if (nameInput) nameInput.value = '';
    if (typeInput) typeInput.value = '';
    if (parentSelect) parentSelect.value = '';
    pendingCaseCreateContext = null;
}

function saveCase(event) {
    if (event) event.preventDefault();

    const name = String(document.getElementById('caseName')?.value || '').trim();
    const type = String(document.getElementById('caseType')?.value || '').trim();
    const parentIdRaw = String(document.getElementById('caseParent')?.value || '').trim();
    const parentId = parentIdRaw || null;

    if (!name) {
        alert('Case name is required.');
        return;
    }

    if (parentId && !getCaseById(parentId)) {
        alert('Selected parent case no longer exists.');
        return;
    }

    saveHistory();

    const caseId = 'case_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    const caseItem = {
        id: caseId,
        name,
        type: type || '',
        parentId,
        description: '',
        notes: '',
        attributes: {},
        linkedDocumentIds: [],
        created: now,
        modified: now,
        expanded: true
    };

    appData.cases.push(caseItem);

    const linkDocId = pendingCaseCreateContext?.linkDocId;
    if (linkDocId && appData.documents.some((doc) => doc.id === linkDocId)) {
        linkDocumentToCaseInternal(linkDocId, caseId);
    }

    appData.selectedCaseId = caseId;
    appData.filterCodeId = null;
    appData.selectedText = null;

    saveData();
    closeCaseModal();
    renderAll();
}

function selectCase(caseId, event) {
    if (event) event.stopPropagation();
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    appData.selectedCaseId = caseId;
    appData.filterCodeId = null;
    appData.selectedText = null;
    caseViewUiState.editingDescription = false;
    renderAll();
}

function clearSelectedCase() {
    appData.selectedCaseId = null;
}

function toggleCaseExpanded(caseId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;
    caseItem.expanded = caseItem.expanded === false;
    saveData();
    renderCases();
}

function openCaseContextMenu(caseId, event) {
    event.preventDefault();
    event.stopPropagation();

    const caseItem = getCaseById(caseId);
    if (!caseItem || typeof showContextMenu !== 'function') return;

    showContextMenu([
        { label: `Rename case: ${caseItem.name}`, onClick: () => renameCase(caseId) },
        { label: 'Open case view', onClick: () => selectCase(caseId) },
        { label: 'Move case to top level', onClick: () => moveCaseToParent(caseId, null) },
        { type: 'sep' },
        { label: `Delete case: ${caseItem.name}`, onClick: () => deleteCase(caseId), danger: true }
    ], event.clientX, event.clientY);
}

async function renameCase(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem || typeof openTextPrompt !== 'function') return;

    const newName = await openTextPrompt('Rename Case', caseItem.name || '');
    const trimmed = String(newName || '').trim();
    if (!trimmed || trimmed === caseItem.name) return;

    saveHistory();
    caseItem.name = trimmed;
    caseItem.modified = new Date().toISOString();
    saveData();
    renderAll();
}

function getCaseDescendantIds(caseId, visited = new Set()) {
    if (!caseId || visited.has(caseId)) return [];
    visited.add(caseId);

    const descendants = [];
    appData.cases.forEach((caseItem) => {
        if (!caseItem || caseItem.parentId !== caseId) return;
        descendants.push(caseItem.id);
        descendants.push(...getCaseDescendantIds(caseItem.id, visited));
    });

    return descendants;
}

function deleteCase(caseId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    const choice = window.prompt(
        `Delete case "${caseItem.name}"\n\n` +
        'Type 1 = delete case only (children move up)\n' +
        'Type 2 = delete case + descendants\n\n' +
        'Enter 1 or 2:'
    );

    if (choice === null) return;
    const normalizedChoice = String(choice).trim();
    if (normalizedChoice !== '1' && normalizedChoice !== '2') {
        alert('Delete cancelled: please enter 1 or 2.');
        return;
    }

    saveHistory();

    const deleteOnly = normalizedChoice === '1';
    const descendants = getCaseDescendantIds(caseId);
    const deleteIds = new Set(deleteOnly ? [caseId] : [caseId, ...descendants]);

    if (deleteOnly) {
        appData.cases.forEach((candidate) => {
            if (!candidate || candidate.parentId !== caseId) return;
            candidate.parentId = caseItem.parentId || null;
            candidate.modified = new Date().toISOString();
        });
    }

    appData.cases = appData.cases.filter((candidate) => !deleteIds.has(candidate.id));

    appData.documents.forEach((doc) => {
        if (!doc || !Array.isArray(doc.caseIds)) {
            if (doc) doc.caseIds = [];
            return;
        }
        doc.caseIds = doc.caseIds.filter((linkedCaseId) => !deleteIds.has(linkedCaseId));
    });

    if (appData.selectedCaseId && deleteIds.has(appData.selectedCaseId)) {
        appData.selectedCaseId = null;
    }

    saveData();
    renderAll();
}

function wouldCreateCaseCycle(caseId, nextParentId) {
    if (!nextParentId || !caseId) return false;
    if (caseId === nextParentId) return true;

    const visited = new Set([caseId]);
    let cursor = nextParentId;

    while (cursor) {
        if (visited.has(cursor)) return true;
        visited.add(cursor);

        const parentCase = getCaseById(cursor);
        if (!parentCase) return false;
        cursor = parentCase.parentId || null;
    }

    return false;
}

function moveCaseToParent(caseId, nextParentId, options = {}) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    const normalizedParentId = nextParentId || null;
    const targetCaseId = options.targetCaseId || null;
    const placeAfter = !!options.placeAfter;
    if (normalizedParentId && !getCaseById(normalizedParentId)) {
        alert('Target parent case does not exist.');
        return;
    }

    if (wouldCreateCaseCycle(caseId, normalizedParentId)) {
        alert('That move would create a case hierarchy cycle.');
        return;
    }

    const previousParentId = caseItem.parentId || null;
    const needsParentChange = previousParentId !== normalizedParentId;
    const needsSiblingReorder = !!targetCaseId && !needsParentChange;
    if (!needsParentChange && !needsSiblingReorder) return;

    saveHistory();
    caseItem.parentId = normalizedParentId;
    caseItem.modified = new Date().toISOString();

    const siblings = getOrderedCasesForParent(normalizedParentId).filter((candidate) => candidate.id !== caseId);
    if (targetCaseId) {
        const targetIndex = siblings.findIndex((candidate) => candidate.id === targetCaseId);
        if (targetIndex >= 0) {
            const insertIndex = placeAfter ? targetIndex + 1 : targetIndex;
            siblings.splice(insertIndex, 0, caseItem);
        } else {
            siblings.push(caseItem);
        }
    } else {
        siblings.push(caseItem);
    }
    siblings.forEach((candidate, idx) => {
        candidate.sortOrder = idx;
    });
    if (previousParentId !== normalizedParentId) {
        reindexCaseSortOrderForParent(previousParentId);
    }

    saveData();
    renderAll();
}

function setupCaseDragAndDrop() {
    const list = document.getElementById('casesList');
    if (!list) return;
    const items = list.querySelectorAll('.draggable-case[data-case-id]');
    items.forEach((item) => {
        item.addEventListener('dragstart', handleCaseDragStart);
        item.addEventListener('dragend', handleCaseDragEnd);
        item.addEventListener('dragover', handleCaseDragOver);
        item.addEventListener('dragleave', handleCaseDragLeave);
        item.addEventListener('drop', handleCaseDrop);
    });

    // Dropping directly on list background moves to root level.
    list.ondragover = handleCasesListDragOver;
    list.ondrop = handleCasesListDrop;
}

function getCaseDropIntent(event, targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const ratio = rect.height > 0 ? (y / rect.height) : 0.5;
    if (ratio < 0.2) return 'sibling-before';
    if (ratio > 0.8) return 'sibling-after';
    return 'child';
}

function handleCaseDragStart(event) {
    draggedCaseId = event.currentTarget.dataset.caseId;
    event.currentTarget.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-quackdas-case-id', draggedCaseId);
}

function handleCaseDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    draggedCaseId = null;
}

function handleCaseDragOver(event) {
    event.preventDefault();
    const targetCaseId = event.currentTarget.dataset.caseId;
    if (targetCaseId === draggedCaseId) return;
    const intent = getCaseDropIntent(event, event.currentTarget);
    event.currentTarget.classList.toggle('drag-over', intent !== 'child');
    event.currentTarget.classList.toggle('drag-over-child', intent === 'child');
    event.dataTransfer.dropEffect = 'move';
}

function handleCaseDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
    event.currentTarget.classList.remove('drag-over-child');
}

function handleCaseDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');
    event.currentTarget.classList.remove('drag-over-child');

    const targetCaseId = event.currentTarget.dataset.caseId;
    const sourceCaseId = draggedCaseId || event.dataTransfer.getData('application/x-quackdas-case-id');

    if (!sourceCaseId || !targetCaseId || sourceCaseId === targetCaseId) return;
    const targetCase = getCaseById(targetCaseId);
    if (!targetCase) return;

    const intent = getCaseDropIntent(event, event.currentTarget);
    if (intent === 'child') {
        moveCaseToParent(sourceCaseId, targetCaseId);
        return;
    }

    const nextParentId = targetCase.parentId || null;
    moveCaseToParent(sourceCaseId, nextParentId, {
        targetCaseId,
        placeAfter: intent === 'sibling-after'
    });
}

function handleCasesListDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
}

function handleCasesListDrop(event) {
    if (!draggedCaseId) return;
    if (event.target && event.target.closest && event.target.closest('.draggable-case[data-case-id]')) return;
    event.preventDefault();
    moveCaseToParent(draggedCaseId, null);
}

function renderCaseSheet(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    const content = document.getElementById('documentContent');
    if (!content) return;

    const linkedDocIds = Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds : [];
    const linkedDocs = linkedDocIds
        .map((docId) => appData.documents.find((doc) => doc.id === docId))
        .filter(Boolean)
        .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));

    const attrEntries = Object.entries(caseItem.attributes || {});
    const parentCase = caseItem.parentId ? getCaseById(caseItem.parentId) : null;
    const linkedCount = linkedDocs.length;
    const hasDescription = !!String(caseItem.description || '').trim();
    const hasNotes = !!String(caseItem.notes || '').trim();
    const descriptionText = hasDescription
        ? (typeof preserveLineBreaks === 'function' ? preserveLineBreaks(escapeHtml(caseItem.description)) : escapeHtml(caseItem.description))
        : 'No description yet.';
    const notesText = hasNotes
        ? (typeof preserveLineBreaks === 'function' ? preserveLineBreaks(escapeHtml(caseItem.notes)) : escapeHtml(caseItem.notes))
        : 'No notes yet.';

    content.innerHTML = `
        <div class="case-sheet code-view-content case-view-content">
            <div class="code-view-banner code-view-banner-main case-view-banner-main">
                <span class="filter-title"><strong>Case: ${escapeHtml(caseItem.name)}</strong></span>
                <span class="filter-meta">Parent: ${parentCase ? escapeHtml(parentCase.name) : 'Top-level'}</span>
                <span class="filter-meta">Type: ${escapeHtml(caseItem.type || 'Not set')}</span>
                <span class="filter-meta">${linkedCount} linked document${linkedCount !== 1 ? 's' : ''}</span>
            </div>
            <div class="filter-code-description ${hasDescription ? '' : 'empty'}">
                ${caseViewUiState.editingDescription ? `
                    <div class="form-group">
                        <label class="form-label" for="caseDescriptionEditInput">Description</label>
                        <input id="caseDescriptionEditInput" class="form-input" type="text" value="${escapeHtmlAttrValue(caseItem.description || '')}" placeholder="Add a short description...">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="caseNotesEditInput">Notes</label>
                        <textarea id="caseNotesEditInput" class="form-textarea" rows="8" placeholder="Add notes...">${escapeHtml(caseItem.notes || '')}</textarea>
                    </div>
                    <div class="filter-code-description-actions">
                        <button class="filter-description-btn" onclick="saveCaseDescriptionAndNotes('${escapeJsForSingleQuotedString(caseItem.id)}')">Save</button>
                        <button class="filter-description-btn" onclick="cancelCaseDescriptionEdit()">Cancel</button>
                    </div>
                ` : `
                    <div class="filter-code-description-main">
                        <span class="filter-code-description-label"><strong>Description and notes:</strong></span>
                        <span class="filter-code-description-text">${descriptionText}</span>
                    </div>
                    <div class="filter-code-description-actions">
                        <span class="filter-shortcut" onclick="toggleCaseViewNotes()">${caseViewUiState.notesExpanded ? 'Hide notes' : 'Show notes'}</span>
                        <button class="filter-description-btn" onclick="startCaseDescriptionEdit()">Add description and notes</button>
                    </div>
                    ${caseViewUiState.notesExpanded ? `<div class="filter-code-notes-block">${notesText}</div>` : ''}
                `}
            </div>
            <div class="case-sheet-section case-view-card">
                <div class="case-sheet-section-title">Case type</div>
                <div class="case-sheet-grid">
                    <div class="case-sheet-inline-row case-type-row">
                        <input id="caseSheetTypeInput" class="form-input" type="text" placeholder="Person, Organisation, Site, Event" value="${escapeHtmlAttrValue(caseItem.type || '')}">
                        <button class="doc-action-btn" onclick="saveCaseTypeFromSheet('${escapeJsForSingleQuotedString(caseItem.id)}')">Save</button>
                    </div>
                </div>
            </div>

            <div class="case-sheet-section case-view-card">
                <div class="case-sheet-section-title">Attributes</div>
                <div class="case-attributes-table-wrap">
                    <table class="case-attributes-table" id="caseAttributesTable">
                        <thead>
                            <tr>
                                <th>Key</th>
                                <th>Value</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attrEntries.length === 0 ? '<tr><td colspan="3" class="case-attr-empty">No attributes yet.</td></tr>' : attrEntries.map(([key, value], index) => `
                                <tr class="case-attr-row" data-attr-row="${index}" data-original-key="${escapeHtmlAttrValue(key)}">
                                    <td><input class="form-input case-attr-key" type="text" value="${escapeHtmlAttrValue(key)}"></td>
                                    <td><input class="form-input case-attr-value" type="text" value="${escapeHtmlAttrValue(String(value == null ? '' : value))}"></td>
                                    <td class="case-attr-actions">
                                        <button class="doc-action-btn" onclick="saveCaseAttributeRow('${escapeJsForSingleQuotedString(caseItem.id)}', ${index})">Save</button>
                                        <button class="doc-action-btn" onclick="deleteCaseAttributeRow('${escapeJsForSingleQuotedString(caseItem.id)}', ${index})">Delete</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="case-sheet-inline-row case-attr-add-row">
                    <input id="newCaseAttrKey" class="form-input" type="text" placeholder="Key">
                    <input id="newCaseAttrValue" class="form-input" type="text" placeholder="Value">
                    <button class="doc-action-btn" onclick="addCaseAttributeFromSheet('${escapeJsForSingleQuotedString(caseItem.id)}')">Add Attribute</button>
                </div>
            </div>

            <div class="case-sheet-section case-view-card">
                <div class="case-sheet-section-title">Linked documents</div>
                <div class="case-sheet-actions-row">
                    <button class="doc-action-btn" onclick="linkCurrentDocumentToSelectedCase()" ${appData.currentDocId ? '' : 'disabled'}>Link current document to this case</button>
                    <button class="doc-action-btn" onclick="openCaseAddDocumentsModal('${escapeJsForSingleQuotedString(caseItem.id)}')">Add documents...</button>
                </div>
                <div class="case-linked-docs-list">
                    ${linkedDocs.length === 0 ? '<div class="empty-state-hint case-linked-docs-empty">No linked documents yet.</div>' : linkedDocs.map((doc) => `
                        <div class="case-linked-doc-row">
                            <button class="case-linked-doc-open" onclick="openLinkedCaseDocument('${escapeJsForSingleQuotedString(doc.id)}')">${escapeHtml(doc.title)}</button>
                            <button class="doc-action-btn" onclick="unlinkDocumentFromCaseFromSheet('${escapeJsForSingleQuotedString(caseItem.id)}', '${escapeJsForSingleQuotedString(doc.id)}')">Unlink</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function saveCaseTypeFromSheet(caseId) {
    const caseItem = getCaseById(caseId);
    const typeInput = document.getElementById('caseSheetTypeInput');
    if (!caseItem || !typeInput) return;

    const newType = String(typeInput.value || '').trim();
    if (newType === String(caseItem.type || '')) return;

    saveHistory();
    caseItem.type = newType;
    caseItem.modified = new Date().toISOString();
    saveData();
    renderAll();
}

function toggleCaseViewNotes() {
    caseViewUiState.notesExpanded = !caseViewUiState.notesExpanded;
    if (appData.selectedCaseId) renderCaseSheet(appData.selectedCaseId);
}

function startCaseDescriptionEdit() {
    caseViewUiState.editingDescription = true;
    if (appData.selectedCaseId) renderCaseSheet(appData.selectedCaseId);
}

function cancelCaseDescriptionEdit() {
    caseViewUiState.editingDescription = false;
    if (appData.selectedCaseId) renderCaseSheet(appData.selectedCaseId);
}

function saveCaseDescriptionAndNotes(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    const descriptionInput = document.getElementById('caseDescriptionEditInput');
    const notesInput = document.getElementById('caseNotesEditInput');
    if (!descriptionInput || !notesInput) return;

    const nextDescription = String(descriptionInput.value || '').trim();
    const nextNotes = String(notesInput.value || '');
    if (nextDescription === String(caseItem.description || '') && nextNotes === String(caseItem.notes || '')) {
        caseViewUiState.editingDescription = false;
        renderCaseSheet(caseId);
        return;
    }

    saveHistory();
    caseItem.description = nextDescription;
    caseItem.notes = nextNotes;
    caseItem.modified = new Date().toISOString();
    caseViewUiState.editingDescription = false;
    saveData();
    renderAll();
}

function addCaseAttributeFromSheet(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    const keyInput = document.getElementById('newCaseAttrKey');
    const valueInput = document.getElementById('newCaseAttrValue');
    if (!keyInput || !valueInput) return;

    const key = String(keyInput.value || '').trim();
    const value = String(valueInput.value || '').trim();
    if (!key) {
        alert('Attribute key is required.');
        return;
    }

    saveHistory();
    if (!caseItem.attributes || typeof caseItem.attributes !== 'object') caseItem.attributes = {};

    if (Object.prototype.hasOwnProperty.call(caseItem.attributes, key)) {
        const mergeOk = confirm(`Attribute "${key}" already exists. Replace its value?`);
        if (!mergeOk) return;
    }

    caseItem.attributes[key] = value;
    caseItem.modified = new Date().toISOString();

    keyInput.value = '';
    valueInput.value = '';

    saveData();
    renderAll();
}

function saveCaseAttributeRow(caseId, rowIndex) {
    const caseItem = getCaseById(caseId);
    const table = document.getElementById('caseAttributesTable');
    if (!caseItem || !table) return;

    const row = table.querySelector(`tr[data-attr-row="${rowIndex}"]`);
    if (!row) return;

    const oldKey = String(row.getAttribute('data-original-key') || '').trim();
    const keyInput = row.querySelector('.case-attr-key');
    const valueInput = row.querySelector('.case-attr-value');
    if (!keyInput || !valueInput) return;

    const newKey = String(keyInput.value || '').trim();
    const newValue = String(valueInput.value || '').trim();

    if (!newKey) {
        alert('Attribute key cannot be empty.');
        return;
    }

    saveHistory();
    if (!caseItem.attributes || typeof caseItem.attributes !== 'object') caseItem.attributes = {};

    if (newKey !== oldKey && Object.prototype.hasOwnProperty.call(caseItem.attributes, newKey)) {
        const mergeOk = confirm(`Attribute "${newKey}" already exists. Merge into existing key?`);
        if (!mergeOk) return;
    }

    if (oldKey && Object.prototype.hasOwnProperty.call(caseItem.attributes, oldKey)) {
        delete caseItem.attributes[oldKey];
    }
    caseItem.attributes[newKey] = newValue;
    caseItem.modified = new Date().toISOString();

    saveData();
    renderAll();
}

function deleteCaseAttributeRow(caseId, rowIndex) {
    const caseItem = getCaseById(caseId);
    const table = document.getElementById('caseAttributesTable');
    if (!caseItem || !table) return;

    const row = table.querySelector(`tr[data-attr-row="${rowIndex}"]`);
    if (!row) return;

    const key = String(row.getAttribute('data-original-key') || '').trim();
    if (!key) return;

    saveHistory();
    if (caseItem.attributes && Object.prototype.hasOwnProperty.call(caseItem.attributes, key)) {
        delete caseItem.attributes[key];
        caseItem.modified = new Date().toISOString();
    }

    saveData();
    renderAll();
}

function buildDocCaseMapFromCases() {
    const docCaseMap = new Map();
    appData.documents.forEach((doc) => {
        docCaseMap.set(doc.id, []);
    });

    appData.cases.forEach((caseItem) => {
        const linked = Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds : [];
        linked.forEach((docId) => {
            if (!docCaseMap.has(docId)) return;
            const list = docCaseMap.get(docId);
            if (!list.includes(caseItem.id)) list.push(caseItem.id);
        });
    });

    return docCaseMap;
}

function syncDocumentCaseIdsFromCases() {
    const docCaseMap = buildDocCaseMapFromCases();
    appData.documents.forEach((doc) => {
        const caseIds = docCaseMap.get(doc.id) || [];
        doc.caseIds = caseIds;
    });
}

function linkDocumentToCaseInternal(docId, caseId) {
    const doc = appData.documents.find((candidate) => candidate.id === docId);
    const caseItem = getCaseById(caseId);
    if (!doc || !caseItem) return false;

    if (!Array.isArray(caseItem.linkedDocumentIds)) caseItem.linkedDocumentIds = [];
    if (!Array.isArray(doc.caseIds)) doc.caseIds = [];

    let changed = false;
    if (!caseItem.linkedDocumentIds.includes(docId)) {
        caseItem.linkedDocumentIds.push(docId);
        changed = true;
    }
    if (!doc.caseIds.includes(caseId)) {
        doc.caseIds.push(caseId);
        changed = true;
    }

    if (changed) caseItem.modified = new Date().toISOString();
    return changed;
}

function unlinkDocumentFromCaseInternal(docId, caseId) {
    const doc = appData.documents.find((candidate) => candidate.id === docId);
    const caseItem = getCaseById(caseId);
    if (!doc || !caseItem) return false;

    if (!Array.isArray(caseItem.linkedDocumentIds)) caseItem.linkedDocumentIds = [];
    if (!Array.isArray(doc.caseIds)) doc.caseIds = [];

    const beforeCase = caseItem.linkedDocumentIds.length;
    const beforeDoc = doc.caseIds.length;

    caseItem.linkedDocumentIds = caseItem.linkedDocumentIds.filter((linkedDocId) => linkedDocId !== docId);
    doc.caseIds = doc.caseIds.filter((linkedCaseId) => linkedCaseId !== caseId);

    const changed = beforeCase !== caseItem.linkedDocumentIds.length || beforeDoc !== doc.caseIds.length;
    if (changed) caseItem.modified = new Date().toISOString();
    return changed;
}

function linkDocumentToCase(docId, caseId) {
    saveHistory();
    const changed = linkDocumentToCaseInternal(docId, caseId);
    if (!changed) return;
    saveData();
    renderAll();
}

function unlinkDocumentFromCase(docId, caseId) {
    saveHistory();
    const changed = unlinkDocumentFromCaseInternal(docId, caseId);
    if (!changed) return;
    saveData();
    renderAll();
}

function unlinkDocumentFromCaseFromSheet(caseId, docId) {
    unlinkDocumentFromCase(docId, caseId);
}

function linkCurrentDocumentToSelectedCase() {
    if (!appData.selectedCaseId || !appData.currentDocId) return;
    linkDocumentToCase(appData.currentDocId, appData.selectedCaseId);
}

function openLinkedCaseDocument(docId) {
    if (!docId || typeof selectDocument !== 'function') return;
    selectDocument(docId);
}

function openCaseAddDocumentsModal(caseId) {
    const caseItem = getCaseById(caseId);
    if (!caseItem) return;

    caseAddDocumentsTargetId = caseId;
    const modal = document.getElementById('caseAddDocumentsModal');
    const list = document.getElementById('caseAddDocumentsList');
    if (!modal || !list) return;

    const linked = new Set(Array.isArray(caseItem.linkedDocumentIds) ? caseItem.linkedDocumentIds : []);
    const docs = appData.documents.slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' }));

    list.innerHTML = docs.length === 0
        ? '<div class="empty-state-hint">No documents available.</div>'
        : docs.map((doc) => `
            <label class="case-doc-picker-item">
                <input type="checkbox" value="${escapeHtmlAttrValue(doc.id)}" ${linked.has(doc.id) ? 'checked' : ''}>
                <span>${escapeHtml(doc.title)}</span>
            </label>
        `).join('');

    modal.classList.add('show');
}

function closeCaseAddDocumentsModal() {
    const modal = document.getElementById('caseAddDocumentsModal');
    if (modal) modal.classList.remove('show');
    caseAddDocumentsTargetId = null;
}

function openDocumentAssignCasesModal(docId) {
    const doc = appData.documents.find((candidate) => candidate.id === docId);
    if (!doc) return;

    documentAssignCasesTargetId = docId;
    const modal = document.getElementById('documentAssignCasesModal');
    const list = document.getElementById('documentAssignCasesList');
    if (!modal || !list) return;

    const linkedCaseIds = new Set(Array.isArray(doc.caseIds) ? doc.caseIds : []);
    const sortedCases = sortCasesByAppOrder(appData.cases);
    list.innerHTML = sortedCases.length === 0
        ? '<div class="empty-state-hint">No cases available yet.</div>'
        : sortedCases.map((caseItem) => `
            <label class="case-doc-picker-item">
                <input type="checkbox" value="${escapeHtmlAttrValue(caseItem.id)}" ${linkedCaseIds.has(caseItem.id) ? 'checked' : ''}>
                <span>${escapeHtml(caseItem.name)}</span>
            </label>
        `).join('');

    modal.classList.add('show');
}

function closeDocumentAssignCasesModal() {
    const modal = document.getElementById('documentAssignCasesModal');
    if (modal) modal.classList.remove('show');
    documentAssignCasesTargetId = null;
}

function saveDocumentAssignCases(event) {
    if (event) event.preventDefault();
    const docId = documentAssignCasesTargetId;
    if (!docId) return;
    const doc = appData.documents.find((candidate) => candidate.id === docId);
    if (!doc) {
        closeDocumentAssignCasesModal();
        return;
    }

    const list = document.getElementById('documentAssignCasesList');
    if (!list) return;

    const selectedCaseIds = Array.from(list.querySelectorAll('input[type="checkbox"]:checked'))
        .map((input) => String(input.value || '').trim())
        .filter(Boolean);
    const validCaseIds = new Set(appData.cases.map((caseItem) => caseItem.id));
    const normalized = Array.from(new Set(selectedCaseIds.filter((caseId) => validCaseIds.has(caseId))));

    saveHistory();
    appData.cases.forEach((caseItem) => {
        if (!caseItem) return;
        if (!Array.isArray(caseItem.linkedDocumentIds)) caseItem.linkedDocumentIds = [];
        const shouldLink = normalized.includes(caseItem.id);
        const currentlyLinked = caseItem.linkedDocumentIds.includes(docId);
        if (shouldLink && !currentlyLinked) caseItem.linkedDocumentIds.push(docId);
        if (!shouldLink && currentlyLinked) {
            caseItem.linkedDocumentIds = caseItem.linkedDocumentIds.filter((linkedDocId) => linkedDocId !== docId);
        }
        caseItem.modified = new Date().toISOString();
    });

    syncDocumentCaseIdsFromCases();
    saveData();
    closeDocumentAssignCasesModal();
    renderAll();
}

function saveCaseAddDocuments(event) {
    if (event) event.preventDefault();
    const caseItem = getCaseById(caseAddDocumentsTargetId);
    if (!caseItem) {
        closeCaseAddDocumentsModal();
        return;
    }

    const list = document.getElementById('caseAddDocumentsList');
    if (!list) return;

    const selectedDocIds = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map((input) => String(input.value || ''));
    const validDocIds = new Set(appData.documents.map((doc) => doc.id));
    const normalized = Array.from(new Set(selectedDocIds.filter((docId) => validDocIds.has(docId))));

    saveHistory();
    caseItem.linkedDocumentIds = normalized;
    caseItem.modified = new Date().toISOString();
    syncDocumentCaseIdsFromCases();

    saveData();
    closeCaseAddDocumentsModal();
    renderAll();
}

function renderDocumentCasesControl() {
    const wrap = document.getElementById('documentCasesControl');
    if (!wrap) return;

    const hasActiveDocView = !!(appData.currentDocId && !appData.filterCodeId && !appData.selectedCaseId);
    if (!hasActiveDocView) {
        wrap.hidden = true;
        wrap.innerHTML = '';
        documentCasePickerState.open = false;
        documentCasePickerState.query = '';
        return;
    }

    const doc = appData.documents.find((candidate) => candidate.id === appData.currentDocId);
    if (!doc) {
        wrap.hidden = true;
        wrap.innerHTML = '';
        return;
    }

    const assignedCases = (Array.isArray(doc.caseIds) ? doc.caseIds : [])
        .map((caseId) => getCaseById(caseId))
        .filter(Boolean)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    wrap.hidden = false;
    wrap.innerHTML = `
        <div class="document-cases-inline">
            <span class="document-cases-label">Cases:</span>
            <div class="document-cases-pills">
                ${assignedCases.length === 0
                    ? '<span class="document-cases-empty">None</span>'
                    : assignedCases.map((caseItem) => `<button class="document-case-pill" onclick="openCaseFromHeaderPill('${escapeJsForSingleQuotedString(caseItem.id)}')">${escapeHtml(caseItem.name)}</button>`).join('')}
            </div>
            <button class="doc-action-btn" onclick="toggleDocumentCasesPicker(event)">+</button>
        </div>
        <div class="document-cases-picker ${documentCasePickerState.open ? 'show' : ''}" id="documentCasesPickerPanel">
            <input id="documentCasesSearchInput" class="form-input document-cases-search" type="text" placeholder="Search cases..." value="${escapeHtmlAttrValue(documentCasePickerState.query)}" oninput="updateDocumentCasesPickerQuery(this.value)">
            <div class="document-cases-picker-list" id="documentCasesPickerList"></div>
            <button class="document-cases-create-btn" onclick="createCaseFromDocumentPicker()">Create new case...</button>
        </div>
    `;

    if (documentCasePickerState.open) {
        renderDocumentCasesPickerList();
    }
}

function openCaseFromHeaderPill(caseId) {
    selectCase(caseId);
}

function toggleDocumentCasesPicker(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    documentCasePickerState.open = !documentCasePickerState.open;
    renderDocumentCasesControl();
    if (documentCasePickerState.open) {
        setTimeout(() => {
            const input = document.getElementById('documentCasesSearchInput');
            if (input) input.focus();
        }, 0);
    }
}

function closeDocumentCasesPicker() {
    if (!documentCasePickerState.open) return;
    documentCasePickerState.open = false;
    documentCasePickerState.query = '';
    renderDocumentCasesControl();
}

function updateDocumentCasesPickerQuery(value) {
    documentCasePickerState.query = String(value || '');
    renderDocumentCasesPickerList();
}

function renderDocumentCasesPickerList() {
    const list = document.getElementById('documentCasesPickerList');
    if (!list) return;
    const doc = appData.documents.find((candidate) => candidate.id === appData.currentDocId);
    if (!doc) {
        list.innerHTML = '<div class="empty-state-hint">No active document.</div>';
        return;
    }

    const query = String(documentCasePickerState.query || '').trim().toLowerCase();
    const assigned = new Set(Array.isArray(doc.caseIds) ? doc.caseIds : []);

    const cases = sortCasesByAppOrder(appData.cases)
        .filter((caseItem) => {
            if (!query) return true;
            return String(caseItem.name || '').toLowerCase().includes(query) || String(caseItem.type || '').toLowerCase().includes(query);
        });

    list.innerHTML = cases.length === 0
        ? '<div class="empty-state-hint">No matching cases.</div>'
        : cases.map((caseItem) => `
            <label class="document-cases-picker-item">
                <input type="checkbox" ${assigned.has(caseItem.id) ? 'checked' : ''} onchange="toggleCaseLinkFromDocumentPicker('${escapeJsForSingleQuotedString(caseItem.id)}', this.checked)">
                <span>${escapeHtml(caseItem.name)}</span>
            </label>
        `).join('');
}

function toggleCaseLinkFromDocumentPicker(caseId, shouldLink) {
    const docId = appData.currentDocId;
    if (!docId) return;

    saveHistory();
    const changed = shouldLink
        ? linkDocumentToCaseInternal(docId, caseId)
        : unlinkDocumentFromCaseInternal(docId, caseId);

    if (!changed) return;

    saveData();
    renderAll();
    documentCasePickerState.open = true;
}

function createCaseFromDocumentPicker() {
    const docId = appData.currentDocId;
    if (!docId) return;

    const queryName = String(documentCasePickerState.query || '').trim();
    openCaseModal({ name: queryName, linkDocId: docId });
}

function caseHierarchySanityCheck() {
    if (!Array.isArray(appData.cases)) return false;
    const caseIds = new Set(appData.cases.map((caseItem) => caseItem.id));

    for (const caseItem of appData.cases) {
        if (!caseItem || !caseItem.id) return false;
        if (caseItem.parentId && !caseIds.has(caseItem.parentId)) return false;
        if (wouldCreateCaseCycle(caseItem.id, caseItem.parentId || null)) return false;
    }

    return true;
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
        if (!documentCasePickerState.open) return;
        const wrap = document.getElementById('documentCasesControl');
        if (!wrap) return;
        if (wrap.contains(event.target)) return;
        closeDocumentCasesPicker();
    });
}
