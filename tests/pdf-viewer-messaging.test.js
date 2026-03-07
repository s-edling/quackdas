const test = require('node:test');
const assert = require('node:assert/strict');

const pdf = require('../js/pdf.js');

test('pdf viewer message validator accepts only namespaced event/response payloads', () => {
  assert.equal(pdf.isPdfViewerMessagePayload({
    namespace: pdf.PDF_VIEWER_MESSAGE_NAMESPACE,
    kind: 'event',
    type: 'ready'
  }), true);

  assert.equal(pdf.isPdfViewerMessagePayload({
    namespace: pdf.PDF_VIEWER_MESSAGE_NAMESPACE,
    kind: 'response',
    requestId: 'abc'
  }), true);

  assert.equal(pdf.isPdfViewerMessagePayload({
    namespace: 'wrong-channel',
    kind: 'event',
    type: 'ready'
  }), false);

  assert.equal(pdf.isPdfViewerMessagePayload({
    namespace: pdf.PDF_VIEWER_MESSAGE_NAMESPACE,
    kind: 'request',
    command: 'loadDocument'
  }), false);

  assert.equal(pdf.isPdfViewerMessagePayload(null), false);
});
