const test = require('node:test');
const assert = require('node:assert/strict');

const { createDeterministicChunks } = require('../semantic/chunker');

function buildParagraphs(count, prefix = 'P') {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const body = `${prefix}${i} ` + 'lorem ipsum dolor sit amet '.repeat(40);
    arr.push(body.trim());
  }
  return arr.join('\n\n');
}

test('chunker is deterministic for same input', () => {
  const text = buildParagraphs(8);
  const a = createDeterministicChunks('doc_1', text);
  const b = createDeterministicChunks('doc_1', text);
  assert.deepEqual(a, b);
  assert.ok(a.length > 1);
});

test('chunk boundaries are monotonic with deterministic overlap', () => {
  const text = buildParagraphs(10, 'Overlap');
  const overlap = 200;
  const chunks = createDeterministicChunks('doc_2', text, {
    minChars: 1200,
    maxChars: 1700,
    overlapChars: overlap
  });

  assert.ok(chunks.length > 1);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    assert.ok(chunk.startChar < chunk.endChar, 'chunk must have non-empty range');
    if (i === 0) continue;

    const prev = chunks[i - 1];
    const expectedStart = Math.max(prev.endChar - overlap, prev.startChar);
    assert.equal(chunk.startChar, expectedStart);
    assert.ok(chunk.endChar > prev.endChar || chunk.endChar === text.length);
  }
});

test('chunker handles weird newlines and long paragraphs', () => {
  const longLine = 'Sentence without newline. '.repeat(280);
  const text = `alpha\r\n\r\n${longLine}\r\nbeta\n\ngamma`;
  const chunks = createDeterministicChunks('doc_3', text, {
    minChars: 1000,
    maxChars: 1400,
    overlapChars: 200
  });

  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].textSlice.includes('\r'), false, 'canonicalization should normalize line endings');
  assert.ok(chunks.every((chunk) => chunk.startChar < chunk.endChar));
  assert.ok(chunks[chunks.length - 1].endChar <= text.replace(/\r\n?/g, '\n').length);
});

test('short documents produce one chunk', () => {
  const text = 'Kort text pa svenska.';
  const chunks = createDeterministicChunks('doc_4', text);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startChar, 0);
  assert.equal(chunks[0].endChar, text.length);
});
