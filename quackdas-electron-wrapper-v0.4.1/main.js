
const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let win;
let currentProjectPath = null;
let isQuitting = false;

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
          click: () => openProject()
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
      { name: 'Quackdas Project', extensions: ['qdpx', 'json'] }
    ]
  });

  if (canceled || !filePaths || !filePaths[0]) return;

  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  
  if (ext === '.qdpx') {
    // QDPX file - read as binary and send to renderer
    const buffer = fs.readFileSync(filePath);
    currentProjectPath = filePath;
    win.webContents.send('project:openQdpx', buffer);
  } else {
    // Legacy JSON file
    const jsonText = fs.readFileSync(filePath, 'utf-8');
    currentProjectPath = filePath;
    win.webContents.send('project:openData', jsonText);
  }
}

ipcMain.handle('project:open', async () => {
  await openProject();
  return { ok: true };
});

ipcMain.handle('project:clearHandle', async () => {
  currentProjectPath = null;
  return { ok: true };
});

ipcMain.handle('project:hasHandle', async () => {
  return !!currentProjectPath;
});



ipcMain.handle('project:save', async (_evt, data, opts) => {
  const saveAs = !!opts.saveAs;
  const isQdpx = !!opts.isQdpx;

  try {
    if (!currentProjectPath || saveAs) {
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Save Quackdas project',
        defaultPath: currentProjectPath || `quackdas-project.qdpx`,
        filters: [
          { name: 'Quackdas Project', extensions: ['qdpx'] },
          { name: 'Legacy JSON', extensions: ['json'] }
        ]
      });
      if (canceled || !filePath) return { ok: false, canceled: true };
      currentProjectPath = filePath;
    }

    // Determine format based on extension
    const ext = path.extname(currentProjectPath).toLowerCase();
    
    if (ext === '.qdpx' || isQdpx) {
      // QDPX format - data is a base64-encoded zip
      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync(currentProjectPath, buffer);
    } else {
      // Legacy JSON format
      fs.writeFileSync(currentProjectPath, data, 'utf-8');
    }

    return { ok: true, path: currentProjectPath };
  } catch (err) {
    dialog.showErrorBox('Save failed', err.message || String(err));
    return { ok: false, error: err.message || String(err) };
  }
});


// Native file helpers (used to avoid relying on <input type="file"> in packaged builds)
ipcMain.handle('file:openProjectFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import Quackdas project',
    properties: ['openFile'],
    filters: [
      { name: 'Quackdas Project', extensions: ['qdpx', 'json'] }
    ]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const filePath = filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.qdpx') {
      const buffer = fs.readFileSync(filePath);
      return { ok: true, kind: 'qdpx', data: buffer.toString('base64') };
    } else {
      const jsonText = fs.readFileSync(filePath, 'utf-8');
      return { ok: true, kind: 'json', data: jsonText };
    }
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
    if (ext === 'docx') {
      const buf = fs.readFileSync(p);
      return { ok: true, kind: 'docx', name, data: buf.toString('base64') };
    } else if (ext === 'pdf') {
      const buf = fs.readFileSync(p);
      return { ok: true, kind: 'pdf', name, data: buf.toString('base64') };
    } else {
      const text = fs.readFileSync(p, 'utf-8');
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
    const imageBuffer = Buffer.from(imageBase64, 'base64');

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
