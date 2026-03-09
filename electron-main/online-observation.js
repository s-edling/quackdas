const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function sanitizeSidecarBaseName(projectPath) {
  const parsed = path.parse(String(projectPath || ''));
  const baseName = String(parsed.name || 'project').trim() || 'project';
  return baseName.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/\s+/g, '-');
}

function getObservationSidecarPaths(projectPath) {
  const resolvedProjectPath = path.resolve(String(projectPath || ''));
  const projectDir = path.dirname(resolvedProjectPath);
  const baseName = sanitizeSidecarBaseName(resolvedProjectPath);
  const rootDir = path.join(projectDir, `.${baseName}_media`);
  return {
    projectPath: resolvedProjectPath,
    rootDir,
    incomingDir: path.join(rootDir, 'incoming'),
    screenshotsDir: path.join(rootDir, 'screenshots'),
    htmlDir: path.join(rootDir, 'html')
  };
}

async function ensureObservationSidecar(projectPath) {
  const paths = getObservationSidecarPaths(projectPath);
  await fs.promises.mkdir(paths.incomingDir, { recursive: true });
  await fs.promises.mkdir(paths.screenshotsDir, { recursive: true });
  await fs.promises.mkdir(paths.htmlDir, { recursive: true });
  await hideSidecarOnWindows(paths.rootDir);
  return paths;
}

function hideSidecarOnWindows(dirPath) {
  if (process.platform !== 'win32') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('attrib', ['+h', dirPath], () => resolve());
  });
}

function normalizeObservationAssetFileName(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/');
  if (
    path.posix.isAbsolute(normalized) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.includes('/') ||
    normalized === '.' ||
    normalized === '..'
  ) {
    throw new Error(`Observation payload contains an invalid ${fieldName}.`);
  }

  return normalized;
}

function createObservationWatcher({ onEntry }) {
  let currentProjectPath = null;
  let currentPaths = null;
  let watcher = null;
  let scanTimer = null;
  let runningScan = null;
  const inflightJsonPaths = new Set();

  function clearWatcher() {
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (watcher) {
      try { watcher.close(); } catch (_) {}
      watcher = null;
    }
    currentProjectPath = null;
    currentPaths = null;
  }

  async function setProjectPath(projectPath) {
    const normalized = String(projectPath || '').trim();
    clearWatcher();
    if (!normalized) return null;

    currentProjectPath = path.resolve(normalized);
    currentPaths = await ensureObservationSidecar(currentProjectPath);
    watcher = fs.watch(currentPaths.incomingDir, () => scheduleScan(120));
    scheduleScan(0);
    return currentPaths;
  }

  function scheduleScan(delayMs) {
    if (!currentPaths || !currentProjectPath) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      runningScan = processIncomingFolder().catch(() => {}).finally(() => {
        runningScan = null;
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  async function processIncomingFolder() {
    if (!currentPaths || !currentProjectPath) return;
    const entries = await fs.promises.readdir(currentPaths.incomingDir, { withFileTypes: true });
    const jsonNames = entries
      .filter((entry) => entry && entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    for (const jsonName of jsonNames) {
      const jsonPath = path.join(currentPaths.incomingDir, jsonName);
      if (inflightJsonPaths.has(jsonPath)) continue;
      inflightJsonPaths.add(jsonPath);
      try {
        await ingestSingleJson(jsonPath);
      } catch (_) {
        // Leave the file in incoming/ for retry on the next scan.
      } finally {
        inflightJsonPaths.delete(jsonPath);
      }
    }
  }

  async function ingestSingleJson(jsonPath) {
    const rawJson = await fs.promises.readFile(jsonPath, 'utf8');
    const payload = JSON.parse(rawJson);
    const validated = validateObservationPayload(payload);
    const htmlSourcePath = path.join(currentPaths.incomingDir, validated.html_filename);
    const htmlTargetName = validated.html_filename;
    const htmlTargetPath = path.join(currentPaths.htmlDir, htmlTargetName);
    await ensureFileReady(htmlSourcePath);
    await moveFileReplacing(htmlSourcePath, htmlTargetPath);

    let screenshotRelativePath = '';
    if (validated.screenshot_filename) {
      const screenshotSourcePath = path.join(currentPaths.incomingDir, validated.screenshot_filename);
      const screenshotTargetName = validated.screenshot_filename;
      const screenshotTargetPath = path.join(currentPaths.screenshotsDir, screenshotTargetName);
      await ensureFileReady(screenshotSourcePath);
      await moveFileReplacing(screenshotSourcePath, screenshotTargetPath);
      screenshotRelativePath = path.posix.join('screenshots', screenshotTargetName);
    }

    const htmlRelativePath = path.posix.join('html', htmlTargetName);
    const entry = {
      uuid: validated.uuid,
      fieldsite: validated.fieldsite,
      url: validated.url,
      pageTitle: validated.page_title,
      timestamp: validated.timestamp,
      note: validated.note || '',
      sessionDate: validated.session_date,
      sessionHeading: !!validated.session_heading,
      screenshotPath: screenshotRelativePath,
      htmlPath: htmlRelativePath
    };

    if (typeof onEntry === 'function') {
      await Promise.resolve(onEntry({
        entry,
        projectPath: currentProjectPath,
        sidecarPaths: currentPaths
      }));
    }

    await fs.promises.unlink(jsonPath);
  }

  async function ensureFileReady(filePath) {
    await fs.promises.access(filePath, fs.constants.F_OK | fs.constants.R_OK);
  }

  async function moveFileReplacing(sourcePath, targetPath) {
    try {
      await fs.promises.unlink(targetPath);
    } catch (_) {}
    await fs.promises.rename(sourcePath, targetPath);
  }

  async function stop() {
    clearWatcher();
    if (runningScan) {
      try { await runningScan; } catch (_) {}
    }
  }

  return {
    setProjectPath,
    stop,
    getCurrentPaths: () => currentPaths
  };
}

function validateObservationPayload(payload) {
  const src = (payload && typeof payload === 'object') ? payload : {};
  const uuid = String(src.uuid || '').trim();
  const fieldsite = String(src.fieldsite || '').trim();
  const url = String(src.url || '').trim();
  const pageTitle = String(src.page_title || '').trim();
  const timestamp = String(src.timestamp || '').trim();
  const htmlFilename = normalizeObservationAssetFileName(src.html_filename, 'html_filename');
  const sessionDate = String(src.session_date || '').trim();
  if (!uuid || !fieldsite || !url || !timestamp || !htmlFilename || !sessionDate) {
    throw new Error('Observation payload is missing required fields.');
  }
  const screenshotFilename = normalizeObservationAssetFileName(src.screenshot_filename, 'screenshot_filename');
  return {
    uuid,
    fieldsite,
    url,
    page_title: pageTitle || url,
    timestamp,
    note: String(src.note || ''),
    screenshot_filename: screenshotFilename,
    html_filename: htmlFilename,
    session_date: sessionDate,
    session_heading: !!src.session_heading
  };
}

module.exports = {
  getObservationSidecarPaths,
  ensureObservationSidecar,
  createObservationWatcher,
  normalizeObservationAssetFileName,
  validateObservationPayload
};
