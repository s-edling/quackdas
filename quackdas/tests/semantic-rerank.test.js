const test = require('node:test');
const assert = require('node:assert/strict');

const { rerankCandidates } = require('../semantic/rerank');

test('rerankCandidates prioritizes lexical match when semantic scores are close', () => {
  const query = 'research leadership conflict';
  const rows = [
    {
      id: 'a',
      text: 'unrelated paragraph about administration and logistics',
      score: 0.78
    },
    {
      id: 'b',
      text: 'clear conflict between research staff and elected leadership',
      score: 0.76
    }
  ];

  const reranked = rerankCandidates(query, rows);
  assert.equal(reranked.length, 2);
  assert.equal(reranked[0].id, 'b');
  assert.ok(Number.isFinite(reranked[0].rerankScore));
  assert.ok(Number.isFinite(reranked[0].semanticScore));
});

test('rerankCandidates keeps descending order for empty query text', () => {
  const rows = [
    { id: 'a', text: 'x', score: 0.2 },
    { id: 'b', text: 'y', score: 0.9 },
    { id: 'c', text: 'z', score: 0.5 }
  ];
  const reranked = rerankCandidates('', rows);
  assert.deepEqual(reranked.map((r) => r.id), ['b', 'c', 'a']);
});
