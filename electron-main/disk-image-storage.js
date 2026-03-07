const DEFAULT_BLOCKED_AGENT_APPS = [
  'Codex',
  'Claude',
  'Claude Workspace',
  'Cursor',
  'Windsurf'
];

function sanitizeBlockedAgentAppEntry(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function sanitizeBlockedAgentAppEntries(values) {
  const seen = new Set();
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const normalized = sanitizeBlockedAgentAppEntry(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function normalizeDiskImageSettings(raw) {
  const input = (raw && typeof raw === 'object') ? raw : {};
  return {
    enabled: !!input.enabled,
    imagePath: String(input.imagePath || '').trim(),
    autoMount: input.autoMount !== false,
    autoUnmountOnClose: input.autoUnmountOnClose !== false,
    allowManualOverride: !!input.allowManualOverride,
    blockedApps: sanitizeBlockedAgentAppEntries(
      Array.isArray(input.blockedApps) && input.blockedApps.length > 0
        ? input.blockedApps
        : DEFAULT_BLOCKED_AGENT_APPS
    )
  };
}

function parseBlockedAgentAppsInput(text) {
  return sanitizeBlockedAgentAppEntries(String(text || '').split(/\r?\n/));
}

function extractLeadingPath(text) {
  const match = String(text || '').trim().match(/^(\/.*?)(?=\s--|$)/);
  return match ? match[1] : '';
}

function extractPrimaryProcessName(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  const appMatches = [...source.matchAll(/\/([^/\n]+?)\.app(?=\/|$)/gi)];
  if (appMatches.length > 0) {
    return sanitizeBlockedAgentAppEntry(appMatches[appMatches.length - 1][1] || '');
  }
  return sanitizeBlockedAgentAppEntry(source.split('/').pop() || source);
}

function parsePsOutput(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\S+)(?:\s+(.*))?$/);
      if (!match) return null;
      const pid = Number(match[1]);
      const command = String(match[2] || '').trim();
      const args = String(match[3] || '').trim();
      const leadingArgPath = extractLeadingPath(args);
      const candidateNames = sanitizeBlockedAgentAppEntries([
        extractPrimaryProcessName(command),
        extractPrimaryProcessName(leadingArgPath)
      ]);
      const baseName = candidateNames[0] || command.split('/').pop() || command;
      return {
        pid: Number.isFinite(pid) ? pid : 0,
        command,
        args,
        baseName,
        candidateNames,
        normalized: candidateNames.map((value) => value.toLowerCase())
      };
    })
    .filter(Boolean);
}

function detectBlockedApps(processRows, blockedApps) {
  const rows = Array.isArray(processRows) ? processRows : [];
  const needles = sanitizeBlockedAgentAppEntries(blockedApps).map((entry) => entry.toLowerCase());
  const matches = [];
  const seen = new Set();

  rows.forEach((row) => {
    const candidateNames = Array.isArray(row?.normalized)
      ? row.normalized
      : sanitizeBlockedAgentAppEntries([row?.baseName || row?.command || '']).map((value) => value.toLowerCase());
    needles.forEach((needle) => {
      if (!needle) return;
      const matchedIndex = candidateNames.findIndex((value) => value === needle);
      if (matchedIndex === -1) return;
      const key = needle;
      if (seen.has(key)) return;
      seen.add(key);
      matches.push({
        needle,
        pid: row.pid,
        command: row.command,
        baseName: Array.isArray(row?.candidateNames) ? row.candidateNames[matchedIndex] : row.baseName
      });
    });
  });

  return matches;
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/&#13;/g, '\r')
    .replace(/&#9;/g, '\t')
    .replace(/&#39;/g, "'");
}

function extractPlistString(plistXml, key) {
  const pattern = new RegExp(`<key>${escapeRegExp(key)}</key>\\s*<string>([\\s\\S]*?)</string>`, 'i');
  const match = pattern.exec(String(plistXml || ''));
  return match ? decodeXmlEntities(match[1]) : '';
}

function extractAllMountPointsFromAttachPlist(plistXml) {
  const xml = String(plistXml || '');
  const matches = [...xml.matchAll(/<key>mount-point<\/key>\s*<string>([\s\S]*?)<\/string>/gi)];
  return matches.map((match) => decodeXmlEntities(match[1])).filter(Boolean);
}

function parseHdiutilInfoOutput(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const images = [];
  let current = null;

  lines.forEach((line) => {
    const imageMatch = line.match(/^\s*image-path\s*:\s*(.+?)\s*$/i);
    if (imageMatch) {
      if (current) images.push(current);
      current = {
        imagePath: imageMatch[1].trim(),
        mountPoints: []
      };
      return;
    }
    const mountMatch = line.match(/^\s*\/dev\/\S+\s+\S+\s+(\/.+?)\s*$/);
    if (mountMatch && current) {
      current.mountPoints.push(mountMatch[1].trim());
    }
  });

  if (current) images.push(current);
  return images;
}

function createDiskImageStorageService(deps) {
  const {
    app,
    ipcMain,
    dialog,
    fs,
    path,
    execFile,
    getWindow,
    getPreferences,
    setPreferences,
    getCurrentProjectPath,
    clearSemanticAvailabilityCache
  } = deps;

  const runtimeState = {
    mountedVolumePath: '',
    mountedByAppThisSession: false,
    lastMessage: '',
    lastBlockedApps: [],
    startupMountResult: null
  };

  function supportsDiskImageStorage() {
    return process.platform === 'darwin';
  }

  function getSettings() {
    const prefs = typeof getPreferences === 'function' ? getPreferences() : {};
    return normalizeDiskImageSettings(prefs?.diskImageSettings || {});
  }

  function updateSettings(patch) {
    const next = normalizeDiskImageSettings(Object.assign({}, getSettings(), patch || {}));
    if (typeof setPreferences === 'function') {
      setPreferences({
        diskImageSettings: next,
        diskImageStorage: !!next.enabled
      });
    }
    return next;
  }

  function runExecFile(command, args) {
    return new Promise((resolve, reject) => {
      execFile(command, args, {
        timeout: 120000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  }

  async function listRunningBlockedApps(blockedApps = getSettings().blockedApps) {
    if (!supportsDiskImageStorage()) return [];
    try {
      const { stdout } = await runExecFile('ps', ['-axo', 'pid=,comm=,args=']);
      return detectBlockedApps(parsePsOutput(stdout), blockedApps);
    } catch (_) {
      return [];
    }
  }

  async function getMountedVolumePath(imagePath) {
    const target = String(imagePath || '').trim();
    if (!target || !supportsDiskImageStorage()) return '';
    try {
      const { stdout } = await runExecFile('hdiutil', ['info']);
      const images = parseHdiutilInfoOutput(stdout);
      const matched = images.find((row) => row.imagePath === target);
      return matched && matched.mountPoints[0] ? matched.mountPoints[0] : '';
    } catch (_) {
      return '';
    }
  }

  async function isConfiguredImageMounted() {
    const settings = getSettings();
    const mountPath = await getMountedVolumePath(settings.imagePath);
    if (mountPath) runtimeState.mountedVolumePath = mountPath;
    return !!mountPath;
  }

  function isCurrentProjectOnMountedImage(volumePath) {
    const mountPath = String(volumePath || '').trim();
    const projectPath = typeof getCurrentProjectPath === 'function' ? String(getCurrentProjectPath() || '').trim() : '';
    if (!mountPath || !projectPath) return false;
    return projectPath === mountPath || projectPath.startsWith(`${mountPath}${path.sep}`);
  }

  async function mountConfiguredImage(options = {}) {
    const settings = getSettings();
    if (!supportsDiskImageStorage()) {
      return { ok: false, error: 'Disk image storage is only supported on macOS.', code: 'UNSUPPORTED' };
    }
    if (!settings.imagePath) {
      return { ok: false, error: 'Choose a disk image first.', code: 'MISSING_IMAGE' };
    }
    try {
      await fs.promises.access(settings.imagePath, fs.constants.R_OK);
    } catch (_) {
      return { ok: false, error: 'The configured disk image could not be read.', code: 'IMAGE_NOT_FOUND' };
    }

    const existingMountPath = await getMountedVolumePath(settings.imagePath);
    if (existingMountPath) {
      runtimeState.mountedVolumePath = existingMountPath;
      runtimeState.lastBlockedApps = [];
      runtimeState.lastMessage = 'Disk image already mounted.';
      return {
        ok: true,
        mounted: true,
        mountPath: existingMountPath,
        blockedApps: [],
        message: runtimeState.lastMessage,
        alreadyMounted: true
      };
    }

    const blockedApps = await listRunningBlockedApps(settings.blockedApps);
    const manualOverride = !!options.manualOverride;
    if (blockedApps.length > 0 && !(manualOverride && settings.allowManualOverride)) {
      runtimeState.lastBlockedApps = blockedApps;
      runtimeState.lastMessage = `Auto-mount blocked because ${blockedApps.map((row) => row.baseName).join(', ')} is running.`;
      return {
        ok: false,
        blocked: true,
        blockedApps,
        code: 'BLOCKED_APPS_RUNNING',
        error: runtimeState.lastMessage
      };
    }

    try {
      const { stdout } = await runExecFile('hdiutil', ['attach', settings.imagePath, '-plist']);
      const mountPoints = extractAllMountPointsFromAttachPlist(stdout);
      const mountPath = mountPoints[0] || await getMountedVolumePath(settings.imagePath);
      runtimeState.mountedVolumePath = mountPath || '';
      runtimeState.mountedByAppThisSession = !!mountPath;
      runtimeState.lastBlockedApps = blockedApps;
      runtimeState.lastMessage = mountPath ? `Mounted ${path.basename(mountPath)}.` : 'Disk image mounted.';
      if (typeof clearSemanticAvailabilityCache === 'function') clearSemanticAvailabilityCache();
      return {
        ok: true,
        mounted: true,
        mountPath: mountPath || '',
        blockedApps,
        message: runtimeState.lastMessage,
        alreadyMounted: false
      };
    } catch (err) {
      const stderr = String(err?.stderr || '').trim();
      runtimeState.lastMessage = stderr || err?.message || 'Disk image mount failed.';
      return {
        ok: false,
        error: runtimeState.lastMessage,
        code: String(err?.code || 'ATTACH_FAILED')
      };
    }
  }

  async function unmountConfiguredImage(options = {}) {
    const settings = getSettings();
    if (!supportsDiskImageStorage()) {
      return { ok: false, error: 'Disk image storage is only supported on macOS.', code: 'UNSUPPORTED' };
    }
    if (!settings.imagePath) {
      return { ok: false, error: 'No configured disk image to unmount.', code: 'MISSING_IMAGE' };
    }

    const mountPath = await getMountedVolumePath(settings.imagePath);
    if (!mountPath) {
      runtimeState.mountedVolumePath = '';
      runtimeState.lastMessage = 'Disk image is not mounted.';
      return { ok: true, mounted: false, mountPath: '', message: runtimeState.lastMessage };
    }

    const allowProjectDetach = !!options.allowProjectDetach;
    if (!allowProjectDetach && isCurrentProjectOnMountedImage(mountPath)) {
      return {
        ok: false,
        error: 'Close or move the current project before unmounting the disk image.',
        code: 'PROJECT_STILL_OPEN',
        mountPath
      };
    }

    try {
      await runExecFile('hdiutil', ['detach', mountPath]);
      runtimeState.mountedVolumePath = '';
      runtimeState.mountedByAppThisSession = false;
      runtimeState.lastMessage = 'Disk image unmounted.';
      if (typeof clearSemanticAvailabilityCache === 'function') clearSemanticAvailabilityCache();
      return { ok: true, mounted: false, mountPath: '', message: runtimeState.lastMessage };
    } catch (err) {
      const stderr = String(err?.stderr || '').trim();
      runtimeState.lastMessage = stderr || err?.message || 'Disk image unmount failed.';
      return {
        ok: false,
        error: runtimeState.lastMessage,
        code: String(err?.code || 'DETACH_FAILED'),
        mountPath
      };
    }
  }

  async function chooseDiskImagePath() {
    if (!supportsDiskImageStorage()) {
      return { ok: false, error: 'Disk image storage is only supported on macOS.', code: 'UNSUPPORTED' };
    }
    const parentWindow = typeof getWindow === 'function' ? getWindow() : null;
    const result = await dialog.showOpenDialog(parentWindow, {
      title: 'Choose disk image',
      properties: ['openFile'],
      filters: [
        { name: 'Disk images', extensions: ['sparsebundle', 'sparseimage', 'dmg'] }
      ]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { ok: false, canceled: true };
    }
    const imagePath = String(result.filePaths[0] || '').trim();
    const nextSettings = updateSettings({ imagePath });
    return {
      ok: true,
      imagePath,
      settings: nextSettings
    };
  }

  async function getStatus() {
    const settings = getSettings();
    const mountPath = settings.imagePath ? await getMountedVolumePath(settings.imagePath) : '';
    const blockedApps = settings.enabled ? await listRunningBlockedApps(settings.blockedApps) : [];
    if (mountPath) runtimeState.mountedVolumePath = mountPath;
    runtimeState.lastBlockedApps = blockedApps;
    return {
      ok: true,
      supported: supportsDiskImageStorage(),
      settings,
      mounted: !!mountPath,
      mountPath: mountPath || '',
      mountedByAppThisSession: !!runtimeState.mountedByAppThisSession && !!mountPath,
      blockedApps,
      lastMessage: runtimeState.lastMessage || '',
      startupMountResult: runtimeState.startupMountResult ? Object.assign({}, runtimeState.startupMountResult) : null,
      currentProjectOnImage: isCurrentProjectOnMountedImage(mountPath)
    };
  }

  async function prepareStartupMount() {
    const settings = getSettings();
    if (!supportsDiskImageStorage() || !settings.enabled || !settings.autoMount || !settings.imagePath) {
      runtimeState.startupMountResult = {
        ok: true,
        attempted: false,
        mounted: false,
        skipped: true
      };
      return Object.assign({}, runtimeState.startupMountResult);
    }
    try {
      const result = Object.assign({ attempted: true }, await mountConfiguredImage({ manualOverride: false }));
      runtimeState.startupMountResult = Object.assign({}, result);
      return result;
    } catch (err) {
      runtimeState.startupMountResult = {
        ok: false,
        attempted: true,
        code: 'STARTUP_MOUNT_FAILED',
        error: err?.message || String(err)
      };
      return Object.assign({}, runtimeState.startupMountResult);
    }
  }

  async function maybeUnmountOnQuit() {
    const settings = getSettings();
    if (!supportsDiskImageStorage() || !settings.enabled || !settings.autoUnmountOnClose) {
      return { ok: true, attempted: false, skipped: true };
    }
    if (!runtimeState.mountedByAppThisSession) {
      return { ok: true, attempted: false, skipped: true };
    }
    const result = await unmountConfiguredImage({ allowProjectDetach: true });
    return Object.assign({ attempted: true }, result);
  }

  function registerHandlers() {
    ipcMain.handle('diskImage:getSettings', async () => getStatus());
    ipcMain.handle('diskImage:updateSettings', async (_evt, patch = {}) => {
      const nextSettings = updateSettings(patch || {});
      return {
        ok: true,
        supported: supportsDiskImageStorage(),
        settings: nextSettings
      };
    });
    ipcMain.handle('diskImage:chooseImage', async () => chooseDiskImagePath());
    ipcMain.handle('diskImage:mount', async (_evt, opts = {}) => mountConfiguredImage(opts || {}));
    ipcMain.handle('diskImage:unmount', async (_evt, opts = {}) => unmountConfiguredImage(opts || {}));
    ipcMain.handle('diskImage:listBlockedApps', async () => {
      const settings = getSettings();
      const blockedApps = await listRunningBlockedApps(settings.blockedApps);
      runtimeState.lastBlockedApps = blockedApps;
      return { ok: true, blockedApps };
    });
  }

  return {
    DEFAULT_BLOCKED_AGENT_APPS,
    getSettings,
    updateSettings,
    getStatus,
    chooseDiskImagePath,
    mountConfiguredImage,
    unmountConfiguredImage,
    prepareStartupMount,
    maybeUnmountOnQuit,
    registerHandlers
  };
}

module.exports = {
  DEFAULT_BLOCKED_AGENT_APPS,
  normalizeDiskImageSettings,
  parseBlockedAgentAppsInput,
  parsePsOutput,
  detectBlockedApps,
  parseHdiutilInfoOutput,
  extractAllMountPointsFromAttachPlist,
  createDiskImageStorageService
};
