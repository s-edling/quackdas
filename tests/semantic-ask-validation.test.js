const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAskJson, validateAskResponse, parseLooseCitedResponse, validateLooseCitedResponse } = require('../semantic/ask-validation');

const retrieved = [
  { docId: 'doc_a', chunkId: 'doc_a::0', text: 'Alpha source text with exact quote phrase.' },
  { docId: 'doc_b', chunkId: 'doc_b::1', text: 'Beta source text.' }
];

test('parse + validate keeps only citations from retrieved set', () => {
  const parsed = parseAskJson(JSON.stringify({
    answer: [
      {
        claim: 'Grounded claim',
        citations: [
          { doc_id: 'doc_a', chunk_id: 'doc_a::0' },
          { doc_id: 'doc_x', chunk_id: 'x::0' }
        ],
        quotes: []
      },
      {
        claim: 'Hallucinated claim',
        citations: [{ doc_id: 'doc_x', chunk_id: 'x::1' }],
        quotes: []
      }
    ],
    notes: 'note'
  }));

  const validated = validateAskResponse(parsed, retrieved, { minCitationsOverall: 1 });
  assert.equal(validated.answer.length, 2);
  assert.equal(validated.answer[0].citations.length, 1);
  assert.equal(validated.answer[0].citations[0].doc_id, 'doc_a');
  assert.equal(validated.answer[1].citations.length, 0);
});

test('quote validation drops non-substring quotes', () => {
  const parsed = parseAskJson(JSON.stringify({
    answer: [
      {
        claim: 'Quote claim',
        citations: [{ doc_id: 'doc_a', chunk_id: 'doc_a::0' }],
        quotes: [
          { doc_id: 'doc_a', chunk_id: 'doc_a::0', quote: 'exact quote phrase' },
          { doc_id: 'doc_a', chunk_id: 'doc_a::0', quote: 'not-present-quote' }
        ]
      }
    ],
    notes: ''
  }));

  const validated = validateAskResponse(parsed, retrieved, { minCitationsOverall: 1 });
  assert.equal(validated.answer.length, 1);
  assert.equal(validated.answer[0].quotes.length, 1);
  assert.equal(validated.answer[0].quotes[0].quote, 'exact quote phrase');
  assert.match(validated.notes, /Some quotes omitted due to validation/);
});

test('parseAskJson accepts JSON wrapped in markdown code fences', () => {
  const wrapped = [
    'Here is the result:',
    '```json',
    '{"answer":[{"claim":"X","citations":[{"doc_id":"doc_a","chunk_id":"doc_a::0"}],"quotes":[]}],"notes":""}',
    '```'
  ].join('\n');
  const parsed = parseAskJson(wrapped);
  assert.equal(Array.isArray(parsed.answer), true);
  assert.equal(parsed.answer.length, 1);
});

test('parseAskJson extracts first balanced JSON object from mixed output', () => {
  const mixed = [
    'Reasoning that should be ignored.',
    '{"answer":[{"claim":"Y","citations":[{"doc_id":"doc_a","chunk_id":"doc_a::0"}],"quotes":[]}],"notes":"ok"}',
    'Trailing text.'
  ].join('\n');
  const parsed = parseAskJson(mixed);
  assert.equal(Array.isArray(parsed.answer), true);
  assert.equal(parsed.answer.length, 1);
  assert.equal(parsed.notes, 'ok');
});

test('parseAskJson accepts minor key drift answers -> answer', () => {
  const parsed = parseAskJson(JSON.stringify({
    answers: [
      {
        claim: 'Recovered claim',
        citations: [{ doc_id: 'doc_a', chunk_id: 'doc_a::0' }],
        quotes: []
      }
    ],
    notes: 'Recovered.'
  }));
  assert.equal(Array.isArray(parsed.answer), true);
  assert.equal(parsed.answer.length, 1);
  assert.equal(parsed.notes, 'Recovered.');
});

test('loose parser + validator accepts prose markers with SOURCES mapping', () => {
  const parsed = parseLooseCitedResponse([
    'Supported statement [1] and another [2].',
    '',
    'SOURCES:',
    '[1] {"doc_id":"doc_a","chunk_id":"doc_a::0"}',
    '[2] {"doc_id":"doc_b","chunk_id":"doc_b::1"}'
  ].join('\n'));

  const validated = validateLooseCitedResponse(parsed, retrieved, { minCitationsOverall: 2 });
  assert.equal(validated.kind, 'loose');
  assert.equal(validated.answerText.includes('[1]'), true);
  assert.equal(validated.citationRefs.length, 2);
  assert.equal(validated.verifiedCitationCount, 2);
});

test('strict validator enforces minimum total citations', () => {
  const parsed = parseAskJson(JSON.stringify({
    answer: [
      {
        claim: 'Single cited claim',
        citations: [{ doc_id: 'doc_a', chunk_id: 'doc_a::0' }]
      }
    ],
    notes: ''
  }));
  const validated = validateAskResponse(parsed, retrieved, { minCitationsOverall: 2 });
  assert.equal(validated.answer.length, 0);
  assert.match(validated.notes, /minimum citation coverage/i);
});

test('loose keeps answer text even when citations missing', () => {
  const parsed = parseLooseCitedResponse('Possible interpretation: The team disagreed, but no markers.');
  const validated = validateLooseCitedResponse(parsed, retrieved, { minCitationsOverall: 2 });
  assert.equal(validated.kind, 'loose');
  assert.equal(validated.answerText.length > 0, true);
  assert.equal(validated.citationRefs.length, 0);
  assert.equal(validated.verifiedCitationCount, 0);
  assert.match(validated.notes, /No verified citations/i);
});

test('loose parser is tolerant to Sources casing and spacing', () => {
  const parsed = parseLooseCitedResponse([
    'Answer with marker [1].',
    '   Sources :   ',
    '[1] {"doc_id":"doc_a","chunk_id":"doc_a::0"}'
  ].join('\n'));
  const validated = validateLooseCitedResponse(parsed, retrieved, { minCitationsOverall: 2 });
  assert.equal(validated.answerText.includes('[1]'), true);
  assert.equal(validated.citationRefs.length, 1);
});
