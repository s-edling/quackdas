const test = require('node:test');
const assert = require('node:assert/strict');

let confirmMessage = '';
let saveCalls = 0;
let renderCalls = 0;
let clearHistoryCalls = 0;

global.confirm = (message) => {
  confirmMessage = String(message || '');
  return true;
};
global.saveData = () => { saveCalls += 1; };
global.renderAll = () => { renderCalls += 1; };
global.clearHistoryState = () => { clearHistoryCalls += 1; };

const { deleteDocument } = require('../js/documents.js');

function resetCounters() {
  confirmMessage = '';
  saveCalls = 0;
  renderCalls = 0;
  clearHistoryCalls = 0;
}

test('deleteDocument clears undo history and warns that deletion is not undoable', () => {
  resetCounters();
  global.appData = {
    documents: [
      { id: 'doc_1', title: 'Doc 1', content: 'Alpha' },
      { id: 'doc_2', title: 'Doc 2', content: 'Beta' }
    ],
    segments: [
      { id: 'seg_1', docId: 'doc_1' }
    ],
    memos: [
      { id: 'memo_doc', type: 'document', targetId: 'doc_1' },
      { id: 'memo_seg', type: 'segment', targetId: 'seg_1' }
    ],
    cases: [
      { id: 'case_1', linkedDocumentIds: ['doc_1', 'doc_2'] }
    ],
    currentDocId: 'doc_1'
  };

  deleteDocument('doc_1');

  assert.match(confirmMessage, /cannot be undone with Ctrl\+Z/i);
  assert.equal(clearHistoryCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(renderCalls, 1);
  assert.deepEqual(global.appData.documents.map((doc) => doc.id), ['doc_2']);
  assert.deepEqual(global.appData.segments, []);
  assert.deepEqual(global.appData.memos, []);
  assert.deepEqual(global.appData.cases[0].linkedDocumentIds, ['doc_2']);
  assert.equal(global.appData.currentDocId, 'doc_2');
});
