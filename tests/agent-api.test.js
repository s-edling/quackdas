const test = require('node:test');
const assert = require('node:assert/strict');

function loadAgentApi(project) {
  let saveCalls = 0;
  let renderCalls = 0;

  global.window = {};
  global.appData = project;
  global.saveData = () => { saveCalls += 1; };
  global.renderAll = () => { renderCalls += 1; };
  global.manualSave = async () => {};
  global.getSegmentsForDoc = (docId) => (global.appData.segments || []).filter((segment) => segment.docId === docId);

  delete require.cache[require.resolve('../js/agent-api.js')];
  require('../js/agent-api.js');

  return {
    api: global.window.quackdasAgent,
    getSaveCalls: () => saveCalls,
    getRenderCalls: () => renderCalls
  };
}

test('agent API document reads expose revision and editability metadata', () => {
  const { api } = loadAgentApi({
    documents: [
      { id: 'doc_plain', title: 'Plain', type: 'text', content: 'Alpha', revision: 2 },
      { id: 'doc_rich', title: 'Rich', type: 'text', content: 'Beta', richContentHtml: '<p>Beta</p>', revision: 4 }
    ],
    segments: [
      { id: 'seg_1', docId: 'doc_plain', codeIds: ['code_a'], startIndex: 0, endIndex: 5 }
    ],
    codes: [{ id: 'code_a', name: 'Theme A' }]
  });

  const listed = api.docs.list();
  assert.equal(listed.length, 2);
  assert.deepEqual(listed.map((doc) => ({
    id: doc.id,
    revision: doc.revision,
    codedSegmentCount: doc.codedSegmentCount,
    hasRichText: doc.hasRichText,
    canUpdateContent: doc.canUpdateContent
  })), [
    {
      id: 'doc_plain',
      revision: 2,
      codedSegmentCount: 1,
      hasRichText: false,
      canUpdateContent: false
    },
    {
      id: 'doc_rich',
      revision: 4,
      codedSegmentCount: 0,
      hasRichText: true,
      canUpdateContent: false
    }
  ]);

  const rich = api.docs.get({ doc_id: 'doc_rich' });
  assert.equal(rich.revision, 4);
  assert.equal(rich.hasRichText, true);
  assert.equal(rich.canUpdateContent, false);
});

test('agent API blocks content edits for coded documents', () => {
  const harness = loadAgentApi({
    documents: [
      { id: 'doc_plain', title: 'Plain', type: 'text', content: 'Alpha', revision: 2 }
    ],
    segments: [
      { id: 'seg_1', docId: 'doc_plain', codeIds: ['code_a'], startIndex: 0, endIndex: 5 }
    ],
    codes: [{ id: 'code_a', name: 'Theme A' }]
  });

  const result = harness.api.docs.update({
    doc_id: 'doc_plain',
    content: 'Updated alpha',
    revision: 2
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'DOCUMENT_HAS_CODING',
    message: 'Document has coded segments. Agent content edits are blocked to preserve coding offsets.',
    currentRevision: 2,
    codedSegmentCount: 1
  });
  assert.equal(global.appData.documents[0].content, 'Alpha');
  assert.equal(harness.getSaveCalls(), 0);
  assert.equal(harness.getRenderCalls(), 0);
});

test('agent API blocks content edits for rich-text documents', () => {
  const harness = loadAgentApi({
    documents: [
      { id: 'doc_rich', title: 'Rich', type: 'text', content: 'Beta', richContentHtml: '<p>Beta</p>', revision: 4 }
    ],
    segments: [],
    codes: []
  });

  const result = harness.api.docs.update({
    doc_id: 'doc_rich',
    content: 'Updated beta',
    revision: 4
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'DOCUMENT_HAS_RICH_TEXT',
    message: 'Document retains rich-text markup. Agent content edits are blocked to avoid stale HTML exports.',
    currentRevision: 4,
    hasRichText: true
  });
  assert.equal(global.appData.documents[0].content, 'Beta');
  assert.equal(harness.getSaveCalls(), 0);
  assert.equal(harness.getRenderCalls(), 0);
});

test('agent API updates plain-text documents with revision checks', () => {
  const harness = loadAgentApi({
    documents: [
      { id: 'doc_plain', title: 'Plain', type: 'text', content: 'Alpha', revision: 1 }
    ],
    segments: [],
    codes: []
  });

  const result = harness.api.docs.update({
    doc_id: 'doc_plain',
    content: 'Updated alpha',
    revision: 1
  });

  assert.deepEqual(result, {
    ok: true,
    doc_id: 'doc_plain',
    revision: 2,
    length: 13,
    changed: true
  });
  assert.equal(global.appData.documents[0].content, 'Updated alpha');
  assert.equal(global.appData.documents[0].revision, 2);
  assert.equal(harness.getSaveCalls(), 1);
  assert.equal(harness.getRenderCalls(), 1);
});
