const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateObservationPayload
} = require('../electron-main/online-observation.js');

function makePayload(overrides = {}) {
  return Object.assign({
    uuid: 'uuid-1',
    fieldsite: 'Forum',
    url: 'https://example.com/thread',
    timestamp: '2026-03-09T10:00:00.000Z',
    html_filename: 'capture.html',
    screenshot_filename: 'capture.png',
    session_date: '2026-03-09'
  }, overrides);
}

test('validateObservationPayload rejects HTML filenames with directory traversal', () => {
  assert.throws(
    () => validateObservationPayload(makePayload({ html_filename: '../capture.html' })),
    /invalid html_filename/i
  );
});

test('validateObservationPayload rejects screenshot filenames with path separators', () => {
  assert.throws(
    () => validateObservationPayload(makePayload({ screenshot_filename: 'nested/capture.png' })),
    /invalid screenshot_filename/i
  );
});

test('validateObservationPayload accepts plain basenames', () => {
  const validated = validateObservationPayload(makePayload({
    html_filename: 'capture one.html',
    screenshot_filename: 'capture-one.png'
  }));

  assert.equal(validated.html_filename, 'capture one.html');
  assert.equal(validated.screenshot_filename, 'capture-one.png');
});
