const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIncrementalIndexing } = require('../semantic/indexing-core');
const { openSemanticStore } = require('../semantic/store');

function makeDoc(id, title, body) {
  return { id, title, type: 'text', content: body };
}

function fakeEmbedMany(calls) {
  return async (texts, options = {}) => {
    calls.push({ texts: texts.slice(), model: options.modelName });
    return texts.map((text, index) => {
      const len = String(text || '').length;
      return [len % 97, (len + index) % 53, 1];
    });
  };
}

test('incremental indexing re-embeds only changed chunks', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-semantic-test-'));
  const dbPath = path.join(tempDir, 'semantic.sqlite');

  const baseA = 'Alpha paragraph. '.repeat(300);
  const baseB = 'Beta paragraph. '.repeat(320);

  const firstCalls = [];
  const firstResult = await runIncrementalIndexing({
    dbPath,
    modelName: 'bge-m3',
    documents: [
      makeDoc('doc_a', 'Doc A', baseA),
      makeDoc('doc_b', 'Doc B', baseB)
    ],
    embedMany: fakeEmbedMany(firstCalls),
    chunkMin: 1100,
    chunkMax: 1500,
    chunkOverlap: 200,
    embeddingConcurrency: 2
  });

  assert.equal(firstResult.ok, true);
  const firstEmbedded = firstCalls.reduce((sum, call) => sum + call.texts.length, 0);
  assert.ok(firstEmbedded > 0);

  const secondCalls = [];
  const secondResult = await runIncrementalIndexing({
    dbPath,
    modelName: 'bge-m3',
    documents: [
      makeDoc('doc_a', 'Doc A', `${baseA} CHANGED`),
      makeDoc('doc_b', 'Doc B', baseB)
    ],
    embedMany: fakeEmbedMany(secondCalls),
    chunkMin: 1100,
    chunkMax: 1500,
    chunkOverlap: 200,
    embeddingConcurrency: 2
  });

  assert.equal(secondResult.ok, true);
  const secondEmbedded = secondCalls.reduce((sum, call) => sum + call.texts.length, 0);
  assert.ok(secondEmbedded > 0);
  assert.ok(secondEmbedded < firstEmbedded, 'second run should embed fewer chunks than initial full index');

  const store = openSemanticStore(dbPath);
  try {
    const totalChunks = store.getTotalChunkCount();
    assert.ok(totalChunks > 0);

    const stateA = store.getDocState('doc_a');
    const stateB = store.getDocState('doc_b');
    assert.ok(stateA);
    assert.ok(stateB);
    assert.ok(stateA.chunkCount > 0);
    assert.ok(stateB.chunkCount > 0);
  } finally {
    store.close();
  }
});

test('incremental indexing removes deleted documents from the semantic store', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-semantic-prune-'));
  const dbPath = path.join(tempDir, 'semantic.sqlite');

  await runIncrementalIndexing({
    dbPath,
    modelName: 'bge-m3',
    documents: [
      makeDoc('doc_a', 'Doc A', 'Alpha paragraph. '.repeat(120)),
      makeDoc('doc_b', 'Doc B', 'Beta paragraph. '.repeat(120))
    ],
    embedMany: fakeEmbedMany([]),
    chunkMin: 600,
    chunkMax: 900,
    chunkOverlap: 100
  });

  await runIncrementalIndexing({
    dbPath,
    modelName: 'bge-m3',
    documents: [
      makeDoc('doc_a', 'Doc A', 'Alpha paragraph. '.repeat(120))
    ],
    embedMany: fakeEmbedMany([]),
    chunkMin: 600,
    chunkMax: 900,
    chunkOverlap: 100
  });

  const store = openSemanticStore(dbPath);
  try {
    assert.ok(store.getDocState('doc_a'));
    assert.equal(store.getDocState('doc_b'), null);
    assert.equal(store.getEmbeddingsForModel('bge-m3').some((row) => row.docId === 'doc_b'), false);
  } finally {
    store.close();
  }
});
