function makeTempProjectPath(path, targetPath) {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return path.join(dir, `.${base}.${suffix}.tmp`);
}

async function fsyncDirIfPossible(fs, dirPath) {
  let handle = null;
  try {
    handle = await fs.promises.open(dirPath, 'r');
    if (typeof handle.sync === 'function') {
      await handle.sync();
    }
  } catch (_) {
    // Best-effort only. Some platforms/filesystems do not allow directory fsync.
  } finally {
    if (handle && typeof handle.close === 'function') {
      await handle.close().catch(() => {});
    }
  }
}

async function writeFileAtomically(deps, targetPath, data) {
  const { fs, path } = deps || {};
  if (!fs?.promises || !path) {
    throw new Error('writeFileAtomically requires fs and path dependencies.');
  }

  const normalizedTargetPath = String(targetPath || '').trim();
  if (!normalizedTargetPath) {
    throw new Error('Target project path is required.');
  }

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
  const tempPath = makeTempProjectPath(path, normalizedTargetPath);
  const dirPath = path.dirname(normalizedTargetPath);
  let tempHandle = null;

  try {
    tempHandle = await fs.promises.open(tempPath, 'w');
    await tempHandle.writeFile(buffer);
    if (typeof tempHandle.sync === 'function') {
      await tempHandle.sync();
    }
    await tempHandle.close();
    tempHandle = null;

    await fs.promises.rename(tempPath, normalizedTargetPath);
    await fsyncDirIfPossible(fs, dirPath);
  } catch (err) {
    if (tempHandle && typeof tempHandle.close === 'function') {
      await tempHandle.close().catch(() => {});
      tempHandle = null;
    }
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }
}

module.exports = {
  writeFileAtomically,
  makeTempProjectPath
};
