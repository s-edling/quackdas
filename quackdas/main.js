
const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { SEMANTIC_DEFAULTS } = require('./semantic/config');
const { canonicalizeText, getDocumentTextHash } = require('./semantic/text');
const { openSemanticStore } = require('./semantic/store');
const { listModels, isOllamaReachable, embedText, OllamaError } = require('./semantic/ollama-embeddings');
const { cosineSimilarity } = require('./semantic/vector');

let win;
let currentProjectPath = null;
let isQuitting = false;
let semanticAvailabilityCache = null;
let semanticAvailabilityCheckedAt = 0;
const semanticIndexJobsByWebContents = new Map();

const BACKUP_MAX_RECENT = 20;
const BACKUP_DAILY_DAYS = 14;
const BACKUP_DIR_NAME = 'project-backups';
const LAST_PROJECT_FILE = 'last-project-path.json';
const MAX_QDPX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB
const MAX_DOCUMENT_FILE_BYTES = 256 * 1024 * 1024; // 256 MB
const MAX_OCR_IMAGE_BYTES = 32 * 1024 * 1024; // 32 MB

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

function estimateBase64DecodedBytes(base64Value) {
  const base64 = String(base64Value || '');
  if (!base64) return 0;
  let padding = 0;
  if (base64.endsWith('==')) padding = 2;
  else if (base64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
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

function getSemanticDbPath() {
  if (!currentProjectPath) return null;
  const base = path.basename(currentProjectPath, path.extname(currentProjectPath));
  return path.join(path.dirname(currentProjectPath), `${base}.semantic.sqlite`);
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
  const requested = splitModelNameTag(requestedModel);
  const installed = splitModelNameTag(installedModel);
  if (!requested.base || !installed.base) return false;
  if (requested.base !== installed.base) return false;
  if (!requested.tag) return true; // "bge-m3" matches "bge-m3" and "bge-m3:*"
  return requested.tag === installed.tag;
}

function findBestInstalledModel(requestedModel, installedModels) {
  const models = Array.isArray(installedModels) ? installedModels : [];
  if (!requestedModel) return '';
  const exact = models.find((name) => String(name) === String(requestedModel));
  if (exact) return exact;
  const prefixed = models.find((name) => modelNameMatches(requestedModel, name));
  return prefixed || '';
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
  const configured = String(preferredModel || SEMANTIC_DEFAULTS.embeddingModel);
  const selectedConfigured = findBestInstalledModel(configured, models);
  const selectedFallback = findBestInstalledModel(SEMANTIC_DEFAULTS.fallbackEmbeddingModel, models);
  const selectedModel = selectedConfigured || selectedFallback || '';
  const modelReady = !!selectedModel;

  if (!modelReady) {
    return {
      reachable: true,
      available: true,
      configuredModel: configured,
      selectedModel: '',
      fallbackUsed: false,
      modelReady: false,
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

function stopSemanticIndexJob(webContentsId) {
  const job = semanticIndexJobsByWebContents.get(webContentsId);
  if (!job) return false;
  try {
    job.worker.postMessage({ type: 'cancel' });
  } catch (_) {}
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

  win.loadFile(path.join(__dirname, 'index.html'));

  // Handle window close properly
  win.on('close', (e) => {
    if (isMac && !isQuitting) {
      // On macOS, hide the window instead of closing (standard behaviour)
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => {
    if (win && win.webContents) {
      stopSemanticIndexJob(win.webContents.id);
      semanticIndexJobsByWebContents.delete(win.webContents.id);
    }
    win = null;
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
            // Destroy window first to bypass the close handler that hides instead of closing
            if (win) {
              win.destroy();
              win = null;
            }
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
          click: () => win.webContents.send('menu:action', 'newProject')
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
          click: () => win.webContents.send('menu:action', 'save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => win.webContents.send('menu:action', 'saveAs')
        },
        { type: 'separator' },
        ...(isMac ? [] : [{
          label: 'Quit',
          accelerator: 'Alt+F4',
          click: () => {
            if (win) {
              win.destroy();
              win = null;
            }
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
  await persistLastProjectPath(currentProjectPath);
  win.webContents.send('project:openQdpx', buffer);
}

ipcMain.handle('project:open', async () => {
  await openProject();
  return { ok: true };
});

ipcMain.handle('project:clearHandle', async () => {
  currentProjectPath = null;
  clearSemanticAvailabilityCache();
  await persistLastProjectPath(null);
  return { ok: true };
});

ipcMain.handle('project:hasHandle', async () => {
  return !!currentProjectPath;
});



ipcMain.handle('project:save', async (_evt, payload, opts) => {
  const saveAs = !!(opts && opts.saveAs);

  try {
    if (!currentProjectPath || saveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save Quackdas project',
        defaultPath: currentProjectPath || `quackdas-project.qdpx`,
        filters: [
          { name: 'Quackdas Project', extensions: ['qdpx'] }
        ]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      currentProjectPath = filePath;
      clearSemanticAvailabilityCache();
    }

    const qdpxBase64 = (payload && typeof payload === 'object')
      ? String(payload.qdpxBase64 || '')
      : String(payload || '');
    // QDPX-only save path.
    let ext = path.extname(currentProjectPath).toLowerCase();
    if (!ext) {
      ext = '.qdpx';
      currentProjectPath = currentProjectPath + ext;
    }
    if (ext !== '.qdpx') {
      throw new Error('Quackdas now saves projects in QDPX format only (.qdpx).');
    }
    if (!qdpxBase64) {
      throw new Error('Could not save QDPX: binary payload is missing.');
    }
    const buffer = Buffer.from(qdpxBase64, 'base64');
    await fs.promises.writeFile(currentProjectPath, buffer);
    await persistLastProjectPath(currentProjectPath);

    return { ok: true, path: currentProjectPath };
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
    currentProjectPath = rememberedPath;
    clearSemanticAvailabilityCache();
    await persistLastProjectPath(currentProjectPath);

    if (ext !== '.qdpx') {
      await persistLastProjectPath(null);
      return { ok: false, reason: 'unsupported' };
    }
    await ensureFileWithinLimit(rememberedPath, MAX_QDPX_FILE_BYTES, 'Last opened project file');
    const buffer = await fs.promises.readFile(rememberedPath);
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
    const buffer = Buffer.from(data, 'base64');
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
    const modelName = getProjectSemanticModelName(dbPath);
    return { ok: true, modelName, dbPath: dbPath || '' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), modelName: SEMANTIC_DEFAULTS.embeddingModel };
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
      const states = new Map(store.getAllDocStates().map((row) => [row.docId, row]));
      let indexedDocCount = 0;
      docs.forEach((doc) => {
        const expectedHash = getDocumentTextHash(doc.content);
        const row = states.get(doc.id);
        if (!row) return;
        if (row.docTextHash !== expectedHash) return;
        if (Number(row.chunkCount) <= 0 && doc.content.length > 0) return;
        indexedDocCount += 1;
      });
      const totalDocs = docs.length;
      const chunkCount = store.getTotalChunkCount();
      const isIndexed = totalDocs > 0 && indexedDocCount === totalDocs;
      const state = isIndexed ? 'indexed' : 'not_indexed';
      return { ok: true, state, indexedDocCount, totalDocs, chunkCount };
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
      webContents.send('semantic:indexProgress', job.progress);
      return;
    }

    if (msg.type === 'done') {
      job.status = 'done';
      webContents.send('semantic:indexDone', Object.assign({ ok: true }, msg.payload || {}));
      semanticIndexJobsByWebContents.delete(webContentsId);
      clearSemanticAvailabilityCache();
      return;
    }

    if (msg.type === 'cancelled') {
      job.status = 'cancelled';
      webContents.send('semantic:indexError', msg.payload || { ok: false, code: 'INDEX_CANCELLED', message: 'Indexing cancelled.' });
      semanticIndexJobsByWebContents.delete(webContentsId);
      return;
    }

    if (msg.type === 'error') {
      job.status = 'error';
      webContents.send('semantic:indexError', msg.payload || { ok: false, code: 'INDEX_FAILED', message: 'Indexing failed.' });
      semanticIndexJobsByWebContents.delete(webContentsId);
    }
  });

  worker.on('error', (err) => {
    job.status = 'error';
    webContents.send('semantic:indexError', { ok: false, code: 'WORKER_ERROR', message: err?.message || String(err) });
    semanticIndexJobsByWebContents.delete(webContentsId);
  });

  worker.on('exit', (code) => {
    const current = semanticIndexJobsByWebContents.get(webContentsId);
    if (current && current.worker === worker && current.status === 'running' && code !== 0) {
      webContents.send('semantic:indexError', { ok: false, code: 'WORKER_EXIT', message: `Index worker exited with code ${code}.` });
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

    const availability = await getSemanticAvailability({ force: true });
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

    const store = openSemanticStore(dbPath);
    let rows = [];
    try {
      rows = store.getEmbeddingsForModel(modelName);
    } finally {
      store.close();
    }

    const scored = rows.map((row) => ({
      doc_id: row.docId,
      chunk_id: row.chunkId,
      chunk_index: row.chunkIndex,
      start_char: row.startChar,
      end_char: row.endChar,
      score: cosineSimilarity(queryEmbedding, row.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);
    const topK = Math.max(1, Number(payload.topK || SEMANTIC_DEFAULTS.searchTopK));
    return { ok: true, modelName, results: scored.slice(0, topK) };
  } catch (err) {
    if (err instanceof OllamaError) {
      return { ok: false, error: err.message, code: err.code };
    }
    return { ok: false, error: err?.message || String(err) };
  }
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
    currentProjectPath = filePath;
    clearSemanticAvailabilityCache();
    await persistLastProjectPath(currentProjectPath);
    const buffer = await fs.promises.readFile(filePath);
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

// OCR helper for scanned/image-only PDFs (renderer sends page image as data URL).
ipcMain.handle('ocr:image', async (_evt, payload = {}) => {
  let tmpDir = null;
  const formatOcrError = (err, stderrText = '') => {
    const stderr = String(stderrText || '').trim();
    const raw = String(err?.message || err || 'Unknown OCR error');

    if (err && err.code === 'ENOENT') {
      return {
        code: 'ENOENT',
        error: 'Tesseract OCR was not found on this machine.',
        hint: 'Install Tesseract and restart Quackdas. On macOS: brew install tesseract tesseract-lang'
      };
    }

    if (stderr.includes('Failed loading language')) {
      return {
        code: 'LANG_MISSING',
        error: 'Tesseract could not load one or more OCR language models.',
        hint: 'Install language data (for Swedish+English on macOS: brew install tesseract-lang).'
      };
    }

    if (err && (err.killed || err.signal === 'SIGTERM')) {
      return {
        code: 'TIMEOUT',
        error: 'OCR timed out while processing this page.',
        hint: 'Try a lower-resolution scan or fewer pages at a time.'
      };
    }

    return {
      code: err?.code || 'OCR_FAILED',
      error: raw,
      hint: stderr ? `Tesseract details: ${stderr.slice(0, 240)}` : ''
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

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-ocr-'));
    const imgPath = path.join(tmpDir, 'page.png');
    const outBase = path.join(tmpDir, 'ocr');
    const tsvPath = outBase + '.tsv';
    fs.writeFileSync(imgPath, imageBuffer);

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

    const tsv = fs.readFileSync(tsvPath, 'utf8');
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
      code: normalized.code,
      hint: normalized.hint || ''
    };
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
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
  if (win) {
    win.destroy();
    win = null;
  }
});

app.on('activate', () => {
  // On macOS, re-show the window when clicking dock icon
  if (win) {
    win.show();
  } else {
    createWindow();
  }
});
