const { writeFileAtomically } = require('./project-files');

const BACKUP_MAX_RECENT = 20;
const BACKUP_DAILY_DAYS = 14;
const BACKUP_DIR_NAME = 'project-backups';

function createProjectBackupService(deps) {
  const {
    app,
    ipcMain,
    fs,
    path,
    crypto,
    sanitizeName,
    decodeBase64PayloadOrThrow,
    maxQdpxBytes,
    getCurrentProjectPath,
    getDiskImageStorageEnabled,
    onBackupWriteStateChange
  } = deps;

  function getBackupRootDir() {
    return path.join(app.getPath('userData'), BACKUP_DIR_NAME);
  }

  function getProjectLocalBackupDir() {
    const currentProjectPath = typeof getCurrentProjectPath === 'function' ? getCurrentProjectPath() : null;
    if (!currentProjectPath) return '';
    return path.join(path.dirname(currentProjectPath), '.quackdas-backups');
  }

  function shouldUseProjectLocalBackups() {
    return !!(typeof getDiskImageStorageEnabled === 'function' && getDiskImageStorageEnabled() && getProjectLocalBackupDir());
  }

  function getBackupStorageDir(projectName = 'untitled-project') {
    if (shouldUseProjectLocalBackups()) {
      return getProjectLocalBackupDir();
    }
    const bucket = getBackupBucket(projectName);
    return path.join(getBackupRootDir(), bucket);
  }

  function getBackupBucket(projectName = 'untitled-project') {
    const currentProjectPath = typeof getCurrentProjectPath === 'function' ? getCurrentProjectPath() : null;
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

  async function ensureBackupWithinLimit(backupPath, label = 'Backup file') {
    const stat = await fs.promises.stat(backupPath);
    if (!stat.isFile()) {
      throw new Error(`${label} is not a regular file.`);
    }
    if (stat.size > maxQdpxBytes) {
      throw new Error(`${label} is too large.`);
    }
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
    const backupDir = getBackupStorageDir(projectName);
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

  function registerHandlers() {
    ipcMain.handle('project:createBackup', async (_evt, data, opts = {}) => {
      let writeTracked = false;
      try {
        if (!data || typeof data !== 'string') {
          return { ok: false, error: 'Invalid backup payload.' };
        }
        const reason = String(opts.reason || 'auto-backup');
        const projectName = String(opts.projectName || 'untitled-project');
        const backupDir = getBackupStorageDir(projectName);
        await fs.promises.mkdir(backupDir, { recursive: true });

        const backupName = makeBackupFileName(reason);
        const backupPath = path.join(backupDir, backupName);
        const buffer = decodeBase64PayloadOrThrow(data, maxQdpxBytes, 'Backup payload');
        if (typeof onBackupWriteStateChange === 'function') {
          onBackupWriteStateChange(1);
          writeTracked = true;
        }
        await writeFileAtomically({ fs, path }, backupPath, buffer);
        if (writeTracked && typeof onBackupWriteStateChange === 'function') {
          onBackupWriteStateChange(-1);
          writeTracked = false;
        }
        await pruneBackups(backupDir);

        return { ok: true, id: backupName };
      } catch (err) {
        if (writeTracked && typeof onBackupWriteStateChange === 'function') onBackupWriteStateChange(-1);
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

        const backupPath = path.join(getBackupStorageDir(projectName), id);
        await ensureBackupWithinLimit(backupPath, 'Backup file');
        const data = await fs.promises.readFile(backupPath);
        return { ok: true, kind: 'qdpx', data: data.toString('base64') };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    });
  }

  return {
    getBackupBucket,
    parseBackupReason,
    makeBackupFileName,
    listBackupsForBucket,
    pruneBackups,
    registerHandlers
  };
}

module.exports = {
  BACKUP_MAX_RECENT,
  BACKUP_DAILY_DAYS,
  createProjectBackupService
};
