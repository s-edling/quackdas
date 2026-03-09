const test = require('node:test');
const assert = require('node:assert/strict');

const undoBtn = { disabled: false };
const redoBtn = { disabled: false };

global.window = { electronAPI: {} };
global.document = {
  getElementById(id) {
    if (id === 'undoBtn') return undoBtn;
    if (id === 'redoBtn') return redoBtn;
    return { disabled: false };
  }
};

let renderCalls = 0;
let resetUiCalls = 0;
let resetPdfCalls = 0;
global.renderAll = () => { renderCalls += 1; };
global.scheduleProjectBackup = () => {};
global.syncDocumentCaseIdsFromCases = () => {};
global.resetProjectUiTransientState = () => { resetUiCalls += 1; };
global.resetPdfProjectTransientState = () => { resetPdfCalls += 1; };
global.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
global.currentPdfState = {
  docId: null,
  currentPage: 1,
  pendingGoToPage: null
};

const state = require('../js/state.js');

test('normaliseProject upgrades legacy fields and prunes invalid segment memos', () => {
  const project = state.normaliseProject({
    documents: [
      { id: 'doc_1', title: 'Doc 1', content: 'Alpha Beta', created: '2025-01-01T00:00:00.000Z' }
    ],
    codes: [
      { id: 'code_a', name: 'Theme A', color: '#808080' },
      { id: 'code_b', name: 'Theme B', color: '#808080' }
    ],
    segments: [
      { id: 'seg_1', docId: 'doc_1', text: 'Alpha', codeId: 'code_a', startIndex: 0, endIndex: 5 }
    ],
    memos: [
      { id: 'memo_keep', type: 'segment', targetId: 'seg_1', codeId: 'code_a', content: 'keep me', created: '2025-01-01T00:00:00.000Z' },
      { id: 'memo_drop', type: 'segment', targetId: 'seg_1', codeId: 'missing_code', content: 'drop me', created: '2025-01-01T00:00:00.000Z' }
    ],
    cases: [
      { id: 'case_parent', name: 'Parent', linkedDocumentIds: ['doc_1'], attributes: { Cohort: 1 } },
      { id: 'case_child', name: 'Child', parentId: 'case_parent', docIds: ['doc_1'], attributes: { Cohort: 'A' } }
    ],
    selectedDocIds: ['doc_1', 'missing_doc']
  });

  assert.deepEqual(project.segments[0].codeIds, ['code_a']);
  assert.equal(project.memos.length, 1);
  assert.equal(project.memos[0].id, 'memo_keep');
  assert.equal(project.cases[1].linkedDocumentIds[0], 'doc_1');
  assert.equal(project.cases[1].attributes.Cohort, 'A');
  assert.deepEqual(project.selectedDocIds, ['doc_1']);
  assert.equal(project.lastSelectedDocId, 'doc_1');
  assert.notEqual(project.codes[0].color, '#808080');
});

test('undo and redo restore codes, folders, and current selection without reloading documents', () => {
  renderCalls = 0;
  undoBtn.disabled = false;
  redoBtn.disabled = false;

  state.__setHistoryForTests({ past: [], future: [], maxLength: 10 });
  state.__setAppDataForTests(state.normaliseProject({
    documents: [
      { id: 'doc_1', title: 'Doc 1', content: 'Alpha', folderId: 'folder_a', created: '2025-01-01T00:00:00.000Z' }
    ],
    folders: [
      { id: 'folder_a', name: 'Folder A', created: '2025-01-01T00:00:00.000Z' }
    ],
    codes: [
      { id: 'code_a', name: 'Theme A', created: '2025-01-01T00:00:00.000Z' }
    ],
    currentDocId: 'doc_1'
  }));

  state.saveHistory();

  const current = state.__getAppDataForTests();
  current.documents[0].folderId = null;
  current.codes.push({ id: 'code_b', name: 'Theme B', created: '2025-01-02T00:00:00.000Z' });
  current.currentDocId = null;

  state.undo();
  const undone = state.__getAppDataForTests();
  assert.equal(undone.documents.length, 1);
  assert.equal(undone.documents[0].content, 'Alpha');
  assert.equal(undone.documents[0].folderId, 'folder_a');
  assert.deepEqual(undone.codes.map((code) => code.id), ['code_a']);
  assert.equal(undone.currentDocId, 'doc_1');
  assert.equal(renderCalls, 1);
  assert.equal(undoBtn.disabled, true);
  assert.equal(redoBtn.disabled, false);

  state.redo();
  const redone = state.__getAppDataForTests();
  assert.equal(redone.documents[0].folderId, null);
  assert.deepEqual(redone.codes.map((code) => code.id), ['code_a', 'code_b']);
  assert.equal(redone.currentDocId, null);
  assert.equal(renderCalls, 2);
  assert.equal(redoBtn.disabled, true);
});

test('undo and redo preserve the current PDF page when staying in the same PDF document', () => {
  renderCalls = 0;
  undoBtn.disabled = false;
  redoBtn.disabled = false;
  global.currentPdfState.docId = 'doc_pdf';
  global.currentPdfState.currentPage = 8;
  global.currentPdfState.pendingGoToPage = null;

  state.__setHistoryForTests({ past: [], future: [], maxLength: 10 });
  state.__setAppDataForTests(state.normaliseProject({
    documents: [
      { id: 'doc_pdf', type: 'pdf', title: 'PDF', content: 'Alpha', pdfData: 'stub', created: '2025-01-01T00:00:00.000Z' }
    ],
    codes: [
      { id: 'code_a', name: 'Theme A', created: '2025-01-01T00:00:00.000Z' }
    ],
    currentDocId: 'doc_pdf'
  }));

  state.saveHistory();

  const current = state.__getAppDataForTests();
  current.codes.push({ id: 'code_b', name: 'Theme B', created: '2025-01-02T00:00:00.000Z' });

  state.undo();
  assert.deepEqual(global.currentPdfState.pendingGoToPage, {
    docId: 'doc_pdf',
    pageNum: 8
  });

  global.currentPdfState.pendingGoToPage = null;
  state.redo();
  assert.deepEqual(global.currentPdfState.pendingGoToPage, {
    docId: 'doc_pdf',
    pageNum: 8
  });
});

test('undo falls back to an existing document when a snapshot points at a deleted one', () => {
  renderCalls = 0;

  state.__setHistoryForTests({
    past: [JSON.stringify({
      documentIds: ['doc_missing'],
      documentFolders: {},
      codes: [],
      segments: [],
      memos: [],
      folders: [],
      cases: [],
      variableDefinitions: [],
      currentDocId: 'doc_missing',
      selectedCaseId: null,
      filterCodeId: null
    })],
    future: [],
    maxLength: 10
  });
  state.__setAppDataForTests(state.normaliseProject({
    documents: [
      { id: 'doc_present', title: 'Present', content: 'Alpha', created: '2025-01-01T00:00:00.000Z' }
    ]
  }));

  state.undo();

  assert.equal(state.__getAppDataForTests().currentDocId, 'doc_present');
  assert.equal(renderCalls, 1);
});

test('replaceProjectData clears undo history and bumps revision-driven caches on project replacement', () => {
  renderCalls = 0;
  resetUiCalls = 0;
  resetPdfCalls = 0;
  undoBtn.disabled = false;
  redoBtn.disabled = false;

  state.__setAppDataRevisionForTests(4);
  state.__setHistoryForTests({
    past: ['snapshot-a'],
    future: ['snapshot-b'],
    maxLength: 10
  });
  state.__setAppDataForTests(state.normaliseProject({
    documents: [
      { id: 'doc_old', title: 'Old', content: 'Old content', created: '2025-01-01T00:00:00.000Z' }
    ],
    selectedDocIds: ['doc_old'],
    lastSelectedDocId: 'doc_old',
    selectedCaseId: 'case_old',
    filterCodeId: 'code_old',
    selectedText: { text: 'Old selection' },
    scrollPositions: { doc_old: 120 }
  }));

  state.replaceProjectData({
    documents: [
      { id: 'doc_new', title: 'New', content: 'New content', created: '2025-01-02T00:00:00.000Z' }
    ],
    selectedDocIds: ['doc_new'],
    lastSelectedDocId: 'doc_new',
    selectedCaseId: 'case_new',
    filterCodeId: 'code_new',
    selectedText: { text: 'New selection' },
    scrollPositions: { doc_new: 80 }
  }, {
    fallbackTheme: 'light',
    hasUnsavedChanges: false,
    lastSaveTime: '2025-01-02T00:00:00.000Z',
    markUnsaved: false
  });

  const next = state.__getAppDataForTests();
  const nextHistory = state.__getHistoryForTests();

  assert.equal(next.documents[0].id, 'doc_new');
  assert.deepEqual(next.selectedDocIds, []);
  assert.equal(next.lastSelectedDocId, null);
  assert.equal(next.selectedCaseId, null);
  assert.equal(next.filterCodeId, null);
  assert.equal(next.selectedText, null);
  assert.deepEqual(next.scrollPositions, {});
  assert.equal(next.hasUnsavedChanges, false);
  assert.equal(next.lastSaveTime, '2025-01-02T00:00:00.000Z');
  assert.deepEqual(nextHistory.past, []);
  assert.deepEqual(nextHistory.future, []);
  assert.equal(undoBtn.disabled, true);
  assert.equal(redoBtn.disabled, true);
  assert.equal(state.__getAppDataRevisionForTests(), 5);
  assert.equal(resetUiCalls, 1);
  assert.equal(resetPdfCalls, 1);
});
