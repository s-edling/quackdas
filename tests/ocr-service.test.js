const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTesseractCommandCandidates,
  resolveTesseractCommand
} = require('../electron-main/ocr-service');

function createAccessStub(allowedPaths) {
  const allowed = new Set(allowedPaths);
  return {
    constants: { X_OK: 1, F_OK: 0 },
    accessSync(targetPath) {
      if (allowed.has(targetPath)) return;
      const err = new Error(`ENOENT: ${targetPath}`);
      err.code = 'ENOENT';
      throw err;
    }
  };
}

test('resolveTesseractCommand finds Homebrew tesseract when PATH omits /opt/homebrew/bin', () => {
  const fsStub = createAccessStub(['/opt/homebrew/bin/tesseract']);

  const resolved = resolveTesseractCommand({
    fs: fsStub,
    env: { PATH: '/usr/local/bin:/usr/bin:/bin' },
    platform: 'darwin'
  });

  assert.equal(resolved, '/opt/homebrew/bin/tesseract');
});

test('resolveTesseractCommand honors explicit env overrides before common fallbacks', () => {
  const fsStub = createAccessStub(['/custom/tools/tesseract']);

  const resolved = resolveTesseractCommand({
    fs: fsStub,
    env: {
      PATH: '/usr/bin:/bin',
      QUACKDAS_TESSERACT_PATH: '/custom/tools/tesseract'
    },
    platform: 'darwin'
  });

  assert.equal(resolved, '/custom/tools/tesseract');
});

test('buildTesseractCommandCandidates supports env vars that point at a directory', () => {
  const candidates = buildTesseractCommandCandidates({
    env: {
      PATH: '/usr/bin:/bin',
      TESSERACT_PATH: '/custom/tools'
    },
    platform: 'linux'
  });

  assert.ok(candidates.includes('/custom/tools/tesseract'));
});
