const nodeFs = require('fs');
const nodeOs = require('os');
const nodePath = require('path');

const MAX_OCR_IMAGE_BYTES = 32 * 1024 * 1024;

function getTesseractBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'tesseract.exe' : 'tesseract';
}

function expandHomePath(filePath, homeDir = nodeOs.homedir(), pathModule = nodePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return '';
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return pathModule.join(homeDir, raw.slice(2));
  }
  return raw;
}

function dedupeStrings(values) {
  const seen = new Set();
  const next = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function buildTesseractCommandCandidates(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env || {};
  const pathModule = options.pathModule || nodePath;
  const binaryName = getTesseractBinaryName(platform);

  const explicitHints = [
    env.QUACKDAS_TESSERACT_PATH,
    env.TESSERACT_PATH
  ]
    .map((value) => expandHomePath(value, options.homeDir || nodeOs.homedir(), pathModule))
    .filter(Boolean);

  const pathEntries = String(env.PATH || '')
    .split(pathModule.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);

  const commonDirs = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/opt/homebrew/sbin', '/usr/local/sbin']
    : (platform === 'win32'
      ? [
          'C:\\Program Files\\Tesseract-OCR',
          'C:\\Program Files (x86)\\Tesseract-OCR',
          pathModule.join(String(env.LOCALAPPDATA || ''), 'Programs', 'Tesseract-OCR')
        ]
      : ['/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', '/opt/homebrew/bin']);

  const candidates = [];
  explicitHints.forEach((hint) => {
    candidates.push(hint);
    candidates.push(pathModule.join(hint, binaryName));
  });
  pathEntries.forEach((dir) => candidates.push(pathModule.join(dir, binaryName)));
  commonDirs.filter(Boolean).forEach((dir) => candidates.push(pathModule.join(dir, binaryName)));
  candidates.push(binaryName);
  return dedupeStrings(candidates);
}

function candidateLooksBareCommand(candidate, platform = process.platform) {
  const binaryName = getTesseractBinaryName(platform);
  return candidate === binaryName;
}

function isExecutableCandidate(candidate, fsModule = nodeFs, platform = process.platform) {
  if (!candidate || candidateLooksBareCommand(candidate, platform)) return false;

  const accessMode = platform === 'win32'
    ? (fsModule.constants?.F_OK || 0)
    : (fsModule.constants?.X_OK || fsModule.constants?.F_OK || 0);
  try {
    fsModule.accessSync(candidate, accessMode);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveTesseractCommand(options = {}) {
  const platform = options.platform || process.platform;
  const fsModule = options.fs || nodeFs;
  const candidates = buildTesseractCommandCandidates(options);

  for (const candidate of candidates) {
    if (isExecutableCandidate(candidate, fsModule, platform)) {
      return candidate;
    }
  }

  return getTesseractBinaryName(platform);
}

function registerOcrImageHandler(deps) {
  const {
    ipcMain,
    fs,
    os,
    path,
    execFile,
    formatBytes,
    estimateBase64DecodedBytes
  } = deps;

  ipcMain.handle('ocr:image', async (_evt, payload = {}) => {
    let tmpDir = null;
    const tesseractCommand = resolveTesseractCommand({ fs, env: process.env, platform: process.platform });
    const formatOcrError = (err, stderrText = '') => {
      const stderr = String(stderrText || '').trim();
      const raw = String(err?.message || err || 'Unknown OCR error');

      if (err && err.code === 'ENOENT') {
        return {
          code: 'ENOENT',
          error: 'Tesseract OCR was not found on this machine.'
        };
      }

      if (stderr.includes('Failed loading language')) {
        return {
          code: 'LANG_MISSING',
          error: 'Tesseract could not load one or more OCR language models.'
        };
      }

      if (err && (err.killed || err.signal === 'SIGTERM')) {
        return {
          code: 'TIMEOUT',
          error: 'OCR timed out while processing this page.'
        };
      }

      return {
        code: err?.code || 'OCR_FAILED',
        error: stderr ? `${raw} (${stderr.slice(0, 240)})` : raw
      };
    };

    try {
      const dataUrl = String(payload.dataUrl || '');
      const lang = String(payload.lang || 'eng');
      const psm = Number.isFinite(payload.psm) ? String(payload.psm) : '6';

      if (!dataUrl.startsWith('data:image/png;base64,')) {
        return { ok: false, error: 'Invalid OCR image payload.' };
      }

      const imageBase64 = dataUrl.substring('data:image/png;base64,'.length);
      const estimatedImageBytes = estimateBase64DecodedBytes(imageBase64);
      if (!estimatedImageBytes) {
        return { ok: false, error: 'Invalid OCR image payload.' };
      }
      if (estimatedImageBytes > MAX_OCR_IMAGE_BYTES) {
        return {
          ok: false,
          error: `OCR image is too large (${formatBytes(estimatedImageBytes)}). Maximum supported size is ${formatBytes(MAX_OCR_IMAGE_BYTES)}.`
        };
      }
      const imageBuffer = Buffer.from(imageBase64, 'base64');
      if (!imageBuffer.length || imageBuffer.length > MAX_OCR_IMAGE_BYTES) {
        return {
          ok: false,
          error: `OCR image is too large (${formatBytes(imageBuffer.length)}). Maximum supported size is ${formatBytes(MAX_OCR_IMAGE_BYTES)}.`
        };
      }

      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'quackdas-ocr-'));
      const imgPath = path.join(tmpDir, 'page.png');
      const outBase = path.join(tmpDir, 'ocr');
      const tsvPath = outBase + '.tsv';
      await fs.promises.writeFile(imgPath, imageBuffer);

      const runTesseract = (useLang) => {
        return new Promise((resolve, reject) => {
          execFile(tesseractCommand, [imgPath, outBase, '-l', useLang, '--psm', psm, 'tsv'], {
            windowsHide: true,
            timeout: 120000,
            maxBuffer: 16 * 1024 * 1024
          }, (error, _stdout, stderr) => {
            if (error) {
              const formatted = formatOcrError(error, stderr);
              reject(Object.assign(error, { __ocr: formatted }));
              return;
            }
            resolve();
          });
        });
      };

      try {
        await runTesseract(lang);
      } catch (e) {
        if (lang !== 'eng') await runTesseract('eng');
        else throw e;
      }

      const tsv = await fs.promises.readFile(tsvPath, 'utf8');
      const lines = tsv.split(/\r?\n/);
      const words = [];
      let fullText = '';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split('\t');
        if (cols.length < 12) continue;

        const level = Number(cols[0]);
        const left = Number(cols[6]);
        const top = Number(cols[7]);
        const width = Number(cols[8]);
        const height = Number(cols[9]);
        const conf = Number(cols[10]);
        const text = (cols[11] || '').trim();
        const lineNum = Number(cols[4]);

        if (level !== 5 || !text || width <= 0 || height <= 0) continue;
        if (Number.isFinite(conf) && conf < 15) continue;

        words.push({ text, left, top, width, height, conf, lineNum });
        fullText += (fullText ? ' ' : '') + text;
      }

      return { ok: true, words, text: fullText };
    } catch (err) {
      const normalized = err?.__ocr || formatOcrError(err);
      return {
        ok: false,
        error: normalized.error,
        code: normalized.code
      };
    } finally {
      if (tmpDir) {
        try {
          await fs.promises.rm(tmpDir, { recursive: true, force: true });
        } catch (_) {}
      }
    }
  });
}

module.exports = {
  MAX_OCR_IMAGE_BYTES,
  buildTesseractCommandCandidates,
  registerOcrImageHandler,
  resolveTesseractCommand
};
