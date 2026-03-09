const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateObservationDeletePayload,
  validateObservationPayload
} = require('../electron-main/online-observation-server.js');

function makePayload(overrides = {}) {
  return Object.assign({
    uuid: 'uuid-1',
    fieldsite: 'Forum',
    url: 'https://example.com/thread',
    pageTitle: 'Example thread',
    timestamp: '2026-03-09T10:00:00.000Z',
    sessionDate: '2026-03-09',
    html: '<html><body>snapshot</body></html>'
  }, overrides);
}

test('localhost observation payload accepts note-only updates that preserve existing assets', () => {
  const validated = validateObservationPayload(makePayload({
    html: '',
    preserveExistingAssets: true,
    note: 'Updated note only'
  }));

  assert.equal(validated.html, '');
  assert.equal(validated.preserveExistingAssets, true);
  assert.equal(validated.note, 'Updated note only');
});

test('localhost observation payload still rejects missing HTML for new observations', () => {
  assert.throws(
    () => validateObservationPayload(makePayload({ html: '' })),
    /HTML snapshot is required/i
  );
});

test('localhost observation delete payload accepts valid uuid and fieldsite', () => {
  const validated = validateObservationDeletePayload({
    uuid: 'uuid-1',
    fieldsite: 'Forum'
  });

  assert.deepEqual(validated, {
    uuid: 'uuid-1',
    fieldsite: 'Forum'
  });
});

test('localhost observation delete payload rejects missing required fields', () => {
  assert.throws(
    () => validateObservationDeletePayload({ uuid: 'uuid-1' }),
    /missing required fields/i
  );
});
