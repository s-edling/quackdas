const test = require('node:test');
const assert = require('node:assert/strict');

global.appData = {
  segments: [],
  documents: [],
  selectedText: null
};

const coding = require('../js/coding.js');

function resetSegments(segments) {
  global.appData.segments = segments.map((segment) => ({ ...segment, codeIds: [...(segment.codeIds || [])] }));
}

test('PDF text selections do not snap out to an existing nearby coded segment', () => {
  resetSegments([
    {
      id: 'seg_existing',
      docId: 'doc_pdf',
      startIndex: 100,
      endIndex: 120,
      codeIds: ['code_a']
    }
  ]);

  const doc = {
    id: 'doc_pdf',
    type: 'pdf',
    content: 'x'.repeat(300)
  };

  const normalized = coding.normalizeTextSelectionForCoding(doc, {
    startIndex: 102,
    endIndex: 118
  });

  assert.deepEqual(normalized, {
    startIndex: 102,
    endIndex: 118,
    text: doc.content.slice(102, 118)
  });
});

test('plain text selections still snap to an almost-identical existing coded segment', () => {
  resetSegments([
    {
      id: 'seg_existing',
      docId: 'doc_text',
      startIndex: 100,
      endIndex: 120,
      codeIds: ['code_a']
    }
  ]);

  const doc = {
    id: 'doc_text',
    type: 'text',
    content: 'x'.repeat(300)
  };

  const normalized = coding.normalizeTextSelectionForCoding(doc, {
    startIndex: 101,
    endIndex: 119
  });

  assert.deepEqual(normalized, {
    startIndex: 100,
    endIndex: 120,
    text: doc.content.slice(100, 120)
  });
});

test('coding immediately before an existing same-code PDF segment does not uncoded its first characters', () => {
  resetSegments([
    {
      id: 'seg_existing',
      docId: 'doc_pdf',
      startIndex: 10,
      endIndex: 30,
      text: 'x'.repeat(20),
      codeIds: ['code_a'],
      created: '2026-03-06T00:00:00.000Z'
    }
  ]);

  const doc = {
    id: 'doc_pdf',
    type: 'pdf',
    content: 'x'.repeat(80)
  };

  const normalized = coding.normalizeTextSelectionForCoding(doc, {
    startIndex: 0,
    endIndex: 10
  });
  assert.equal(normalized.startIndex, 0);
  assert.equal(normalized.endIndex, 10);

  const result = coding.toggleCodeForTextRange(doc, normalized.startIndex, normalized.endIndex, 'code_a');
  assert.equal(result.changed, true);

  const docSegments = global.appData.segments
    .filter((segment) => segment.docId === doc.id)
    .sort((a, b) => a.startIndex - b.startIndex);

  assert.deepEqual(
    docSegments.map((segment) => ({
      startIndex: segment.startIndex,
      endIndex: segment.endIndex,
      codeIds: segment.codeIds
    })),
    [
      { startIndex: 0, endIndex: 10, codeIds: ['code_a'] },
      { startIndex: 10, endIndex: 30, codeIds: ['code_a'] }
    ]
  );
});

test('fieldnote text coding allows very short note selections', () => {
  resetSegments([]);
  global.appData.documents = [{
    id: 'doc_fieldnote',
    type: 'fieldnote',
    content: 'OK'
  }];

  const doc = global.appData.documents[0];
  const result = coding.toggleCodeForTextRange(doc, 0, 2, 'code_a');

  assert.equal(result.changed, true);
  assert.deepEqual(global.appData.segments.map((segment) => ({
    docId: segment.docId,
    startIndex: segment.startIndex,
    endIndex: segment.endIndex,
    codeIds: segment.codeIds
  })), [
    {
      docId: 'doc_fieldnote',
      startIndex: 0,
      endIndex: 2,
      codeIds: ['code_a']
    }
  ]);
});

test('fieldnote selection normalization trims trailing separator newlines', () => {
  resetSegments([]);

  const doc = {
    id: 'doc_fieldnote',
    type: 'fieldnote',
    content: 'Line one\n\nLine two'
  };

  const normalized = coding.normalizeTextSelectionForCoding(doc, {
    startIndex: 0,
    endIndex: 10
  });

  assert.deepEqual(normalized, {
    startIndex: 0,
    endIndex: 8,
    text: 'Line one'
  });
});

test('fieldnote selection normalization trims leading separator newlines', () => {
  resetSegments([]);

  const doc = {
    id: 'doc_fieldnote',
    type: 'fieldnote',
    content: 'Line one\n\nLine two'
  };

  const normalized = coding.normalizeTextSelectionForCoding(doc, {
    startIndex: 8,
    endIndex: doc.content.length
  });

  assert.deepEqual(normalized, {
    startIndex: 10,
    endIndex: doc.content.length,
    text: 'Line two'
  });
});
