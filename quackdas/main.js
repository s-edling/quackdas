
const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let win;
let currentProjectPath = null;
let isQuitting = false;

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
  await persistLastProjectPath(currentProjectPath);
  win.webContents.send('project:openQdpx', buffer);
}

ipcMain.handle('project:open', async () => {
  await openProject();
  return { ok: true };
});

ipcMain.handle('project:clearHandle', async () => {
  currentProjectPath = null;
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
