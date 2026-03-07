const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createProjectBackupService } = require('../electron-main/project-backups');

function sanitizeName(name, fallback = 'untitled-project') {
  return String(name || fallback)
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || fallback;
}

test('project backup handlers create, list, and restore backups for current project bucket', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-backups-'));
  const handlers = new Map();
  const currentProjectPath = path.join(tempDir, 'projects', 'analysis.qdpx');

  const service = createProjectBackupService({
    app: { getPath: () => tempDir },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    },
    fs,
    path,
    crypto,
    sanitizeName,
    decodeBase64PayloadOrThrow(base64, maxBytes) {
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > maxBytes) throw new Error('too large');
      return buffer;
    },
    maxQdpxBytes: 1024 * 1024,
    getCurrentProjectPath: () => currentProjectPath
  });

  service.registerHandlers();

  const createBackup = handlers.get('project:createBackup');
  const listBackups = handlers.get('project:listBackups');
  const restoreBackup = handlers.get('project:restoreBackup');

  const payload = Buffer.from('test-project').toString('base64');
  const created = await createBackup(null, payload, { reason: 'manual save', projectName: 'Ignored name' });
  assert.equal(created.ok, true);
  assert.match(created.id, /\.qdpx$/);

  const listed = await listBackups(null, { projectName: 'Ignored name' });
  assert.equal(listed.ok, true);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].reason, 'manual save');

  const restored = await restoreBackup(null, created.id, { projectName: 'Ignored name' });
  assert.equal(restored.ok, true);
  assert.equal(Buffer.from(restored.data, 'base64').toString('utf8'), 'test-project');

  const invalid = await restoreBackup(null, '../bad.txt', { projectName: 'Ignored name' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /Invalid backup identifier/);
});

test('project backup handlers store backups next to the project when disk image storage mode is enabled', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-backups-local-'));
  const handlers = new Map();
  const projectDir = path.join(tempDir, 'mounted-image');
  const currentProjectPath = path.join(projectDir, 'analysis.qdpx');
  fs.mkdirSync(projectDir, { recursive: true });

  const service = createProjectBackupService({
    app: { getPath: () => tempDir },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    },
    fs,
    path,
    crypto,
    sanitizeName,
    decodeBase64PayloadOrThrow(base64, maxBytes) {
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > maxBytes) throw new Error('too large');
      return buffer;
    },
    maxQdpxBytes: 1024 * 1024,
    getCurrentProjectPath: () => currentProjectPath,
    getDiskImageStorageEnabled: () => true
  });

  service.registerHandlers();

  const createBackup = handlers.get('project:createBackup');
  const listBackups = handlers.get('project:listBackups');

  const payload = Buffer.from('disk-image-project').toString('base64');
  const created = await createBackup(null, payload, { reason: 'interval', projectName: 'Ignored name' });
  assert.equal(created.ok, true);

  const localBackupDir = path.join(projectDir, '.quackdas-backups');
  assert.equal(fs.existsSync(localBackupDir), true);
  const localFiles = fs.readdirSync(localBackupDir);
  assert.equal(localFiles.length, 1);
  assert.equal(path.extname(localFiles[0]), '.qdpx');

  const appLocalRoot = path.join(tempDir, 'project-backups');
  assert.equal(fs.existsSync(appLocalRoot), false);

  const listed = await listBackups(null, { projectName: 'Ignored name' });
  assert.equal(listed.ok, true);
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].reason, 'interval');
});

test('project backup restore rejects oversized backup files before reading them into memory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-backups-large-'));
  const handlers = new Map();
  const currentProjectPath = path.join(tempDir, 'projects', 'analysis.qdpx');

  const service = createProjectBackupService({
    app: { getPath: () => tempDir },
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      }
    },
    fs,
    path,
    crypto,
    sanitizeName,
    decodeBase64PayloadOrThrow(base64, maxBytes) {
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > maxBytes) throw new Error('too large');
      return buffer;
    },
    maxQdpxBytes: 8,
    getCurrentProjectPath: () => currentProjectPath
  });

  service.registerHandlers();

  const createBackup = handlers.get('project:createBackup');
  const restoreBackup = handlers.get('project:restoreBackup');

  const created = await createBackup(null, Buffer.from('0123456789').toString('base64'), {
    reason: 'manual save',
    projectName: 'Ignored name'
  });

  assert.equal(created.ok, false);

  const backupDir = path.join(tempDir, 'project-backups');
  fs.mkdirSync(path.join(backupDir, service.getBackupBucket('Ignored name')), { recursive: true });
  const backupPath = path.join(backupDir, service.getBackupBucket('Ignored name'), '20260307T120000Z__manual-save.qdpx');
  fs.writeFileSync(backupPath, Buffer.from('0123456789'));

  const restored = await restoreBackup(null, path.basename(backupPath), { projectName: 'Ignored name' });
  assert.equal(restored.ok, false);
  assert.match(restored.error, /too large/i);
});
