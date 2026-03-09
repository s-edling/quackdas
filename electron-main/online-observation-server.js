const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {
  ensureObservationSidecar,
  getObservationSidecarPaths,
  normalizeObservationAssetFileName
} = require('./online-observation');

const DEFAULT_PORT = 45823;
const MAX_JSON_BYTES = 24 * 1024 * 1024;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function createObservationServer({ getProjectPath, getAuthToken, getFieldsites, getHistory, onEntry, onDelete }) {
  let server = null;
  let lastError = null;
  let port = DEFAULT_PORT;

  async function start() {
    if (server) return getStatus();

    await new Promise((resolve) => {
      const nextServer = http.createServer((req, res) => {
        handleRequest(req, res).catch((error) => {
          sendJson(res, 500, { ok: false, error: error?.message || String(error) });
        });
      });

      nextServer.on('error', (error) => {
        lastError = error;
        resolve();
      });

      nextServer.listen(DEFAULT_PORT, '127.0.0.1', () => {
        server = nextServer;
        port = DEFAULT_PORT;
        lastError = null;
        resolve();
      });
    });

    return getStatus();
  }

  async function stop() {
    if (!server) return;
    const current = server;
    server = null;
    await new Promise((resolve) => current.close(() => resolve()));
  }

  function getStatus() {
    const projectPath = normalizePath(getProjectPath());
    return {
      running: !!server,
      port,
      serverUrl: `http://127.0.0.1:${port}`,
      activeProjectPath: projectPath,
      hasActiveProject: !!projectPath,
      error: lastError ? (lastError.message || String(lastError)) : ''
    };
  }

  async function handleRequest(req, res) {
    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!isLoopbackRequest(req.socket?.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: 'Loopback requests only.' });
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!isAuthorizedRequest(req, getAuthToken)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return;
      }
      const status = getStatus();
      sendJson(res, 200, {
        ok: true,
        running: status.running,
        serverUrl: status.serverUrl,
        hasActiveProject: status.hasActiveProject,
        activeProjectFileName: status.activeProjectPath ? path.basename(status.activeProjectPath) : '',
        activeProjectPath: status.activeProjectPath
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/fieldsites') {
      if (!isAuthorizedRequest(req, getAuthToken)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return;
      }
      const projectPath = normalizePath(getProjectPath());
      if (!projectPath) {
        sendJson(res, 409, { ok: false, error: 'No saved project is open in Quackdas.' });
        return;
      }
      const fieldsites = await readObservationFieldsites(projectPath, getFieldsites);
      sendJson(res, 200, { ok: true, fieldsites });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      if (!isAuthorizedRequest(req, getAuthToken)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return;
      }
      const projectPath = normalizePath(getProjectPath());
      if (!projectPath) {
        sendJson(res, 409, { ok: false, error: 'No saved project is open in Quackdas.' });
        return;
      }
      const fieldsite = String(url.searchParams.get('fieldsite') || '').trim();
      if (!fieldsite) {
        sendJson(res, 400, { ok: false, error: 'Fieldsite is required.' });
        return;
      }
      const history = await readObservationHistory(projectPath, fieldsite, getHistory);
      sendJson(res, 200, Object.assign({ ok: true }, history));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/observation') {
      if (!isAuthorizedRequest(req, getAuthToken)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return;
      }
      const projectPath = normalizePath(getProjectPath());
      if (!projectPath) {
        sendJson(res, 409, { ok: false, error: 'No saved project is open in Quackdas.' });
        return;
      }
      const body = await readJsonBody(req, MAX_JSON_BYTES);
      const entry = await ingestObservation(projectPath, body);
      sendJson(res, 200, { ok: true, entry });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/observation/delete') {
      if (!isAuthorizedRequest(req, getAuthToken)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return;
      }
      const projectPath = normalizePath(getProjectPath());
      if (!projectPath) {
        sendJson(res, 409, { ok: false, error: 'No saved project is open in Quackdas.' });
        return;
      }
      const body = await readJsonBody(req, 64 * 1024);
      const deleted = await deleteObservation(projectPath, body);
      sendJson(res, 200, { ok: true, entry: deleted });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  }

  async function ingestObservation(projectPath, rawPayload) {
    const payload = validateObservationPayload(rawPayload);
    const sidecar = await ensureObservationSidecar(projectPath);
    const htmlFilename = payload.html
      ? normalizeObservationAssetFileName(`${payload.uuid}.html`, 'uuid')
      : '';
    const screenshotFilename = payload.imageBase64
      ? normalizeObservationAssetFileName(`${payload.uuid}.png`, 'uuid')
      : '';
    if (htmlFilename) {
      const htmlTargetPath = path.join(sidecar.htmlDir, htmlFilename);
      writeAtomically(htmlTargetPath, Buffer.from(payload.html, 'utf8'));
    }

    let screenshotRelativePath = '';
    if (screenshotFilename) {
      const imageTargetPath = path.join(sidecar.screenshotsDir, screenshotFilename);
      writeAtomically(imageTargetPath, decodeBase64(payload.imageBase64, MAX_IMAGE_BYTES, 'Screenshot image'));
      screenshotRelativePath = path.posix.join('screenshots', screenshotFilename);
    }

    const entry = {
      uuid: payload.uuid,
      fieldsite: payload.fieldsite,
      url: payload.url,
      pageTitle: payload.pageTitle,
      timestamp: payload.timestamp,
      note: payload.note,
      sessionDate: payload.sessionDate,
      sessionStartedAt: payload.sessionStartedAt,
      sessionHeading: payload.sessionHeading,
      screenshotPath: screenshotRelativePath,
      htmlPath: htmlFilename ? path.posix.join('html', htmlFilename) : ''
    };

    if (typeof onEntry === 'function') {
      await Promise.resolve(onEntry({
        entry,
        projectPath,
        sidecarPaths: sidecar
      }));
    }

    return entry;
  }

  async function deleteObservation(projectPath, rawPayload) {
    const payload = validateObservationDeletePayload(rawPayload);
    const rawHistory = await Promise.resolve(
      typeof getHistory === 'function'
        ? getHistory(payload.fieldsite)
        : { fieldsite: payload.fieldsite, entries: [], lastSession: null, activeSessionStartedAt: '' }
    );
    const history = normalizeHistoryPayload(rawHistory, payload.fieldsite);
    const entry = (history.entries || []).find((item) => String(item.uuid || '').trim() === payload.uuid);
    if (!entry) {
      throw new Error('Observation entry could not be found.');
    }

    const sidecarPaths = getObservationSidecarPaths(projectPath);
    await deleteObservationAsset(sidecarPaths.rootDir, entry.htmlPath);
    await deleteObservationAsset(sidecarPaths.rootDir, entry.screenshotPath);

    if (typeof onDelete === 'function') {
      await Promise.resolve(onDelete({
        entry,
        projectPath,
        sidecarPaths
      }));
    }

    return {
      uuid: entry.uuid,
      fieldsite: entry.fieldsite,
      sessionStartedAt: entry.sessionStartedAt
    };
  }

  return {
    start,
    stop,
    getStatus
  };
}

function normalizePath(value) {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

function normalizeSidecarRelativePath(value) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return '';
  return normalized;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function isLoopbackRequest(remoteAddress) {
  const value = String(remoteAddress || '');
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function isAuthorizedRequest(req, getAuthToken) {
  const authHeader = String(req.headers?.authorization || '');
  const expected = String(typeof getAuthToken === 'function' ? getAuthToken() : '').trim();
  if (!expected) return false;
  return authHeader === `Bearer ${expected}`;
}

async function readObservationFieldsites(projectPath, getFieldsites) {
  const liveFieldsites = await Promise.resolve(
    typeof getFieldsites === 'function' ? getFieldsites() : []
  );
  if (Array.isArray(liveFieldsites) && liveFieldsites.length > 0) {
    return Array.from(new Set(liveFieldsites.map((name) => String(name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }
  return listProjectFieldsites(projectPath);
}

async function readObservationHistory(projectPath, fieldsite, getHistory) {
  const rawHistory = await Promise.resolve(
    typeof getHistory === 'function'
      ? getHistory(fieldsite)
      : { fieldsite, entries: [], lastSession: null, activeSessionStartedAt: '' }
  );
  const history = normalizeHistoryPayload(rawHistory, fieldsite);
  const sidecarPaths = getObservationSidecarPaths(projectPath);
  for (const entry of history.entries) {
    if (!entry.html) {
      entry.html = await readHistoryHtml(sidecarPaths.rootDir, entry.htmlPath);
    }
    if (!entry.imageDataUrl) {
      entry.imageDataUrl = await readHistoryScreenshotDataUrl(sidecarPaths.rootDir, entry.screenshotPath);
    }
  }
  return history;
}

function normalizeHistoryPayload(rawHistory, fallbackFieldsite) {
  const payload = (rawHistory && typeof rawHistory === 'object') ? rawHistory : {};
  const fieldsite = String(payload.fieldsite || fallbackFieldsite || '').trim();
  const entries = Array.isArray(payload.entries) ? payload.entries.map((entry) => normalizeHistoryEntry(entry, fieldsite)) : [];
  return {
    fieldsite,
    entries,
    lastSession: normalizeHistoryLastSession(payload.lastSession),
    activeSessionStartedAt: String(payload.activeSessionStartedAt || '').trim()
  };
}

function normalizeHistoryEntry(rawEntry, fallbackFieldsite) {
  const entry = (rawEntry && typeof rawEntry === 'object') ? rawEntry : {};
  return {
    uuid: String(entry.uuid || '').trim(),
    fieldsite: String(entry.fieldsite || fallbackFieldsite || '').trim(),
    url: String(entry.url || '').trim(),
    pageTitle: String(entry.pageTitle || '').trim(),
    timestamp: String(entry.timestamp || '').trim(),
    note: String(entry.note || ''),
    imageDataUrl: String(entry.imageDataUrl || '').trim(),
    screenshotPath: normalizeSidecarRelativePath(entry.screenshotPath),
    metadataVisible: !!entry.metadataVisible,
    html: String(entry.html || ''),
    htmlPath: normalizeSidecarRelativePath(entry.htmlPath),
    sessionDate: String(entry.sessionDate || '').trim(),
    sessionStartedAt: String(entry.sessionStartedAt || '').trim(),
    sessionHeading: !!entry.sessionHeading,
    sessionNumber: Number.isFinite(Number(entry.sessionNumber)) ? Number(entry.sessionNumber) : 1,
    sessionHeadingLabel: String(entry.sessionHeadingLabel || '').trim()
  };
}

function normalizeHistoryLastSession(rawLastSession) {
  if (!rawLastSession || typeof rawLastSession !== 'object') return null;
  const sessionStartedAt = String(rawLastSession.sessionStartedAt || '').trim();
  const sessionDate = String(rawLastSession.sessionDate || '').trim();
  const lastCaptureAt = String(rawLastSession.lastCaptureAt || '').trim();
  if (!sessionStartedAt && !sessionDate && !lastCaptureAt) return null;
  return {
    sessionDate,
    lastCaptureAt,
    sessionStartedAt,
    sessionNumber: Number.isFinite(Number(rawLastSession.sessionNumber)) ? Number(rawLastSession.sessionNumber) : 1
  };
}

async function readHistoryHtml(sidecarRoot, relativePath) {
  const normalized = normalizeSidecarRelativePath(relativePath);
  if (!normalized) return '';
  const absolutePath = path.join(sidecarRoot, normalized);
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    if (buffer.length > MAX_HTML_BYTES) return '';
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  }
}

async function readHistoryScreenshotDataUrl(sidecarRoot, relativePath) {
  const normalized = normalizeSidecarRelativePath(relativePath);
  if (!normalized) return '';
  const absolutePath = path.join(sidecarRoot, normalized);
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    if (buffer.length > MAX_IMAGE_BYTES) return '';
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch (_) {
    return '';
  }
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body is too large. Maximum supported size is ${formatBytes(maxBytes)}.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('Request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function validateObservationPayload(rawPayload) {
  const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};
  const uuid = String(payload.uuid || '').trim();
  const fieldsite = String(payload.fieldsite || '').trim();
  const url = String(payload.url || '').trim();
  const pageTitle = String(payload.pageTitle || payload.page_title || url).trim();
  const timestamp = String(payload.timestamp || '').trim();
  const sessionDate = String(payload.sessionDate || payload.session_date || '').trim();
  const sessionStartedAt = String(payload.sessionStartedAt || payload.session_started_at || '').trim();
  const note = String(payload.note || '');
  const html = String(payload.html || '');
  const imageBase64 = String(payload.imageBase64 || '');
  const preserveExistingAssets = !!payload.preserveExistingAssets;

  if (!uuid || !fieldsite || !url || !timestamp || !sessionDate) {
    throw new Error('Observation payload is missing required fields.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(uuid)) {
    throw new Error('Observation payload contains an invalid uuid.');
  }
  if (!html && !preserveExistingAssets) {
    throw new Error('Observation HTML snapshot is required.');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new Error(`HTML snapshot is too large. Maximum supported size is ${formatBytes(MAX_HTML_BYTES)}.`);
  }

  return {
    uuid,
    fieldsite,
    url,
    pageTitle,
    timestamp,
    sessionDate,
    sessionStartedAt,
    sessionHeading: !!payload.sessionHeading || !!payload.session_heading,
    note,
    html,
    imageBase64,
    preserveExistingAssets
  };
}

function validateObservationDeletePayload(rawPayload) {
  const payload = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};
  const uuid = String(payload.uuid || '').trim();
  const fieldsite = String(payload.fieldsite || '').trim();
  if (!uuid || !fieldsite) {
    throw new Error('Observation delete payload is missing required fields.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(uuid)) {
    throw new Error('Observation delete payload contains an invalid uuid.');
  }
  return { uuid, fieldsite };
}

async function deleteObservationAsset(sidecarRoot, relativePath) {
  const normalized = normalizeSidecarRelativePath(relativePath);
  if (!normalized) return;
  const absolutePath = path.join(sidecarRoot, normalized);
  try {
    await fs.promises.unlink(absolutePath);
  } catch (_) {}
}

function decodeBase64(value, maxBytes, label) {
  const base64 = String(value || '').trim().replace(/\s+/g, '');
  if (!base64) return Buffer.alloc(0);
  if ((base64.length % 4) !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new Error(`${label} is not valid base64 data.`);
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error(`${label} is not valid base64 data.`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`${label} is too large (${formatBytes(buffer.length)}). Maximum supported size is ${formatBytes(maxBytes)}.`);
  }
  return buffer;
}

function writeAtomically(targetPath, buffer) {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, targetPath);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const precision = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[idx]}`;
}

function listProjectFieldsites(projectFilePath) {
  try {
    const buffer = fs.readFileSync(projectFilePath);
    const entries = unzipEntries(buffer);
    const projectXml = entries['project.qde'];
    if (!projectXml) return [];
    const sourceNames = [];
    const sourceRegex = /<TextSource\b([^>]*)\/?>/g;
    let match;
    while ((match = sourceRegex.exec(projectXml))) {
      const attrs = String(match[1] || '');
      const docTypeMatch = attrs.match(/\bquackdasDocType="([^"]+)"/);
      const fieldnotePathMatch = attrs.match(/\bquackdasFieldnotePath="([^"]+)"/);
      const isFieldnote = (docTypeMatch && decodeXmlEntities(docTypeMatch[1]).trim() === 'fieldnote') || !!fieldnotePathMatch;
      if (!isFieldnote) continue;
      const nameMatch = attrs.match(/\bname="([^"]+)"/);
      if (!nameMatch) continue;
      const name = decodeXmlEntities(nameMatch[1]);
      if (name) sourceNames.push(name);
    }
    return Array.from(new Set(sourceNames)).sort((a, b) => a.localeCompare(b));
  } catch (_) {
    return [];
  }
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function unzipEntries(buffer) {
  const entries = {};
  let offset = 0;

  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.slice(offset + 30, offset + 30 + fileNameLength).toString('utf8');
    const dataStart = offset + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const fileData = buffer.slice(dataStart, dataEnd);

    if (!fileName.endsWith('/')) {
      const content = compressionMethod === 0
        ? fileData
        : compressionMethod === 8
          ? zlib.inflateRawSync(fileData)
          : null;
      if (content) {
        entries[fileName] = content.toString('utf8');
      }
    }

    offset = dataEnd;
  }

  return entries;
}

module.exports = {
  DEFAULT_PORT,
  createObservationServer,
  validateObservationDeletePayload,
  validateObservationPayload
};
