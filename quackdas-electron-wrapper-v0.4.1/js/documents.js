/**
 * Quackdas - Document Management
 * Document CRUD, import/export, metadata, folder management
 */

// Electron-native document picker support
let electronPickedDocument = null;

// Folder management
const MAX_FOLDER_DEPTH = 5;
const MAX_ITERATIONS = 100; // Safety limit to prevent infinite loops

function getFolderDepth(folderId) {
    let depth = 0;
    let currentId = folderId;
    const visited = new Set();
    
    while (currentId && depth < MAX_ITERATIONS) {
        if (visited.has(currentId)) break; // Cycle detection
        visited.add(currentId);
        
        const folder = appData.folders.find(f => f.id === currentId);
        if (!folder) break;
        depth++;
        currentId = folder.parentId;
    }
    return depth;
}

function canCreateSubfolder(parentId) {
    if (!parentId) return true;
    return getFolderDepth(parentId) < MAX_FOLDER_DEPTH;
}

async function createFolder(parentId = null) {
    if (parentId && !canCreateSubfolder(parentId)) {
        alert(`Maximum folder depth of ${MAX_FOLDER_DEPTH} levels reached.`);
        return;
    }
    
    const name = await openTextPrompt('New Folder Name', 'New Folder');
    if (!name || !name.trim()) return;
    
    saveHistory();
    
    const folder = {
        id: 'folder_' + Date.now(),
        name: name.trim(),
        parentId: parentId,
        created: new Date().toISOString(),
        expanded: true,
        description: ''
    };
    
    appData.folders.push(folder);
    saveData();
    renderAll();
}

async function renameFolder(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const newName = await openTextPrompt('Rename Folder', folder.name);
    if (newName && newName.trim() && newName !== folder.name) {
        saveHistory();
        folder.name = newName.trim();
        saveData();
        renderAll();
    }
}

function deleteFolder(folderId) {
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    // Count contents
    const childFolders = getAllChildFolders(folderId);
    const docsInFolder = appData.documents.filter(d => d.folderId === folderId || childFolders.includes(d.folderId));
    
    let message = `Delete folder "${folder.name}"?`;
    if (childFolders.length > 0 || docsInFolder.length > 0) {
        message += `\n\nThis folder contains ${childFolders.length} subfolder(s) and ${docsInFolder.length} document(s). Documents will be moved to the root level.`;
    }
    
    if (!confirm(message)) return;
    
    saveHistory();
    
    // Move documents to root
    docsInFolder.forEach(doc => {
        doc.folderId = null;
    });
    
    // Delete all child folders
    appData.folders = appData.folders.filter(f => f.id !== folderId && !childFolders.includes(f.id));
    
    saveData();
    renderAll();
}

function getAllChildFolders(folderId, visited = new Set()) {
    // Cycle detection
    if (visited.has(folderId) || visited.size > MAX_ITERATIONS) return [];
    visited.add(folderId);
    
    const children = [];
    const directChildren = appData.folders.filter(f => f.parentId === folderId);
    directChildren.forEach(child => {
        if (!visited.has(child.id)) {
            children.push(child.id);
            children.push(...getAllChildFolders(child.id, visited));
        }
    });
    return children;
}

function toggleFolderExpanded(folderId, event) {
    if (event) event.stopPropagation();
    const folder = appData.folders.find(f => f.id === folderId);
    if (folder) {
        folder.expanded = !folder.expanded;
        saveData();
        renderAll();
    }
}

function moveDocumentToFolder(docId, folderId) {
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    saveHistory();
    doc.folderId = folderId || null;
    saveData();
    renderAll();
}

// Document drag-and-drop to folders
let draggedDocId = null;

function handleDocDragStart(event, docId) {
    draggedDocId = docId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', docId);
    event.currentTarget.classList.add('dragging');
    document.body.classList.add('dragging-document');
}

function handleDocDragEnd(event) {
    event.currentTarget.classList.remove('dragging');
    draggedDocId = null;
    document.body.classList.remove('dragging-document');
    // Remove any lingering drag-over states
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleFolderDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}

function handleFolderDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

function handleDocumentDropOnFolder(event, folderId) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    
    const docId = draggedDocId || event.dataTransfer.getData('text/plain');
    if (!docId) return;
    
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    // Don't do anything if dropping into the same folder
    if (doc.folderId === folderId) return;
    
    moveDocumentToFolder(docId, folderId);
}

function openFolderContextMenu(folderId, event) {
    event.preventDefault();
    event.stopPropagation();
    
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    const canAddSubfolder = canCreateSubfolder(folderId);
    
    const items = [
        { label: `Rename: ${folder.name}`, onClick: () => renameFolder(folderId) },
        { label: 'Folder info', onClick: () => openFolderInfo(folderId) }
    ];
    
    if (canAddSubfolder) {
        items.push({ label: 'New subfolder', onClick: () => createFolder(folderId) });
    }
    
    items.push({ type: 'sep' });
    items.push({ label: `Delete: ${folder.name}`, onClick: () => deleteFolder(folderId), danger: true });
    
    showContextMenu(items, event.clientX, event.clientY);
}

// Folder info modal
let currentFolderInfoId = null;

function openFolderInfo(folderId, event) {
    if (event) event.stopPropagation();
    
    currentFolderInfoId = folderId;
    const folder = appData.folders.find(f => f.id === folderId);
    if (!folder) return;
    
    // Count documents and subfolders
    const docsInFolder = appData.documents.filter(d => d.folderId === folderId);
    const subfolders = appData.folders.filter(f => f.parentId === folderId);
    
    document.getElementById('folderInfoName').textContent = folder.name;
    document.getElementById('folderInfoDocCount').textContent = docsInFolder.length;
    document.getElementById('folderInfoSubfolderCount').textContent = subfolders.length;
    document.getElementById('folderInfoCreated').textContent = new Date(folder.created).toLocaleDateString();
    document.getElementById('folderInfoDescription').value = folder.description || '';
    
    document.getElementById('folderInfoModal').classList.add('show');
}

function closeFolderInfoModal() {
    document.getElementById('folderInfoModal').classList.remove('show');
    currentFolderInfoId = null;
}

function saveFolderInfo(e) {
    if (e) e.preventDefault();
    
    const folder = appData.folders.find(f => f.id === currentFolderInfoId);
    if (!folder) return;
    
    saveHistory();
    
    folder.description = document.getElementById('folderInfoDescription').value;
    
    saveData();
    closeFolderInfoModal();
    renderAll();
}

function getVisibleDocumentOrder() {
    const orderedIds = [];
    const visitedFolders = new Set();

    const walkFolders = (parentId) => {
        const folders = appData.folders.filter(f => f.parentId === parentId);
        folders.forEach(folder => {
            if (visitedFolders.has(folder.id)) return;
            visitedFolders.add(folder.id);

            appData.documents
                .filter(d => d.folderId === folder.id)
                .forEach(doc => orderedIds.push(doc.id));

            if (folder.expanded !== false) {
                walkFolders(folder.id);
            }
        });
    };

    walkFolders(null);
    appData.documents.filter(d => !d.folderId).forEach(doc => orderedIds.push(doc.id));
    return orderedIds;
}

function selectDocumentFromList(event, docId) {
    const toggle = !!(event && (event.metaKey || event.ctrlKey));
    const range = !!(event && event.shiftKey);
    selectDocument(docId, { toggleSelect: toggle, rangeSelect: range });
}

function updateDocumentSelection(docId, options = {}) {
    const orderedDocIds = getVisibleDocumentOrder();
    const existing = Array.isArray(appData.selectedDocIds) ? appData.selectedDocIds.slice() : [];

    if (options.rangeSelect && appData.lastSelectedDocId && orderedDocIds.includes(docId)) {
        const from = orderedDocIds.indexOf(appData.lastSelectedDocId);
        const to = orderedDocIds.indexOf(docId);
        if (from !== -1 && to !== -1) {
            const [start, end] = from <= to ? [from, to] : [to, from];
            appData.selectedDocIds = orderedDocIds.slice(start, end + 1);
        } else {
            appData.selectedDocIds = [docId];
        }
        appData.lastSelectedDocId = docId;
        return;
    }

    if (options.toggleSelect) {
        if (existing.includes(docId)) {
            appData.selectedDocIds = existing.filter(id => id !== docId);
        } else {
            existing.push(docId);
            appData.selectedDocIds = existing;
        }
        appData.lastSelectedDocId = docId;
        return;
    }

    appData.selectedDocIds = [docId];
    appData.lastSelectedDocId = docId;
}

function selectDocument(docId, options = {}) {
    // Save current scroll position only if not in filtered view
    if (appData.currentDocId && !appData.filterCodeId) {
        const contentBody = document.querySelector('.content-body');
        if (contentBody) {
            appData.scrollPositions[appData.currentDocId] = contentBody.scrollTop;
        }
    }
    
    // Update lastAccessed timestamp
    const doc = appData.documents.find(d => d.id === docId);
    if (doc) {
        doc.lastAccessed = new Date().toISOString();
        if (typeof scheduleDocumentAccessMetaSave === 'function') {
            scheduleDocumentAccessMetaSave();
        }
    }
    
    updateDocumentSelection(docId, options);
    appData.currentDocId = docId;
    appData.filterCodeId = null;
    renderAll();
    
    // Restore scroll position
    setTimeout(() => {
        const contentBody = document.querySelector('.content-body');
        if (contentBody) {
            const savedPosition = appData.scrollPositions[docId] || 0;
            contentBody.scrollTop = savedPosition;
        }
    }, 0);
}

function openImportModal() {
    document.getElementById('importModal').classList.add('show');
}

function closeImportModal() {
    document.getElementById('importModal').classList.remove('show');
    document.getElementById('fileInput').value = '';
    document.getElementById('importTitle').value = '';
}

async function importDocument(e) {
    e.preventDefault();
    const title = document.getElementById('importTitle').value;

    // If running in Electron and a native-picked document exists, use it
    if (electronPickedDocument && electronPickedDocument.ok) {
        const picked = electronPickedDocument;
        electronPickedDocument = null;

        if (picked.kind === 'docx') {
            const arrayBuffer = Uint8Array.from(atob(picked.data), c => c.charCodeAt(0)).buffer;
            if (typeof mammoth === 'undefined') {
                alert('DOCX import requires the mammoth library, but it is not available. Try importing as .txt.');
                return;
            }
            mammoth.extractRawText({ arrayBuffer })
                .then(function(result) {
                    addDocument(title, result.value);
                    closeImportModal();
                    document.getElementById('importTitle').value = '';
                    const hint = document.getElementById('importFileHint');
                    if (hint) hint.textContent = '';
                })
                .catch(function(err) {
                    alert('Error importing DOCX: ' + err.message);
                });
            return;
        } else if (picked.kind === 'pdf') {
            const arrayBuffer = Uint8Array.from(atob(picked.data), c => c.charCodeAt(0)).buffer;
            if (typeof importPdf === 'undefined' || !(await isPdfSupported())) {
                alert('PDF import is unavailable because PDF.js could not be initialised in this build (commonly a PDF.js worker-loading issue in packaged Electron apps). Try rebuilding after unpacking the PDF.js worker file.');
                return;
            }
            importPdf(arrayBuffer, title)
                .then(function(pdfDoc) {
                    saveHistory();
                    appData.documents.push(pdfDoc);
                    appData.currentDocId = pdfDoc.id;
                    saveData();
                    closeImportModal();
                    renderAll();
                    document.getElementById('importTitle').value = '';
                    const hint = document.getElementById('importFileHint');
                    if (hint) hint.textContent = '';
                })
                .catch(function(err) {
                    alert('Error importing PDF: ' + err.message);
                });
            return;
        } else {
            addDocument(title, picked.data);
            closeImportModal();
            document.getElementById('importTitle').value = '';
            const hint = document.getElementById('importFileHint');
            if (hint) hint.textContent = '';
            return;
        }
    }

    const file = document.getElementById('fileInput').files[0];
    if (!file) {
        alert('Please select a file to import.');
        return;
    }
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.pdf')) {
        // Handle PDF files
        const reader = new FileReader();
        reader.onload = async function(e) {
            const arrayBuffer = e.target.result;
            if (typeof importPdf === 'undefined' || !(await isPdfSupported())) {
                alert('PDF import is unavailable because PDF.js could not be initialised in this build (commonly a PDF.js worker-loading issue in packaged Electron apps). Try rebuilding after unpacking the PDF.js worker file.');
                return;
            }
            importPdf(arrayBuffer, title)
                .then(function(pdfDoc) {
                    saveHistory();
                    appData.documents.push(pdfDoc);
                    appData.currentDocId = pdfDoc.id;
                    saveData();
                    closeImportModal();
                    renderAll();
                })
                .catch(function(err) {
                    alert('Error reading PDF file: ' + err.message);
                });
        };
        reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.docx')) {
        // Handle .docx files with mammoth
        const reader = new FileReader();
        reader.onload = function(e) {
            const arrayBuffer = e.target.result;
            mammoth.extractRawText({arrayBuffer: arrayBuffer})
                .then(function(result) {
                    const content = result.value;
                    addDocument(title, content);
                    closeImportModal();
                })
                .catch(function(err) {
                    alert('Error reading .docx file: ' + err.message);
                });
        };
        reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.rtf') || fileName.endsWith('.doc')) {
        // Handle plain text and basic formats
        const reader = new FileReader();
        reader.onload = function(e) {
            let content = e.target.result;
            // WARNING: .rtf/.doc parsing is rudimentary - strips control codes only.
            // Complex RTF files may produce garbled output. For best results, use .txt or .docx.
            if (fileName.endsWith('.rtf') || fileName.endsWith('.doc')) {
                content = content.replace(/\\[a-z]+\d*\s?/g, ''); // Remove RTF commands
                content = content.replace(/[{}]/g, ''); // Remove braces
                content = content.replace(/\\/g, ''); // Remove backslashes
            }
            addDocument(title, content);
            closeImportModal();
        };
        reader.readAsText(file);
    } else {
        alert('Unsupported file format');
    }
}

async function chooseImportFileNative() {
    if (!(window.electronAPI && window.electronAPI.openDocumentFile)) {
        // browser fallback
        const fi = document.getElementById('fileInput');
        if (fi) fi.click();
        return;
    }
    const res = await window.electronAPI.openDocumentFile();
    if (!res || !res.ok) return;

    electronPickedDocument = res;

    // Set default title from filename
    const titleEl = document.getElementById('importTitle');
    if (titleEl && !titleEl.value) {
        titleEl.value = (res.name || 'Document').replace(/\.[^/.]+$/, '');
    }

    // Show filename in UI if there's a hint element
    const hint = document.getElementById('importFileHint');
    if (hint) hint.textContent = res.name || '';
}

function openPasteModal() {
    document.getElementById('pasteModal').classList.add('show');
}

function closePasteModal() {
    document.getElementById('pasteModal').classList.remove('show');
    document.getElementById('pasteTitle').value = '';
    document.getElementById('pasteContent').value = '';
}

function pasteDocument(e) {
    e.preventDefault();
    const title = document.getElementById('pasteTitle').value;
    const content = document.getElementById('pasteContent').value;
    addDocument(title, content);
    closePasteModal();
}

function addDocument(title, content) {
    saveHistory();
    
    const doc = {
        id: 'doc_' + Date.now(),
        title: title,
        content: content,
        metadata: {},
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
    };
    appData.documents.push(doc);
    appData.currentDocId = doc.id;
    saveData();
    renderAll();
}

function extractPdfTextAsDocument(docId) {
    const source = appData.documents.find(d => d.id === docId);
    if (!source || source.type !== 'pdf') return;

    saveHistory();
    const baseTitle = `${source.title}_text`;
    let nextTitle = baseTitle;
    let suffix = 2;
    while (appData.documents.some(d => d.title === nextTitle)) {
        nextTitle = `${baseTitle}_${suffix}`;
        suffix++;
    }

    const doc = {
        id: 'doc_' + Date.now(),
        title: nextTitle,
        content: source.content || '',
        metadata: Object.assign({}, source.metadata || {}),
        folderId: source.folderId || null,
        created: new Date().toISOString(),
        lastAccessed: new Date().toISOString()
    };

    appData.documents.push(doc);
    appData.currentDocId = doc.id;
    appData.filterCodeId = null;
    saveData();
    renderAll();
}

function deleteDocument(docId) {
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    const segmentCount = appData.segments.filter(s => s.docId === docId).length;
    const memoCount = appData.memos.filter(m => m.type === 'document' && m.targetId === docId).length;
    
    let message = `Are you sure you want to delete "${doc.title}"?`;
    if (segmentCount > 0 || memoCount > 0) {
        message += `\n\nThis will also delete ${segmentCount} coded segment(s) and ${memoCount} memo(s).`;
    }
    
    if (!confirm(message)) return;
    
    saveHistory();
    
    // Remove document and related data
    appData.documents = appData.documents.filter(d => d.id !== docId);
    appData.segments = appData.segments.filter(s => s.docId !== docId);
    appData.memos = appData.memos.filter(m => !(m.type === 'document' && m.targetId === docId));
    
    // Clear selection if this was the current document
    if (appData.currentDocId === docId) {
        appData.currentDocId = appData.documents[0]?.id || null;
    }
    
    saveData();
    renderAll();
}

async function renameDocument(docId) {
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    const newName = await openTextPrompt('Rename Document', doc.title);
    if (newName && newName !== doc.title) {
        saveHistory();
        doc.title = newName;
        saveData();
        renderAll();
    }
}

// Document metadata functions
let currentMetadataDocId = null;

function openDocumentMetadata(docId, event) {
    if (event) event.stopPropagation();
    
    currentMetadataDocId = docId;
    const doc = appData.documents.find(d => d.id === docId);
    if (!doc) return;
    
    const meta = doc.metadata || {};
    document.getElementById('metaParticipantId').value = meta.participantId || '';
    document.getElementById('metaDate').value = meta.date || '';
    document.getElementById('metaLocation').value = meta.location || '';
    document.getElementById('metaAge').value = meta.age || '';
    document.getElementById('metaGender').value = meta.gender || '';
    document.getElementById('metaCustom1').value = meta.custom1 || '';
    document.getElementById('metaNotes').value = meta.notes || '';
    
    document.getElementById('metadataModal').classList.add('show');
}

function closeMetadataModal() {
    document.getElementById('metadataModal').classList.remove('show');
    currentMetadataDocId = null;
}

function saveMetadata(e) {
    e.preventDefault();
    
    const doc = appData.documents.find(d => d.id === currentMetadataDocId);
    if (!doc) return;
    
    saveHistory();
    
    doc.metadata = {
        participantId: document.getElementById('metaParticipantId').value,
        date: document.getElementById('metaDate').value,
        location: document.getElementById('metaLocation').value,
        age: document.getElementById('metaAge').value,
        gender: document.getElementById('metaGender').value,
        custom1: document.getElementById('metaCustom1').value,
        notes: document.getElementById('metaNotes').value
    };
    
    saveData();
    closeMetadataModal();
    renderAll();
}

// Drag and drop file handling
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleDroppedFiles(files) {
    if (files.length === 0) return;
    
    // Process first file
    const file = files[0];
    handleDroppedDocument(file);
}

function handleDroppedDocument(file) {
    const fileName = file.name.toLowerCase();
    const title = file.name.replace(/\.[^/.]+$/, '');
    
    if (fileName.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async function(e) {
            const arrayBuffer = e.target.result;
            if (typeof importPdf === 'undefined' || !(await isPdfSupported())) {
                alert('PDF import is unavailable because PDF.js could not be initialised in this build (commonly a PDF.js worker-loading issue in packaged Electron apps). Try rebuilding after unpacking the PDF.js worker file.');
                return;
            }
            importPdf(arrayBuffer, title)
                .then(function(pdfDoc) {
                    saveHistory();
                    appData.documents.push(pdfDoc);
                    appData.currentDocId = pdfDoc.id;
                    saveData();
                    renderAll();
                })
                .catch(function(err) {
                    alert('Error reading PDF file: ' + err.message);
                });
        };
        reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.docx')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const arrayBuffer = e.target.result;
            mammoth.extractRawText({arrayBuffer: arrayBuffer})
                .then(function(result) {
                    addDocument(title, result.value);
                })
                .catch(function(err) {
                    alert('Error reading .docx file: ' + err.message);
                });
        };
        reader.readAsArrayBuffer(file);
    } else if (fileName.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            addDocument(title, e.target.result);
        };
        reader.readAsText(file);
    } else {
        alert('Unsupported file format. Please use .txt, .docx, or .pdf files.');
    }
}
