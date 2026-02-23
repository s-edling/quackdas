const test = require('node:test');
const assert = require('node:assert/strict');

const { inferModelSizeBillions, getAskModelProfile } = require('../semantic/model-profile');

test('inferModelSizeBillions parses common B model tags', () => {
  assert.equal(inferModelSizeBillions('qwen3:4b'), 4);
  assert.equal(inferModelSizeBillions('gemma2:2b-instruct-q4_K_M'), 2);
  assert.equal(inferModelSizeBillions('llama3.1:8b-instruct'), 8);
});

test('inferModelSizeBillions parses M suffix and unknown safely', () => {
  assert.equal(inferModelSizeBillions('tiny:350m'), 0.35);
  assert.equal(inferModelSizeBillions('unknown-model'), null);
});

test('getAskModelProfile returns small-model defaults for <=4B', () => {
  const profile = getAskModelProfile('qwen3:4b');
  assert.equal(profile.isSmallModel, true);
  assert.equal(profile.recommendedMode, 'loose');
  assert.equal(profile.topK, 4);
  assert.equal(profile.minCitationsOverall, 1);
});

test('getAskModelProfile returns standard defaults for larger/unknown models', () => {
  const large = getAskModelProfile('qwen3:14b');
  assert.equal(large.isSmallModel, false);
  assert.equal(large.recommendedMode, 'strict');
  assert.equal(large.topK, 8);

  const unknown = getAskModelProfile('some-custom-model');
  assert.equal(unknown.isSmallModel, false);
  assert.equal(unknown.recommendedMode, 'strict');
});
