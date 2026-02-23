const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIncrementalIndexing } = require('../semantic/indexing-core');
const { retrieveTopKChunks, parseAndValidateAskOutput } = require('../semantic/ask-core');

function fakeEmbedMany() {
  return async (texts) => texts.map((text) => {
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('alpha')) return [1, 0, 0];
    if (normalized.includes('beta')) return [0, 1, 0];
    return [0, 0, 1];
  });
}

function fakeEmbedText() {
  return async (_modelName, text) => {
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('alpha')) return [1, 0, 0];
    if (normalized.includes('beta')) return [0, 1, 0];
    return [0, 0, 1];
  };
}

test('ask retrieval returns correct chunk and validation accepts citation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-ask-it-'));
  const dbPath = path.join(tempDir, 'semantic.sqlite');
  const documents = [
    { id: 'doc_a', title: 'Doc A', type: 'text', content: 'Alpha evidence sentence only in doc A.' },
    { id: 'doc_b', title: 'Doc B', type: 'text', content: 'Beta information in another file.' }
  ];

  await runIncrementalIndexing({
    dbPath,
    modelName: 'bge-m3',
    documents,
    embedMany: fakeEmbedMany(),
    chunkMin: 100,
    chunkMax: 120,
    chunkOverlap: 20,
    embeddingConcurrency: 1
  });

  const retrieved = await retrieveTopKChunks({
    dbPath,
    question: 'Where is alpha evidence?',
    documents,
    embeddingModel: 'bge-m3',
    topK: 2,
    embedTextFn: fakeEmbedText()
  });

  assert.ok(retrieved.length >= 1);
  assert.equal(retrieved[0].docId, 'doc_a');

  const payload = {
    answer: [
      {
        claim: 'Alpha evidence is in doc A.',
        citations: [
          { doc_id: retrieved[0].docId, chunk_id: retrieved[0].chunkId },
          { doc_id: retrieved[1]?.docId || retrieved[0].docId, chunk_id: retrieved[1]?.chunkId || retrieved[0].chunkId }
        ],
        quotes: [{ doc_id: retrieved[0].docId, chunk_id: retrieved[0].chunkId, quote: 'Alpha evidence sentence only in doc A.' }]
      }
    ],
    notes: ''
  };

  const validated = parseAndValidateAskOutput(JSON.stringify(payload), retrieved);
  assert.equal(validated.answer.length, 1);
  assert.equal(validated.answer[0].citations.length, 2);
});
