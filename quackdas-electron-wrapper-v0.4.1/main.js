
const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const fs = require('fs');
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