
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
const { createProjectBackupService } = require('./electron-main/project-backups');
const { registerOcrImageHandler, resolveTesseractCommand } = require('./electron-main/ocr-service');
const { createDiskImageStorageService, normalizeDiskImageSettings } = require('./electron-main/disk-image-storage');
const { writeFileAtomically } = require('./electron-main/project-files');

let win;
let currentProjectPath = null;
let isQuitting = false;
let semanticAvailabilityCache = null;
let semanticAvailabilityCheckedAt = 0;
let tesseractInstalledCache = null;
let tesseractInstalledCheckedAt = 0;
let appPreferencesCache = null;
let pendingProjectWriteCount = 0;
let quitPreparationInProgress = false;
let quitPreparationComplete = false;
const semanticIndexJobsByWebContents = new Map();
const semanticAskJobsByWebContents = new Map();
let diskImageStorageService = null;

const LAST_PROJECT_FILE = 'last-project-path.json';
const APP_PREFERENCES_FILE = 'app-preferences.json';
const MAX_QDPX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_DOCUMENT_FILE_BYTES = 256 * 1024 * 1024; // 256 MB
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
 * Quackdas now also has async quit preparation for semantic job shutdown and optional
 * disk-image auto-unmount. New quit paths should therefore call `app.quit()` and let
 * the shared `before-quit` handler perform preparation before the final destroy/quit pass.
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

async function setCurrentProjectPath(projectPath) {
  const normalizedPath = (typeof projectPath === 'string' && projectPath.trim())
    ? projectPath
    : null;
  if (currentProjectPath !== normalizedPath) {
    currentProjectPath = normalizedPath;
    clearSemanticAvailabilityCache();
    updateWindowTitle();
  }
  await persistLastProjectPath(normalizedPath);
  return normalizedPath;
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

function getAppPreferencesFile() {
  return path.join(app.getPath('userData'), APP_PREFERENCES_FILE);
}

function readAppPreferences() {
  if (appPreferencesCache) return appPreferencesCache;
  const defaults = {
    diskImageStorage: false,
    diskImageSettings: normalizeDiskImageSettings({})
  };
  try {
    const raw = fs.readFileSync(getAppPreferencesFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const next = Object.assign({}, defaults, parsed || {});
    next.diskImageSettings = normalizeDiskImageSettings(Object.assign(
      {},
      next.diskImageSettings || {},
      { enabled: !!(next.diskImageSettings?.enabled || next.diskImageStorage) }
    ));
    next.diskImageStorage = !!next.diskImageSettings.enabled;
    appPreferencesCache = next;
  } catch (_) {
    appPreferencesCache = Object.assign({}, defaults);
  }
  return appPreferencesCache;
}

function writeAppPreferences(nextPrefs) {
  appPreferencesCache = Object.assign({}, readAppPreferences(), nextPrefs || {});
  appPreferencesCache.diskImageSettings = normalizeDiskImageSettings(Object.assign(
    {},
    readAppPreferences().diskImageSettings || {},
    appPreferencesCache.diskImageSettings || {},
    typeof appPreferencesCache.diskImageStorage === 'boolean'
      ? { enabled: !!appPreferencesCache.diskImageStorage }
      : {}
  ));
  appPreferencesCache.diskImageStorage = !!appPreferencesCache.diskImageSettings.enabled;
  try {
    fs.writeFileSync(getAppPreferencesFile(), JSON.stringify(appPreferencesCache), 'utf8');
  } catch (_) {}
  return appPreferencesCache;
}

function isDiskImageStorageEnabled() {
  return supportsDiskImageStorageMode() && !!readAppPreferences().diskImageStorage;
}

function supportsDiskImageStorageMode() {
  return process.platform === 'darwin';
}

function getDiskImageSettings() {
  return normalizeDiskImageSettings(readAppPreferences().diskImageSettings || {});
}

function delay(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function waitForPathAccessible(filePath, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 1);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < (attempts - 1) && delayMs > 0) {
        await delay(delayMs);
      }
    }
  }
  throw lastError || new Error('Path is not accessible.');
}

function getBlockedAppSummaryText(blockedApps) {
  const rows = Array.isArray(blockedApps) ? blockedApps : [];
  if (rows.length === 0) return 'No blocked apps detected.';
  const names = rows.map((row) => String(row?.baseName || row?.command || 'Unknown')).slice(0, 4);
  const suffix = rows.length > names.length ? `, +${rows.length - names.length} more` : '';
  return `Blocked apps currently running: ${names.join(', ')}${suffix}.`;
}

async function maybeShowDiskImageStartupWarning() {
  const status = diskImageStorageService
    ? await diskImageStorageService.getStatus().catch(() => null)
    : null;
  const settings = status?.settings || getDiskImageSettings();
  const blockedApps = Array.isArray(status?.blockedApps) ? status.blockedApps : [];
  const mounted = !!status?.mounted;
  if (!supportsDiskImageStorageMode() || !settings.enabled || !settings.imagePath) return;
  if (blockedApps.length === 0) return;
  if (!win || win.isDestroyed()) return;
  const canMountAnyway = !mounted && !!settings.allowManualOverride;
  const buttons = canMountAnyway ? ['Cancel', 'Mount anyway'] : ['OK'];
  try {
    const response = await dialog.showMessageBox(win, {
      type: 'warning',
      title: mounted ? 'Blocked apps detected' : 'Disk image not mounted',
      message: mounted
        ? 'Blocked apps are open while disk image storage mode is active.'
        : 'Disk image storage did not auto-mount at startup.',
      detail: mounted
        ? `${getBlockedAppSummaryText(blockedApps)}\n\nThe configured disk image is already mounted, but blocked apps are running while disk image storage mode is active.`
        : `${getBlockedAppSummaryText(blockedApps)}\n\nQuackdas started without mounting the configured disk image.`,
      buttons,
      defaultId: canMountAnyway ? 1 : 0,
      cancelId: 0,
      noLink: true
    });
    if (canMountAnyway && response.response === 1 && diskImageStorageService) {
      const mountResult = await diskImageStorageService.mountConfiguredImage({ manualOverride: true }).catch((err) => ({
        ok: false,
        error: err?.message || String(err)
      }));
      if (!mountResult?.ok) {
        await dialog.showMessageBox(win, {
          type: 'error',
          title: 'Mount failed',
          message: 'Could not mount disk image.',
          detail: mountResult?.error || 'Unknown error.',
          buttons: ['OK'],
          defaultId: 0,
          noLink: true
        });
      }
    }
  } catch (_) {}
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

createProjectBackupService({
  app,
  ipcMain,
  fs,
  path,
  crypto,
  sanitizeName,
  decodeBase64PayloadOrThrow,
  maxQdpxBytes: MAX_QDPX_FILE_BYTES,
  getCurrentProjectPath: () => currentProjectPath,
  getDiskImageStorageEnabled: () => isDiskImageStorageEnabled(),
  onBackupWriteStateChange: (delta) => {
    pendingProjectWriteCount = Math.max(0, pendingProjectWriteCount + Number(delta || 0));
  }
}).registerHandlers();

diskImageStorageService = createDiskImageStorageService({
  app,
  ipcMain,
  dialog,
  fs,
  path,
  execFile,
  getWindow: () => win,
  getPreferences: () => readAppPreferences(),
  setPreferences: (patch) => writeAppPreferences(patch),
  getCurrentProjectPath: () => currentProjectPath,
  clearSemanticAvailabilityCache: () => clearSemanticAvailabilityCache()
});

diskImageStorageService.registerHandlers();

registerOcrImageHandler({
  ipcMain,
  fs,
  os,
  path,
  execFile,
  formatBytes,
  estimateBase64DecodedBytes
});

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

function getHiddenProjectLocalSemanticDbPath(projectPath) {
  const project = String(projectPath || '').trim();
  if (!project) return '';
  const base = path.basename(project, path.extname(project));
  return path.join(path.dirname(project), `.${base}.semantic.sqlite`);
}

function getProjectLocalSemanticDbPath(projectPath) {
  return getHiddenProjectLocalSemanticDbPath(projectPath);
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
  const hiddenLocalPath = getProjectLocalSemanticDbPath(projectPath);
  const sourcePath = fs.existsSync(hiddenLocalPath) ? hiddenLocalPath : legacyPath;
  if (!sourcePath || sourcePath === managedPath) return;
  if (!fs.existsSync(sourcePath)) return;
  if (fs.existsSync(managedPath)) return;
  try {
    fs.mkdirSync(path.dirname(managedPath), { recursive: true });
  } catch (_) {
    return;
  }
  moveFileIfPresent(sourcePath, managedPath);
  moveFileIfPresent(`${sourcePath}-wal`, `${managedPath}-wal`);
  moveFileIfPresent(`${sourcePath}-shm`, `${managedPath}-shm`);
}

function getSemanticDbPath() {
  if (!currentProjectPath) return null;
  const managedPath = getManagedSemanticDbPath(currentProjectPath);
  const projectLocalPath = getProjectLocalSemanticDbPath(currentProjectPath);
  const legacyVisibleLocalPath = getLegacySemanticDbPath(currentProjectPath);
  if (isDiskImageStorageEnabled()) {
    if (legacyVisibleLocalPath && projectLocalPath && legacyVisibleLocalPath !== projectLocalPath && fs.existsSync(legacyVisibleLocalPath) && !fs.existsSync(projectLocalPath)) {
      moveFileIfPresent(legacyVisibleLocalPath, projectLocalPath);
      moveFileIfPresent(`${legacyVisibleLocalPath}-wal`, `${projectLocalPath}-wal`);
      moveFileIfPresent(`${legacyVisibleLocalPath}-shm`, `${projectLocalPath}-shm`);
    }
    if (managedPath && projectLocalPath && fs.existsSync(managedPath) && !fs.existsSync(projectLocalPath)) {
      moveFileIfPresent(managedPath, projectLocalPath);
      moveFileIfPresent(`${managedPath}-wal`, `${projectLocalPath}-wal`);
      moveFileIfPresent(`${managedPath}-shm`, `${projectLocalPath}-shm`);
    }
    return projectLocalPath;
  }
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

function stopAllSemanticJobs() {
  const ids = new Set([
    ...semanticIndexJobsByWebContents.keys(),
    ...semanticAskJobsByWebContents.keys()
  ]);
  ids.forEach((id) => {
    stopSemanticIndexJob(id);
    stopSemanticAskJob(id);
  });
}

function hasActiveSemanticJobs() {
  return semanticIndexJobsByWebContents.size > 0 || semanticAskJobsByWebContents.size > 0;
}

async function waitForShutdownQuiescence(timeoutMs = 4000) {
  const started = Date.now();
  while ((Date.now() - started) < timeoutMs) {
    if (!hasActiveSemanticJobs() && pendingProjectWriteCount <= 0) return true;
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  return !hasActiveSemanticJobs() && pendingProjectWriteCount <= 0;
}

async function prepareAppForQuit() {
  stopAllSemanticJobs();
  await waitForShutdownQuiescence();
  if (diskImageStorageService) {
    await diskImageStorageService.maybeUnmountOnQuit().catch(() => {});
  }
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
          click: () => sendMenuActionToRenderer('openProject')
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

async function promptForProjectFileSelection(title = 'Open Quackdas project') {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters: [
      { name: 'Quackdas Project', extensions: ['qdpx'] }
    ]
  });

  if (canceled || !filePaths || !filePaths[0]) return null;
  return filePaths[0];
}

async function readProjectPayload(filePath, label = 'Selected project file') {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) {
    return { ok: false, canceled: true };
  }

  const ext = path.extname(normalizedPath).toLowerCase();
  if (ext !== '.qdpx') {
    return { ok: false, error: 'Unsupported project format. Please choose a .qdpx file.' };
  }

  await ensureFileWithinLimit(normalizedPath, MAX_QDPX_FILE_BYTES, label);
  const buffer = await fs.promises.readFile(normalizedPath);
  return {
    ok: true,
    kind: 'qdpx',
    path: normalizedPath,
    data: buffer.toString('base64')
  };
}

ipcMain.handle('project:open', async () => {
  try {
    const filePath = await promptForProjectFileSelection('Open Quackdas project');
    if (!filePath) return { ok: false, canceled: true };
    return await readProjectPayload(filePath, 'Selected project file');
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('project:clearHandle', async () => {
  await setCurrentProjectPath(null);
  return { ok: true };
});

ipcMain.handle('project:commitOpenPath', async (_evt, projectPath) => {
  try {
    const normalizedPath = String(projectPath || '').trim();
    if (!normalizedPath) {
      return { ok: false, error: 'Project path is required.' };
    }
    if (path.extname(normalizedPath).toLowerCase() !== '.qdpx') {
      return { ok: false, error: 'Unsupported project format. Please choose a .qdpx file.' };
    }
    await setCurrentProjectPath(normalizedPath);
    return { ok: true, path: normalizedPath };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
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

ipcMain.handle('settings:getStorageMode', async () => {
  const diskImageSettings = getDiskImageSettings();
  return {
    ok: true,
    diskImageStorage: isDiskImageStorageEnabled(),
    platform: process.platform,
    supported: supportsDiskImageStorageMode(),
    autoMount: !!diskImageSettings.autoMount,
    autoUnmountOnClose: !!diskImageSettings.autoUnmountOnClose
  };
});

ipcMain.handle('settings:setDiskImageStorage', async (_evt, enabled) => {
  const nextEnabled = supportsDiskImageStorageMode() && !!enabled;
  const diskImageSettings = normalizeDiskImageSettings(Object.assign({}, getDiskImageSettings(), { enabled: nextEnabled }));
  writeAppPreferences({
    diskImageStorage: nextEnabled,
    diskImageSettings
  });
  clearSemanticAvailabilityCache();
  return {
    ok: true,
    diskImageStorage: nextEnabled,
    platform: process.platform,
    supported: supportsDiskImageStorageMode()
  };
});



ipcMain.handle('project:save', async (_evt, payload, opts) => {
  const saveAs = !!(opts && opts.saveAs);
  const silent = !!(opts && opts.silent);
  let writeTracked = false;

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
    pendingProjectWriteCount += 1;
    writeTracked = true;
    await writeFileAtomically({ fs, path }, targetProjectPath, buffer);
    pendingProjectWriteCount = Math.max(0, pendingProjectWriteCount - 1);
    writeTracked = false;

    await setCurrentProjectPath(targetProjectPath);

    return { ok: true, path: targetProjectPath };
  } catch (err) {
    if (writeTracked) pendingProjectWriteCount = Math.max(0, pendingProjectWriteCount - 1);
    if (!silent) {
      dialog.showErrorBox('Save failed', err.message || String(err));
    }
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('project:openLastUsed', async () => {
  try {
    const rememberedPath = await readLastProjectPath();
    if (!rememberedPath) return { ok: false, reason: 'none' };
    const shouldWaitForDiskImage = !!(isDiskImageStorageEnabled() && getDiskImageSettings().imagePath);
    try {
      await fs.promises.access(rememberedPath, fs.constants.F_OK);
    } catch (_) {
      if (shouldWaitForDiskImage) {
        try {
          await waitForPathAccessible(rememberedPath, { attempts: 20, delayMs: 250 });
        } catch (_) {}
      }
      try {
        await fs.promises.access(rememberedPath, fs.constants.F_OK);
      } catch (_) {
        if (!shouldWaitForDiskImage) {
          await persistLastProjectPath(null);
        }
        return { ok: false, reason: 'missing' };
      }
    }
    try {
      await fs.promises.access(rememberedPath, fs.constants.R_OK);
    } catch (_) {
      if (!shouldWaitForDiskImage) {
        await persistLastProjectPath(null);
      }
      return { ok: false, reason: 'missing' };
    }

    const ext = path.extname(rememberedPath).toLowerCase();
    if (ext !== '.qdpx') {
      await persistLastProjectPath(null);
      return { ok: false, reason: 'unsupported' };
    }
    return await readProjectPayload(rememberedPath, 'Last opened project file');
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
    if (!current || current.worker !== worker) return;
    if (current.status === 'running' && code !== 0) {
      safeSendToWebContents(webContents, 'semantic:indexError', { ok: false, code: 'WORKER_EXIT', message: `Index worker exited with code ${code}.` });
    }
    semanticIndexJobsByWebContents.delete(webContentsId);
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
  try {
    const filePath = await promptForProjectFileSelection('Open Quackdas project');
    if (!filePath) return { ok: false, canceled: true };
    return await readProjectPayload(filePath, 'Selected project file');
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

  const tesseractCommand = resolveTesseractCommand({ fs, env: process.env, platform: process.platform });
  const installed = await new Promise((resolve) => {
    execFile(tesseractCommand, ['--version'], {
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


app.whenReady().then(async () => {
  if (diskImageStorageService) {
    await diskImageStorageService.prepareStartupMount().catch(() => ({ ok: false }));
  }
  createWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.once('did-finish-load', () => {
      maybeShowDiskImageStartupWarning().catch(() => {});
    });
  }
  // Note: We don't register a globalShortcut for Cmd+Q because:
  // 1. The menu accelerator handles it
  // 2. globalShortcut can conflict with menu accelerators
  // 3. globalShortcut captures keys system-wide, even when app isn't focused
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

app.on('before-quit', (event) => {
  if (quitPreparationComplete) {
    isQuitting = true;
    destroyMainWindowForQuit();
    return;
  }
  event.preventDefault();
  if (quitPreparationInProgress) return;
  quitPreparationInProgress = true;
  prepareAppForQuit()
    .catch(() => {})
    .finally(() => {
      quitPreparationInProgress = false;
      quitPreparationComplete = true;
      isQuitting = true;
      destroyMainWindowForQuit();
      app.quit();
    });
});

app.on('activate', () => {
  // On macOS, re-show the window when clicking dock icon
  if (win) {
    win.show();
  } else {
    createWindow();
  }
});
