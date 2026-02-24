
const { app, BrowserWindow, dialog, Menu, ipcMain, shell } = require('electron');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL, fileURLToPath } = require('url');
const { SEMANTIC_DEFAULTS } = require('./semantic/config');
const { canonicalizeText, getDocumentTextHash } = require('./semantic/text');
const { openSemanticStore } = require('./semantic/store');
const { listModels, isOllamaReachable, embedText, OllamaError, assertLocalOllamaBaseUrl } = require('./semantic/ollama-embeddings');
const { getAskModelProfile } = require('./semantic/model-profile');

let win;
let currentProjectPath = null;
let isQuitting = false;
let semanticAvailabilityCache = null;
let semanticAvailabilityCheckedAt = 0;
let tesseractInstalledCache = null;
let tesseractInstalledCheckedAt = 0;
const semanticIndexJobsByWebContents = new Map();
const semanticAskJobsByWebContents = new Map();

const BACKUP_MAX_RECENT = 20;
const BACKUP_DAILY_DAYS = 14;
const BACKUP_DIR_NAME = 'project-backups';
const LAST_PROJECT_FILE = 'last-project-path.json';
const MAX_QDPX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_DOCUMENT_FILE_BYTES = 256 * 1024 * 1024; // 256 MB
const MAX_OCR_IMAGE_BYTES = 32 * 1024 * 1024; // 32 MB
const TESSERACT_STATUS_CACHE_MS = 60 * 1000;
const WORKER_TERMINATE_GRACE_MS = 1500;

/*
 * IMPORTANT: macOS quit behaviour
 * 
 * On macOS, the standard pattern is to hide the window when the user closes it (red button)
 * and only fully quit when the user explicitly quits (Cmd+Q or menu).
 * 
 * The `close` event handler hides the window instead of closing it (unless isQuitting is true).
 * 
 * To reliably quit, the menu quit handler uses win.destroy() BEFORE app.quit().
 * This bypasses the close event entirely, avoiding any race conditions or event ordering issues.
 * 
 * If you add new quit paths, use this pattern:
 *   if (win) { win.destroy(); win = null; }
 *   app.quit();
 * 
 * Do NOT rely solely on setting isQuitting=true before app.quit() - the event ordering
 * is not guaranteed and can cause the close handler to hide instead of quit.
 */

// Ensure macOS menus show the correct app name
try { app.setName('Quackdas'); } catch {}
const isMac = process.platform === 'darwin';

function sanitizeName(name, fallback = 'untitled-project') {
  return String(name || fallback)
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || fallback;
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

function ellipsizeText(text, maxChars = 20) {
  const raw = String(text || '');
  if (raw.length <= maxChars) return raw;
  if (maxChars <= 1) return raw.slice(0, maxChars);
  return `${raw.slice(0, maxChars - 1)}…`;
}

function buildWindowTitleForPath(projectPath) {
  const base = path.basename(String(projectPath || ''), path.extname(String(projectPath || '')));
  const visible = ellipsizeText(base || 'Untitled', 20);
  return `${visible} - Quackdas`;
}

function updateWindowTitle() {
  if (!win || win.isDestroyed()) return;
  if (!currentProjectPath) {
    win.setTitle('Quackdas - Qualitative coding');
    return;
  }
  win.setTitle(buildWindowTitleForPath(currentProjectPath));
}

function destroyMainWindowForQuit() {
  if (!win) return;
  const targetWindow = win;
  if (targetWindow.isDestroyed()) {
    if (win === targetWindow) win = null;
    return;
  }
  try {
    targetWindow.destroy();
  } catch (_) {}
  if (win === targetWindow && targetWindow.isDestroyed()) {
    win = null;
  }
}

function sendMenuActionToRenderer(action) {
  if (!win || win.isDestroyed()) return;
  const wc = win.webContents;
  safeSendToWebContents(wc, 'menu:action', action);
}

function safeSendToWebContents(webContents, channel, payload) {
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    if (typeof payload === 'undefined') {
      webContents.send(channel);
    } else {
      webContents.send(channel, payload);
    }
    return true;
  } catch (_) {
    return false;
  }
}

function isAllowedAppNavigationUrl(targetUrl) {
  try {
    const parsed = new URL(String(targetUrl || ''));
    if (parsed.protocol !== 'file:') return false;
    const targetPath = path.resolve(fileURLToPath(parsed));
    const appIndexPath = path.resolve(path.join(__dirname, 'index.html'));
    return targetPath === appIndexPath;
  } catch (_) {
    return false;
  }
}

function maybeOpenExternalHttpUrl(targetUrl) {
  try {
    const parsed = new URL(String(targetUrl || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(parsed.toString()).catch(() => {});
    }
  } catch (_) {}
}

function estimateBase64DecodedBytes(base64Value) {
  const base64 = String(base64Value || '');
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function decodeBase64PayloadOrThrow(base64Value, maxBytes, label) {
  const raw = String(base64Value || '').trim();
  const normalized = raw.replace(/\s+/g, '');
  if (!normalized) {
    throw new Error(`${label} is missing.`);
  }
  if ((normalized.length % 4) !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`${label} is not valid base64 data.`);
  }
  const estimatedBytes = estimateBase64DecodedBytes(normalized);
  if (!estimatedBytes) {
    throw new Error(`${label} is not valid base64 data.`);
  }
  if (estimatedBytes > maxBytes) {
    throw new Error(`${label} is too large (${formatBytes(estimatedBytes)}). Maximum supported size is ${formatBytes(maxBytes)}.`);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length) {
    throw new Error(`${label} is not valid base64 data.`);
  }
  if (buffer.length > maxBytes) {
    throw new Error(`${label} is too large (${formatBytes(buffer.length)}). Maximum supported size is ${formatBytes(maxBytes)}.`);
  }
  return buffer;
}

async function ensureFileWithinLimit(filePath, maxBytes, label) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a regular file.`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`${label} is too large (${formatBytes(stat.size)}). Maximum supported size is ${formatBytes(maxBytes)}.`);
  }
}

function getLastProjectPathFile() {
  return path.join(app.getPath('userData'), LAST_PROJECT_FILE);
}

async function persistLastProjectPath(projectPath) {
  try {
    const payload = { path: projectPath || null, updatedAt: new Date().toISOString() };
    await fs.promises.writeFile(getLastProjectPathFile(), JSON.stringify(payload), 'utf8');
  } catch (_) {}
}

async function readLastProjectPath() {
  try {
    const raw = await fs.promises.readFile(getLastProjectPathFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const p = parsed && typeof parsed.path === 'string' ? parsed.path : null;
    return p || null;
  } catch (_) {
    return null;
  }
}

function getBackupRootDir() {
  return path.join(app.getPath('userData'), BACKUP_DIR_NAME);
}

function getBackupBucket(projectName = 'untitled-project') {
  if (currentProjectPath) {
    const abs = path.resolve(currentProjectPath);
    const hash = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 12);
    const base = sanitizeName(path.basename(abs, path.extname(abs)), 'project');
    return `${hash}-${base}`;
  }
  return `unsaved-${sanitizeName(projectName, 'untitled-project')}`;
}

function parseBackupReason(fileName) {
  const base = fileName.replace(/\.qdpx$/i, '');
  const parts = base.split('__');
  return parts[1] ? parts[1].replace(/-/g, ' ') : 'auto backup';
}

function makeBackupFileName(reason = 'auto-backup') {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const safeReason = sanitizeName(reason, 'auto-backup');
  return `${stamp}__${safeReason}.qdpx`;
}

async function pruneBackups(backupDir) {
  const names = await fs.promises.readdir(backupDir);
  const qdpxNames = names.filter(n => /\.qdpx$/i.test(n));
  const rows = await Promise.all(qdpxNames.map(async (name) => {
    const fullPath = path.join(backupDir, name);
    const stat = await fs.promises.stat(fullPath);
    return { name, fullPath, mtimeMs: stat.mtimeMs };
  }));
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keep = new Set();
  rows.slice(0, BACKUP_MAX_RECENT).forEach(r => keep.add(r.name));

  const now = Date.now();
  const maxAgeMs = BACKUP_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const keptByDay = new Set();

  for (const row of rows.slice(BACKUP_MAX_RECENT)) {
    const age = now - row.mtimeMs;
    if (age > maxAgeMs) continue;
    const dayKey = new Date(row.mtimeMs).toISOString().slice(0, 10);
    if (keptByDay.has(dayKey)) continue;
    keep.add(row.name);
    keptByDay.add(dayKey);
  }

  const deletes = rows.filter(r => !keep.has(r.name));
  await Promise.all(deletes.map(r => fs.promises.unlink(r.fullPath).catch(() => {})));
}

async function listBackupsForBucket(projectName) {
  const bucket = getBackupBucket(projectName);
  const backupDir = path.join(getBackupRootDir(), bucket);
  let names = [];
  try {
    names = await fs.promises.readdir(backupDir);
  } catch (_) {
    return { ok: true, backups: [] };
  }
  const qdpxNames = names.filter(n => /\.qdpx$/i.test(n));
  const backups = await Promise.all(qdpxNames.map(async (name) => {
    const fullPath = path.join(backupDir, name);
    const stat = await fs.promises.stat(fullPath);
    return {
      id: name,
      createdAt: new Date(stat.mtimeMs).toISOString(),
      sizeBytes: stat.size,
      reason: parseBackupReason(name)
    };
  }));
  backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { ok: true, backups };
}

function clearSemanticAvailabilityCache() {
  semanticAvailabilityCache = null;
  semanticAvailabilityCheckedAt = 0;
}

function getSemanticIndexRootDir() {
  return path.join(app.getPath('userData'), 'Indexes');
}

function getLegacySemanticDbPath(projectPath) {
  const project = String(projectPath || '').trim();
  if (!project) return '';
  const base = path.basename(project, path.extname(project));
  return path.join(path.dirname(project), `${base}.semantic.sqlite`);
}

function getManagedSemanticDbPath(projectPath) {
  const project = String(projectPath || '').trim();
  if (!project) return '';
  const resolved = path.resolve(project);
  const base = path.basename(resolved, path.extname(resolved));
  const safeBase = sanitizeName(base, 'project');
  const hash = crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 16);
  return path.join(getSemanticIndexRootDir(), `${safeBase}-${hash}.semantic.sqlite`);
}

function moveFileIfPresent(fromPath, toPath) {
  if (!fromPath || !toPath) return;
  if (!fs.existsSync(fromPath)) return;
  try {
    fs.renameSync(fromPath, toPath);
    return;
  } catch (_) {
    try {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
    } catch (_) {}
  }
}

function migrateLegacySemanticDbIfNeeded(projectPath, managedPath) {
  if (!projectPath || !managedPath) return;
  const legacyPath = getLegacySemanticDbPath(projectPath);
  if (!legacyPath || legacyPath === managedPath) return;
  if (!fs.existsSync(legacyPath)) return;
  if (fs.existsSync(managedPath)) return;
  try {
    fs.mkdirSync(path.dirname(managedPath), { recursive: true });
  } catch (_) {
    return;
  }
  moveFileIfPresent(legacyPath, managedPath);
  moveFileIfPresent(`${legacyPath}-wal`, `${managedPath}-wal`);
  moveFileIfPresent(`${legacyPath}-shm`, `${managedPath}-shm`);
}

function getSemanticDbPath() {
  if (!currentProjectPath) return null;
  const managedPath = getManagedSemanticDbPath(currentProjectPath);
  migrateLegacySemanticDbIfNeeded(currentProjectPath, managedPath);
  return managedPath;
}

function getProjectSemanticModelName(dbPath) {
  if (!dbPath) return SEMANTIC_DEFAULTS.embeddingModel;
  const store = openSemanticStore(dbPath);
  try {
    const stored = store.getMeta('embedding_model_name');
    return stored || SEMANTIC_DEFAULTS.embeddingModel;
  } finally {
    store.close();
  }
}

function getProjectGenerationModelName(dbPath, availableModels = []) {
  const models = Array.isArray(availableModels) ? availableModels : [];
  const store = dbPath ? openSemanticStore(dbPath) : null;
  try {
    const stored = store ? String(store.getMeta('generation_model_name') || '').trim() : '';
    if (stored) {
      const matched = findBestInstalledModel(stored, models);
      if (matched || models.length === 0) return matched || stored;
    }
    return selectDefaultGenerationModel(models);
  } finally {
    if (store) store.close();
  }
}

function splitModelNameTag(modelName) {
  const raw = String(modelName || '').trim();
  if (!raw) return { base: '', tag: '' };
  const idx = raw.indexOf(':');
  if (idx === -1) return { base: raw, tag: '' };
  return {
    base: raw.slice(0, idx),
    tag: raw.slice(idx + 1)
  };
}

function modelNameMatches(requestedModel, installedModel) {
  const requested = splitModelNameTag(String(requestedModel || '').toLowerCase());
  const installed = splitModelNameTag(String(installedModel || '').toLowerCase());
  if (!requested.base || !installed.base) return false;
  if (requested.base !== installed.base) return false;
  if (!requested.tag) return true; // "bge-m3" matches "bge-m3" and "bge-m3:*"
  if (requested.tag === installed.tag) return true;
  if (installed.tag.startsWith(`${requested.tag}-`)) return true; // qwen2.5:7b -> qwen2.5:7b-instruct-*
  if (installed.tag.startsWith(`${requested.tag}.`)) return true;
  if (requested.tag === 'latest') return true;
  return false;
}

function findBestInstalledModel(requestedModel, installedModels) {
  const models = Array.isArray(installedModels) ? installedModels : [];
  if (!requestedModel) return '';
  const requestedRaw = String(requestedModel).trim();
  const exact = models.find((name) => String(name).trim() === requestedRaw)
    || models.find((name) => String(name).trim().toLowerCase() === requestedRaw.toLowerCase());
  if (exact) return exact;
  const prefixed = models.find((name) => modelNameMatches(requestedModel, name));
  return prefixed || '';
}

function selectDefaultGenerationModel(installedModels) {
  const models = (Array.isArray(installedModels) ? installedModels : []).filter(Boolean);
  if (models.length === 0) return '';

  const qwenModels = models.filter((name) => splitModelNameTag(name).base === 'qwen3');
  if (qwenModels.length > 0) {
    const qwen4b = qwenModels.find((name) => name.toLowerCase() === 'qwen3:4b');
    if (qwen4b) return qwen4b;
    const withSize = qwenModels.map((name) => {
      const tag = splitModelNameTag(name).tag.toLowerCase();
      const m = tag.match(/([0-9]+(?:\\.[0-9]+)?)b/);
      return { name, size: m ? Number(m[1]) : Number.POSITIVE_INFINITY };
    }).sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
    return withSize[0].name;
  }

  const qwen25Models = models.filter((name) => splitModelNameTag(name).base === 'qwen2.5');
  if (qwen25Models.length > 0) {
    const qwen25_7b = qwen25Models.find((name) => String(name).toLowerCase().startsWith('qwen2.5:7b'));
    if (qwen25_7b) return qwen25_7b;
    return qwen25Models[0];
  }

  return models[0];
}

async function resolveSemanticModelAvailability(preferredModel) {
  const reachable = await isOllamaReachable(SEMANTIC_DEFAULTS.ollamaBaseUrl, {
    timeoutMs: SEMANTIC_DEFAULTS.ollamaTimeoutMs
  });
  if (!reachable) {
    return {
      reachable: false,
      available: false,
      configuredModel: preferredModel,
      selectedModel: '',
      fallbackUsed: false,
      modelReady: false,
      models: [],
      error: 'Ollama is not reachable on http://localhost:11434.'
    };
  }

  const models = await listModels(SEMANTIC_DEFAULTS.ollamaBaseUrl, {
    timeoutMs: SEMANTIC_DEFAULTS.ollamaTimeoutMs
  });
  const dbPath = getSemanticDbPath();
  const configured = String(preferredModel || SEMANTIC_DEFAULTS.embeddingModel);
  const selectedConfigured = findBestInstalledModel(configured, models);
  const selectedFallback = findBestInstalledModel(SEMANTIC_DEFAULTS.fallbackEmbeddingModel, models);
  const selectedModel = selectedConfigured || selectedFallback || '';
  const modelReady = !!selectedModel;
  const selectedGenerationModel = getProjectGenerationModelName(dbPath, models);

  if (!modelReady) {
    return {
      reachable: true,
      available: true,
      configuredModel: configured,
      selectedModel: '',
      fallbackUsed: false,
      modelReady: false,
      generationModel: selectedGenerationModel,
      models,
      error: `No embedding model found. Pull one locally (e.g. ollama pull ${configured}).`
    };
  }

  return {
    reachable: true,
    available: true,
    configuredModel: configured,
    selectedModel,
    fallbackUsed: !!selectedFallback && selectedModel === selectedFallback && selectedModel !== selectedConfigured,
    modelReady: true,
    generationModel: selectedGenerationModel,
    models,
    error: ''
  };
}

async function getSemanticAvailability({ force = false } = {}) {
  const now = Date.now();
  if (!force && semanticAvailabilityCache && (now - semanticAvailabilityCheckedAt) < SEMANTIC_DEFAULTS.availabilityCacheMs) {
    return semanticAvailabilityCache;
  }
  const dbPath = getSemanticDbPath();
  const configuredModel = getProjectSemanticModelName(dbPath);
  const availability = await resolveSemanticModelAvailability(configuredModel);
  semanticAvailabilityCache = availability;
  semanticAvailabilityCheckedAt = now;
  return availability;
}

function toSemanticDocuments(payloadDocs) {
  const docs = Array.isArray(payloadDocs) ? payloadDocs : [];
  return docs
    .filter((doc) => doc && typeof doc === 'object' && doc.id)
    .map((doc) => ({
      id: String(doc.id),
      title: String(doc.title || 'Untitled document'),
      type: String(doc.type || 'text'),
      content: canonicalizeText(doc.content || '')
    }))
    .filter((doc) => doc.type !== 'pdf');
}

function runSemanticSearchWorker({ dbPath, modelName, queryEmbedding, queryText, topK, candidateK }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'semantic', 'search-worker.js'), {
      workerData: {
        dbPath,
        modelName,
        queryEmbedding: Array.isArray(queryEmbedding) ? queryEmbedding : [],
        queryText: String(queryText || ''),
        topK,
        candidateK
      }
    });

    let settled = false;

    worker.on('message', (msg) => {
      if (settled || !msg || typeof msg !== 'object') return;
      if (msg.type === 'done') {
        settled = true;
        resolve(msg.payload || { results: [] });
        return;
      }
      if (msg.type === 'error') {
        settled = true;
        const payload = msg.payload || {};
        const err = new Error(String(payload.message || 'Semantic search failed.'));
        err.code = String(payload.code || 'SEARCH_FAILED');
        reject(err);
      }
    });

    worker.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    worker.on('exit', (code) => {
      if (settled) return;
      settled = true;
      const err = new Error(code === 0
        ? 'Semantic search worker exited before returning a result.'
        : `Semantic search worker exited with code ${code}.`);
      err.code = 'SEARCH_WORKER_EXIT';
      reject(err);
    });
  });
}

function stopSemanticIndexJob(webContentsId) {
  const job = semanticIndexJobsByWebContents.get(webContentsId);
  if (!job) return false;
  job.status = 'cancelling';
  try {
    job.worker.postMessage({ type: 'cancel' });
  } catch (_) {}
  if (!job.terminateTimer) {
    const timer = globalThis.setTimeout(() => {
      try {
        Promise.resolve(job.worker.terminate()).catch(() => {});
      } catch (_) {}
    }, WORKER_TERMINATE_GRACE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    job.terminateTimer = timer;
  }
  return true;
}

function getSemanticIndexingState(webContentsId) {
  const job = semanticIndexJobsByWebContents.get(webContentsId);
  if (!job) return null;
  return {
    startedAt: job.startedAt,
    status: job.status,
    progress: Object.assign({}, job.progress || {})
  };
}

function stopSemanticAskJob(webContentsId) {
  const job = semanticAskJobsByWebContents.get(webContentsId);
  if (!job) return false;
  job.status = 'cancelling';
  try {
    job.worker.postMessage({ type: 'cancel' });
  } catch (_) {}
  if (!job.terminateTimer) {
    const timer = globalThis.setTimeout(() => {
      try {
        Promise.resolve(job.worker.terminate()).catch(() => {});
      } catch (_) {}
    }, WORKER_TERMINATE_GRACE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    job.terminateTimer = timer;
  }
  return true;
}

function getSemanticAskState(webContentsId) {
  const job = semanticAskJobsByWebContents.get(webContentsId);
  if (!job) return null;
  return {
    startedAt: job.startedAt,
    status: job.status,
    generationModel: job.generationModel || '',
    question: job.question || ''
  };
}


function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const windowRef = win;
  const webContents = windowRef.webContents;
  const webContentsId = webContents.id;
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedAppNavigationUrl(url)) return { action: 'allow' };
    maybeOpenExternalHttpUrl(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigationUrl(url)) return;
    event.preventDefault();
    maybeOpenExternalHttpUrl(url);
  });
  webContents.on('will-redirect', (event, url) => {
    if (isAllowedAppNavigationUrl(url)) return;
    event.preventDefault();
    maybeOpenExternalHttpUrl(url);
  });
  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  windowRef.loadFile(path.join(__dirname, 'index.html'));
  updateWindowTitle();

  // Handle window close properly
  windowRef.on('close', (e) => {
    if (isMac && !isQuitting) {
      // On macOS, hide the window instead of closing (standard behaviour)
      e.preventDefault();
      windowRef.hide();
    }
  });

  windowRef.on('closed', () => {
    stopSemanticIndexJob(webContentsId);
    stopSemanticAskJob(webContentsId);
    if (win === windowRef) {
      win = null;
    }
  });

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: 'Quit Quackdas',
          accelerator: 'Command+Q',
          click: () => {
            // Destroy window first to bypass the close handler that hides instead of closing.
            destroyMainWindowForQuit();
            app.quit();
          }
        }
      ]
    }] : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuActionToRenderer('newProject')
        },
        {
          label: 'Open Project…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            try {
              await openProject();
            } catch (err) {
              dialog.showErrorBox('Open Project Failed', err?.message || String(err));
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuActionToRenderer('save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuActionToRenderer('saveAs')
        },
        { type: 'separator' },
        ...(isMac ? [] : [{
          label: 'Quit',
          accelerator: 'Alt+F4',
          click: () => {
            destroyMainWindowForQuit();
            app.quit();
          }
        }])
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function openProject() {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Quackdas project',
    properties: ['openFile'],
    filters: [
      { name: 'Quackdas Project', extensions: ['qdpx'] }
    ]
  });

  if (canceled || !filePaths || !filePaths[0]) return;

  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.qdpx') {
    dialog.showErrorBox('Unsupported project format', 'Quackdas now supports QDPX projects only. Please open a .qdpx file.');
    return;
  }

  await ensureFileWithinLimit(filePath, MAX_QDPX_FILE_BYTES, 'Selected project file');

  // QDPX file - read as binary and send to renderer
  const buffer = await fs.promises.readFile(filePath);
  currentProjectPath = filePath;
  clearSemanticAvailabilityCache();
  updateWindowTitle();
  await persistLastProjectPath(currentProjectPath);
  safeSendToWebContents(win && win.webContents, 'project:openQdpx', buffer);
}

ipcMain.handle('project:open', async () => {
  await openProject();
  return { ok: true };
});

ipcMain.handle('project:clearHandle', async () => {
  currentProjectPath = null;
  clearSemanticAvailabilityCache();
  updateWindowTitle();
  await persistLastProjectPath(null);
  return { ok: true };
});

ipcMain.handle('project:hasHandle', async () => {
  return !!currentProjectPath;
});

ipcMain.handle('project:getInfo', async () => {
  const projectPath = currentProjectPath || '';
  return {
    ok: true,
    hasHandle: !!projectPath,
    path: projectPath,
    fileName: projectPath ? path.basename(projectPath) : ''
  };
});



ipcMain.handle('project:save', async (_evt, payload, opts) => {
  const saveAs = !!(opts && opts.saveAs);

  try {
    let targetProjectPath = currentProjectPath;
    if (!currentProjectPath || saveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save Quackdas project',
        defaultPath: currentProjectPath || `quackdas-project.qdpx`,
        filters: [
          { name: 'Quackdas Project', extensions: ['qdpx'] }
        ]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      targetProjectPath = filePath;
    }

    const qdpxBase64 = (payload && typeof payload === 'object')
      ? String(payload.qdpxBase64 || '')
      : String(payload || '');
    // QDPX-only save path.
    let ext = path.extname(targetProjectPath).toLowerCase();
    if (!ext) {
      ext = '.qdpx';
      targetProjectPath = targetProjectPath + ext;
    }
    if (ext !== '.qdpx') {
      throw new Error('Quackdas now saves projects in QDPX format only (.qdpx).');
    }
    if (!qdpxBase64) {
      throw new Error('Could not save QDPX: binary payload is missing.');
    }
    const buffer = decodeBase64PayloadOrThrow(qdpxBase64, MAX_QDPX_FILE_BYTES, 'QDPX payload');
    await fs.promises.writeFile(targetProjectPath, buffer);

    if (currentProjectPath !== targetProjectPath) {
      currentProjectPath = targetProjectPath;
      clearSemanticAvailabilityCache();
      updateWindowTitle();
    }
    await persistLastProjectPath(targetProjectPath);

    return { ok: true, path: targetProjectPath };
  } catch (err) {
    dialog.showErrorBox('Save failed', err.message || String(err));
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('project:openLastUsed', async () => {
  try {
    const rememberedPath = await readLastProjectPath();
    if (!rememberedPath) return { ok: false, reason: 'none' };
    try {
      await fs.promises.access(rememberedPath, fs.constants.F_OK);
    } catch (_) {
      await persistLastProjectPath(null);
      return { ok: false, reason: 'missing' };
    }

    const ext = path.extname(rememberedPath).toLowerCase();
    if (ext !== '.qdpx') {
      await persistLastProjectPath(null);
      return { ok: false, reason: 'unsupported' };
    }
    await ensureFileWithinLimit(rememberedPath, MAX_QDPX_FILE_BYTES, 'Last opened project file');
    const buffer = await fs.promises.readFile(rememberedPath);
    if (currentProjectPath !== rememberedPath) {
      currentProjectPath = rememberedPath;
      clearSemanticAvailabilityCache();
      updateWindowTitle();
    }
    await persistLastProjectPath(currentProjectPath);
    return { ok: true, kind: 'qdpx', data: buffer.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('project:createBackup', async (_evt, data, opts = {}) => {
  try {
    if (!data || typeof data !== 'string') {
      return { ok: false, error: 'Invalid backup payload.' };
    }
    const reason = String(opts.reason || 'auto-backup');
    const projectName = String(opts.projectName || 'untitled-project');
    const bucket = getBackupBucket(projectName);
    const backupDir = path.join(getBackupRootDir(), bucket);
    await fs.promises.mkdir(backupDir, { recursive: true });

    const backupName = makeBackupFileName(reason);
    const backupPath = path.join(backupDir, backupName);
    const buffer = decodeBase64PayloadOrThrow(data, MAX_QDPX_FILE_BYTES, 'Backup payload');
    await fs.promises.writeFile(backupPath, buffer);
    await pruneBackups(backupDir);

    return { ok: true, id: backupName };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('project:listBackups', async (_evt, opts = {}) => {
  try {
    const projectName = String(opts.projectName || 'untitled-project');
    return await listBackupsForBucket(projectName);
  } catch (err) {
    return { ok: false, error: err.message || String(err), backups: [] };
  }
});

ipcMain.handle('project:restoreBackup', async (_evt, backupId, opts = {}) => {
  try {
    const projectName = String(opts.projectName || 'untitled-project');
    const id = path.basename(String(backupId || ''));
    if (!id || !/\.qdpx$/i.test(id)) {
      return { ok: false, error: 'Invalid backup identifier.' };
    }

    const bucket = getBackupBucket(projectName);
    const backupPath = path.join(getBackupRootDir(), bucket, id);
    const data = await fs.promises.readFile(backupPath);
    return { ok: true, kind: 'qdpx', data: data.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('semantic:getAvailability', async (_evt, opts = {}) => {
  try {
    const availability = await getSemanticAvailability({ force: !!opts.force });
    return { ok: true, ...availability };
  } catch (err) {
    return { ok: false, available: false, reachable: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('semantic:getProjectSettings', async () => {
  try {
    const dbPath = getSemanticDbPath();
    const availability = await getSemanticAvailability({ force: true });
    const modelName = getProjectSemanticModelName(dbPath);
    const generationModel = getProjectGenerationModelName(dbPath, availability?.models || []);
    return {
      ok: true,
      modelName,
      generationModel,
      models: availability?.models || [],
      dbPath: dbPath || ''
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || String(err),
      modelName: SEMANTIC_DEFAULTS.embeddingModel,
      generationModel: '',
      models: []
    };
  }
});

ipcMain.handle('semantic:setProjectModel', async (_evt, modelName) => {
  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return { ok: false, error: 'Save the project first to store semantic settings and index data.' };
  }
  try {
    const normalized = String(modelName || '').trim();
    if (!normalized) return { ok: false, error: 'Model name is required.' };
    const store = openSemanticStore(dbPath);
    try {
      store.setMeta('embedding_model_name', normalized);
    } finally {
      store.close();
    }
    clearSemanticAvailabilityCache();
    return { ok: true, modelName: normalized };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('semantic:setGenerationModel', async (_evt, modelName) => {
  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return { ok: false, error: 'Save the project first to store semantic settings and index data.' };
  }
  try {
    const normalized = String(modelName || '').trim();
    if (!normalized) return { ok: false, error: 'Generation model name is required.' };
    const store = openSemanticStore(dbPath);
    try {
      store.setMeta('generation_model_name', normalized);
    } finally {
      store.close();
    }
    clearSemanticAvailabilityCache();
    return { ok: true, generationModel: normalized };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('semantic:getIndexStatus', async (_evt, payload = {}) => {
  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return {
      ok: true,
      state: 'not_indexed',
      indexedDocCount: 0,
      totalDocs: 0,
      chunkCount: 0,
      message: 'Save the project before semantic indexing.'
    };
  }

  try {
    const docs = toSemanticDocuments(payload.documents);
    const store = openSemanticStore(dbPath);
    try {
      let allStates = store.getAllDocStates();
      let states = new Map(allStates.map((row) => [row.docId, row]));

      // Repair doc-id drift across project reopens by matching persisted text hashes.
      // This keeps existing semantic index rows reusable when importer assigns new doc ids.
      const missingDocs = docs.filter((doc) => !states.has(doc.id));
      if (missingDocs.length > 0 && allStates.length > 0) {
        const docsById = new Set(docs.map((doc) => doc.id));
        const candidateRowsByHash = new Map();
        allStates.forEach((row) => {
          if (!row || !row.docId) return;
          // Never remap from ids that are currently present in the loaded project.
          if (docsById.has(row.docId)) return;
          const key = String(row.docTextHash || '');
          if (!key) return;
          if (!candidateRowsByHash.has(key)) candidateRowsByHash.set(key, []);
          candidateRowsByHash.get(key).push(row);
        });
        const hashCursorByKey = new Map();
        const usedOldDocIds = new Set();
        let changed = false;
        store.begin();
        try {
          missingDocs.forEach((doc) => {
            const expectedHash = getDocumentTextHash(doc.content);
            const bucket = candidateRowsByHash.get(expectedHash);
            if (!bucket || bucket.length === 0) return;
            let cursor = hashCursorByKey.get(expectedHash) || 0;
            while (cursor < bucket.length && usedOldDocIds.has(bucket[cursor].docId)) {
              cursor += 1;
            }
            hashCursorByKey.set(expectedHash, cursor);
            const candidate = cursor < bucket.length ? bucket[cursor] : null;
            if (!candidate) return;
            if (store.remapDocumentId(candidate.docId, doc.id)) {
              usedOldDocIds.add(candidate.docId);
              hashCursorByKey.set(expectedHash, cursor + 1);
              changed = true;
            }
          });
          if (changed) store.commit();
          else store.rollback();
        } catch (_) {
          store.rollback();
        }
        if (changed) {
          allStates = store.getAllDocStates();
          states = new Map(allStates.map((row) => [row.docId, row]));
        }
      }

      if (docs.length === 0 && states.size > 0) {
        const chunkCount = store.getTotalChunkCount();
        return {
          ok: true,
          state: 'indexed_stale',
          indexedDocCount: states.size,
          freshDocCount: 0,
          totalDocs: states.size,
          chunkCount,
          message: 'Loaded persisted semantic index from project cache.'
        };
      }
      let indexedDocCount = 0;
      let freshDocCount = 0;
      docs.forEach((doc) => {
        const row = states.get(doc.id);
        if (!row) return;
        indexedDocCount += 1;
        const expectedHash = getDocumentTextHash(doc.content);
        if (row.docTextHash === expectedHash) freshDocCount += 1;
      });
      const totalDocs = docs.length;
      const chunkCount = store.getTotalChunkCount();
      let state = 'not_indexed';
      let message = '';
      if (totalDocs > 0 && indexedDocCount === totalDocs && freshDocCount === totalDocs) {
        state = 'indexed';
      } else if (totalDocs > 0 && indexedDocCount === totalDocs) {
        state = 'indexed_stale';
        message = 'Index metadata loaded from project cache. Re-index recommended if content changed.';
      } else if (states.size > 0 && chunkCount > 0) {
        state = 'indexed_stale';
        message = 'Loaded persisted semantic index from project cache.';
      } else if (indexedDocCount > 0) {
        state = 'partial';
        message = `Indexed ${indexedDocCount}/${totalDocs} docs.`;
      }
      return { ok: true, state, indexedDocCount, freshDocCount, totalDocs, chunkCount, message };
    } finally {
      store.close();
    }
  } catch (err) {
    return { ok: false, state: 'error', error: err?.message || String(err) };
  }
});

ipcMain.handle('semantic:startIndexing', async (evt, payload = {}) => {
  const webContents = evt.sender;
  const webContentsId = webContents.id;
  const existing = semanticIndexJobsByWebContents.get(webContentsId);
  if (existing && existing.status === 'running') {
    return { ok: false, error: 'Semantic indexing is already running for this window.' };
  }

  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return { ok: false, error: 'Save the project first to enable semantic indexing.' };
  }

  const availability = await getSemanticAvailability({ force: true });
  if (!availability.reachable) {
    return { ok: false, error: availability.error || 'Ollama is unavailable.' };
  }
  if (!availability.modelReady) {
    return { ok: false, error: availability.error || 'No local embedding model available.' };
  }

  const docs = toSemanticDocuments(payload.documents);
  if (docs.length === 0) {
    return { ok: false, error: 'No text documents available to index.' };
  }

  const chunkMin = Number(payload.chunkMin || SEMANTIC_DEFAULTS.chunkTargetMinChars);
  const chunkMax = Number(payload.chunkMax || SEMANTIC_DEFAULTS.chunkTargetMaxChars);
  const chunkOverlap = Number(payload.chunkOverlap || SEMANTIC_DEFAULTS.chunkOverlapChars);
  const embeddingConcurrency = Number(payload.embeddingConcurrency || SEMANTIC_DEFAULTS.embeddingConcurrency);

  const worker = new Worker(path.join(__dirname, 'semantic', 'indexer-worker.js'), {
    workerData: {
      dbPath,
      modelName: availability.selectedModel || availability.configuredModel,
      documents: docs,
      chunkMin,
      chunkMax,
      chunkOverlap,
      embeddingConcurrency
    }
  });

  const job = {
    worker,
    status: 'running',
    startedAt: Date.now(),
    progress: {
      phase: 'indexing',
      percent: 0,
      currentDocName: '',
      embeddedChunks: 0,
      totalChunks: 0
    }
  };
  semanticIndexJobsByWebContents.set(webContentsId, job);

  worker.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'progress') {
      job.progress = Object.assign({}, job.progress, msg.payload || {});
      safeSendToWebContents(webContents, 'semantic:indexProgress', job.progress);
      return;
    }

    if (msg.type === 'done') {
      job.status = 'done';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:indexDone', Object.assign({ ok: true }, msg.payload || {}));
      semanticIndexJobsByWebContents.delete(webContentsId);
      clearSemanticAvailabilityCache();
      return;
    }

    if (msg.type === 'cancelled') {
      job.status = 'cancelled';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:indexError', msg.payload || { ok: false, code: 'INDEX_CANCELLED', message: 'Indexing cancelled.' });
      semanticIndexJobsByWebContents.delete(webContentsId);
      return;
    }

    if (msg.type === 'error') {
      job.status = 'error';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:indexError', msg.payload || { ok: false, code: 'INDEX_FAILED', message: 'Indexing failed.' });
      semanticIndexJobsByWebContents.delete(webContentsId);
    }
  });

  worker.on('error', (err) => {
    job.status = 'error';
    if (job.terminateTimer) {
      globalThis.clearTimeout(job.terminateTimer);
      job.terminateTimer = null;
    }
    safeSendToWebContents(webContents, 'semantic:indexError', { ok: false, code: 'WORKER_ERROR', message: err?.message || String(err) });
    semanticIndexJobsByWebContents.delete(webContentsId);
  });

  worker.on('exit', (code) => {
    if (job.terminateTimer) {
      globalThis.clearTimeout(job.terminateTimer);
      job.terminateTimer = null;
    }
    const current = semanticIndexJobsByWebContents.get(webContentsId);
    if (current && current.worker === worker && current.status === 'running' && code !== 0) {
      safeSendToWebContents(webContents, 'semantic:indexError', { ok: false, code: 'WORKER_EXIT', message: `Index worker exited with code ${code}.` });
      semanticIndexJobsByWebContents.delete(webContentsId);
    }
  });

  return { ok: true, started: true, modelName: availability.selectedModel || availability.configuredModel };
});

ipcMain.handle('semantic:cancelIndexing', async (evt) => {
  const webContentsId = evt.sender.id;
  const cancelled = stopSemanticIndexJob(webContentsId);
  return { ok: true, cancelled };
});

ipcMain.handle('semantic:search', async (_evt, payload = {}) => {
  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return { ok: false, error: 'Save the project before using semantic search.' };
  }

  try {
    const query = canonicalizeText(payload.query || '').trim();
    if (!query) return { ok: true, results: [] };

    let availability = await getSemanticAvailability();
    if (!availability.reachable || !availability.modelReady) {
      availability = await getSemanticAvailability({ force: true });
    }
    if (!availability.reachable) {
      return { ok: false, error: availability.error || 'Ollama is unavailable.' };
    }
    if (!availability.modelReady) {
      return { ok: false, error: availability.error || 'Ollama is unavailable.' };
    }
    const modelName = availability.selectedModel || availability.configuredModel;
    const queryEmbedding = await embedText(modelName, query, {
      baseUrl: SEMANTIC_DEFAULTS.ollamaBaseUrl,
      timeoutMs: SEMANTIC_DEFAULTS.ollamaTimeoutMs
    });

    const requestedTopK = Number(payload.topK);
    const topK = Number.isFinite(requestedTopK) && requestedTopK > 0
      ? Math.floor(requestedTopK)
      : SEMANTIC_DEFAULTS.searchTopK;
    const candidateK = Math.max(
      topK,
      Math.floor(topK * Number(SEMANTIC_DEFAULTS.searchRerankCandidateMultiplier || 3))
    );

    const search = await runSemanticSearchWorker({
      dbPath,
      modelName,
      queryEmbedding,
      queryText: query,
      topK,
      candidateK
    });

    return { ok: true, modelName, results: Array.isArray(search?.results) ? search.results : [] };
  } catch (err) {
    if (err instanceof OllamaError) {
      return { ok: false, error: err.message, code: err.code };
    }
    const code = err?.code ? String(err.code) : '';
    if (code) {
      return { ok: false, error: err?.message || String(err), code };
    }
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('semantic:startAsk', async (evt, payload = {}) => {
  const webContents = evt.sender;
  const webContentsId = webContents.id;
  const existing = semanticAskJobsByWebContents.get(webContentsId);
  if (existing && existing.status === 'running') {
    return { ok: false, error: 'An Ask request is already running.' };
  }

  const dbPath = getSemanticDbPath();
  if (!dbPath) {
    return { ok: false, error: 'Save the project before using Ask.' };
  }

  const availability = await getSemanticAvailability({ force: true });
  if (!availability.reachable) {
    return { ok: false, error: availability.error || 'Ollama is unavailable.' };
  }
  if (!availability.modelReady) {
    return { ok: false, error: availability.error || 'No embedding model is available.' };
  }

  const question = String(payload.question || '').trim();
  if (!question) return { ok: false, error: 'Question is empty.' };

  const selectedGeneration = String(payload.generationModel || '').trim() || String(availability.generationModel || '').trim();
  const generationModel = findBestInstalledModel(selectedGeneration, availability.models) || selectDefaultGenerationModel(availability.models);
  if (!generationModel) {
    return { ok: false, error: 'No local generation model found in Ollama.' };
  }
  const askProfile = getAskModelProfile(generationModel, SEMANTIC_DEFAULTS);
  const outputModeInput = String(payload.outputMode || '').trim().toLowerCase();
  const outputMode = outputModeInput === 'strict' || outputModeInput === 'loose'
    ? outputModeInput
    : askProfile.recommendedMode;
  const topK = Number(payload.topK);
  const minCitationsOverall = Number(payload.minCitationsOverall);
  const maxPromptChunkChars = Number(payload.maxPromptChunkChars);
  const numCtx = Number(payload.numCtx);

  const docs = toSemanticDocuments(payload.documents);
  const worker = new Worker(path.join(__dirname, 'semantic', 'ask-worker.js'), {
    workerData: {
      dbPath,
      baseUrl: assertLocalOllamaBaseUrl(SEMANTIC_DEFAULTS.ollamaBaseUrl),
      question,
      documents: docs,
      embeddingModel: availability.selectedModel || availability.configuredModel,
      generationModel,
      outputMode,
      outputLanguage: payload.outputLanguage || 'sv',
      topK: Number.isFinite(topK) && topK > 0 ? topK : askProfile.topK,
      minCitationsOverall: Number.isFinite(minCitationsOverall) && minCitationsOverall > 0 ? minCitationsOverall : askProfile.minCitationsOverall,
      maxPromptChunkChars: Number.isFinite(maxPromptChunkChars) && maxPromptChunkChars > 200 ? maxPromptChunkChars : askProfile.maxPromptChunkChars,
      numCtx: Number.isFinite(numCtx) && numCtx >= 1024 ? numCtx : askProfile.numCtx,
      timeoutMs: 0,
      retrievedChunks: Array.isArray(payload.retrievedChunks) ? payload.retrievedChunks : []
    }
  });

  const job = {
    worker,
    status: 'running',
    startedAt: Date.now(),
    question,
    generationModel
  };
  semanticAskJobsByWebContents.set(webContentsId, job);

  worker.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'retrieved') {
      safeSendToWebContents(webContents, 'semantic:askRetrieved', msg.payload || {});
      return;
    }
    if (msg.type === 'stream') {
      safeSendToWebContents(webContents, 'semantic:askStream', msg.payload || {});
      return;
    }
    if (msg.type === 'phase') {
      safeSendToWebContents(webContents, 'semantic:askPhase', msg.payload || {});
      return;
    }
    if (msg.type === 'done') {
      job.status = 'done';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:askDone', Object.assign({ ok: true, generationModel }, msg.payload || {}));
      semanticAskJobsByWebContents.delete(webContentsId);
      return;
    }
    if (msg.type === 'cancelled') {
      job.status = 'cancelled';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:askError', Object.assign({ ok: false }, msg.payload || {}));
      semanticAskJobsByWebContents.delete(webContentsId);
      return;
    }
    if (msg.type === 'error') {
      job.status = 'error';
      if (job.terminateTimer) {
        globalThis.clearTimeout(job.terminateTimer);
        job.terminateTimer = null;
      }
      safeSendToWebContents(webContents, 'semantic:askError', Object.assign({ ok: false }, msg.payload || {}));
      semanticAskJobsByWebContents.delete(webContentsId);
    }
  });

  worker.on('error', (err) => {
    job.status = 'error';
    if (job.terminateTimer) {
      globalThis.clearTimeout(job.terminateTimer);
      job.terminateTimer = null;
    }
    safeSendToWebContents(webContents, 'semantic:askError', { ok: false, code: 'ASK_WORKER_ERROR', message: err?.message || String(err) });
    semanticAskJobsByWebContents.delete(webContentsId);
  });

  worker.on('exit', (code) => {
    if (job.terminateTimer) {
      globalThis.clearTimeout(job.terminateTimer);
      job.terminateTimer = null;
    }
    const current = semanticAskJobsByWebContents.get(webContentsId);
    if (!current || current.worker !== worker) return;
    if (current.status === 'running' && code !== 0) {
      safeSendToWebContents(webContents, 'semantic:askError', { ok: false, code: 'ASK_WORKER_EXIT', message: `Ask worker exited with code ${code}.` });
    }
    semanticAskJobsByWebContents.delete(webContentsId);
  });

  return { ok: true, started: true, generationModel };
});

ipcMain.handle('semantic:cancelAsk', async (evt) => {
  const cancelled = stopSemanticAskJob(evt.sender.id);
  return { ok: true, cancelled };
});

ipcMain.handle('semantic:askState', async (evt) => {
  return { ok: true, state: getSemanticAskState(evt.sender.id) };
});

ipcMain.handle('semantic:indexingState', async (evt) => {
  const state = getSemanticIndexingState(evt.sender.id);
  return { ok: true, state };
});


// Native file helpers (used to avoid relying on <input type="file"> in packaged builds)
ipcMain.handle('file:openProjectFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Quackdas project',
    properties: ['openFile'],
    filters: [
      { name: 'Quackdas Project', extensions: ['qdpx'] }
    ]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();

    if (ext !== '.qdpx') {
      return { ok: false, error: 'Unsupported project format. Please choose a .qdpx file.' };
    }
    await ensureFileWithinLimit(filePath, MAX_QDPX_FILE_BYTES, 'Selected project file');
    const buffer = await fs.promises.readFile(filePath);
    if (currentProjectPath !== filePath) {
      currentProjectPath = filePath;
      clearSemanticAvailabilityCache();
      updateWindowTitle();
    }
    await persistLastProjectPath(filePath);
    return { ok: true, kind: 'qdpx', data: buffer.toString('base64') };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('file:openDocumentFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import document',
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['txt', 'docx', 'pdf'] }
    ]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };

  const p = filePaths[0];
  const ext = path.extname(p).toLowerCase().replace('.', '');
  const name = path.basename(p);
  try {
    await ensureFileWithinLimit(p, MAX_DOCUMENT_FILE_BYTES, 'Selected document file');
    if (ext === 'docx') {
      const buf = await fs.promises.readFile(p);
      return { ok: true, kind: 'docx', name, data: buf.toString('base64') };
    } else if (ext === 'pdf') {
      const buf = await fs.promises.readFile(p);
      return { ok: true, kind: 'pdf', name, data: buf.toString('base64') };
    } else {
      const text = await fs.promises.readFile(p, 'utf-8');
      return { ok: true, kind: 'text', name, data: text };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('ocr:getStatus', async () => {
  const now = Date.now();
  if (typeof tesseractInstalledCache === 'boolean' && (now - tesseractInstalledCheckedAt) < TESSERACT_STATUS_CACHE_MS) {
    return { ok: true, installed: tesseractInstalledCache };
  }

  const installed = await new Promise((resolve) => {
    execFile('tesseract', ['--version'], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 1024 * 1024
    }, (error) => {
      if (!error) {
        resolve(true);
        return;
      }
      if (error.code === 'ENOENT') {
        resolve(false);
        return;
      }
      // Binary exists but returned an error (unexpected); avoid false "not installed".
      resolve(true);
    });
  });

  tesseractInstalledCache = installed;
  tesseractInstalledCheckedAt = now;
  return { ok: true, installed };
});

// OCR helper for scanned/image-only PDFs (renderer sends page image as data URL).
ipcMain.handle('ocr:image', async (_evt, payload = {}) => {
  let tmpDir = null;
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
        execFile('tesseract', [imgPath, outBase, '-l', useLang, '--psm', psm, 'tsv'], {
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
      // Fallback language for systems without Swedish model installed.
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

app.whenReady().then(() => {
  createWindow();
  // Note: We don't register a globalShortcut for Cmd+Q because:
  // 1. The menu accelerator handles it
  // 2. globalShortcut can conflict with menu accelerators
  // 3. globalShortcut captures keys system-wide, even when app isn't focused
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  // Ensure any hidden window is destroyed to allow quit
  // This fixes dock right-click "Quit" not working
  destroyMainWindowForQuit();
});

app.on('activate', () => {
  // On macOS, re-show the window when clicking dock icon
  if (win) {
    win.show();
  } else {
    createWindow();
  }
});
