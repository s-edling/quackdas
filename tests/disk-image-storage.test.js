const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BLOCKED_AGENT_APPS,
  normalizeDiskImageSettings,
  parseBlockedAgentAppsInput,
  parsePsOutput,
  detectBlockedApps,
  parseHdiutilInfoOutput,
  extractAllMountPointsFromAttachPlist,
  createDiskImageStorageService
} = require('../electron-main/disk-image-storage');

test('normalizeDiskImageSettings keeps defaults and deduplicates blocked apps', () => {
  const settings = normalizeDiskImageSettings({
    enabled: true,
    imagePath: ' /Volumes/Test.sparsebundle ',
    blockedApps: ['Codex', ' codex ', '', 'Claude Workspace']
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.imagePath, '/Volumes/Test.sparsebundle');
  assert.equal(settings.autoMount, true);
  assert.equal(settings.autoUnmountOnClose, true);
  assert.deepEqual(settings.blockedApps, ['Codex', 'Claude Workspace']);
});

test('parseBlockedAgentAppsInput normalizes newline-separated values', () => {
  const blockedApps = parseBlockedAgentAppsInput('Codex\n\n Claude Workspace \nCursor\ncursor');
  assert.deepEqual(blockedApps, ['Codex', 'Claude Workspace', 'Cursor']);
});

test('detectBlockedApps matches configured agent names against ps output rows', () => {
  const rows = parsePsOutput([
    '100 /Applications/Codex.app/Contents/MacOS/Codex',
    '101 /Applications/Claude.app/Contents/MacOS/Claude',
    '102 /Applications/Finder.app/Contents/MacOS/Finder'
  ].join('\n'));

  const matches = detectBlockedApps(rows, ['Codex', 'Claude Workspace', 'Claude']);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].baseName, 'Codex');
  assert.equal(matches[1].baseName, 'Claude');
});

test('detectBlockedApps matches agent app names from truncated ps command output', () => {
  const rows = parsePsOutput([
    '100 /Users/st3583ed/ /Users/st3583ed/Applications/Codex.app/Contents/MacOS/Codex',
    '101 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder Finder'
  ].join('\n'));

  const matches = detectBlockedApps(rows, ['Codex']);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].baseName, 'Codex');
});

test('detectBlockedApps ignores helper processes and unrelated system paths', () => {
  const rows = parsePsOutput([
    '100 /Users/st3583ed/ /Users/st3583ed/Applications/Codex.app/Contents/Frameworks/Codex Helper (Renderer).app/Contents/MacOS/Codex Helper (Renderer) --app-path=/Users/st3583ed/Applications/Codex.app/Contents/Resources/app.asar',
    '101 /System/Library/ /System/Library/PrivateFrameworks/TextInputUIMacHelper.framework/Versions/A/XPCServices/CursorUIViewService.xpc/Contents/MacOS/CursorUIViewService'
  ].join('\n'));

  assert.deepEqual(detectBlockedApps(rows, ['Codex', 'Cursor']), []);
});

test('parseHdiutilInfoOutput groups image paths and mount points', () => {
  const info = [
    'image-path          : /Users/me/ResearchVault.sparsebundle',
    '/dev/disk4s1        Apple_APFS                       /Volumes/ResearchVault',
    'image-path          : /Users/me/Other.dmg',
    '/dev/disk5s1        Apple_HFS                        /Volumes/Other'
  ].join('\n');

  const parsed = parseHdiutilInfoOutput(info);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].imagePath, '/Users/me/ResearchVault.sparsebundle');
  assert.deepEqual(parsed[0].mountPoints, ['/Volumes/ResearchVault']);
});

test('extractAllMountPointsFromAttachPlist returns all mount points from attach plist', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
  <plist version="1.0">
    <dict>
      <key>system-entities</key>
      <array>
        <dict>
          <key>mount-point</key>
          <string>/Volumes/ResearchVault</string>
        </dict>
        <dict>
          <key>mount-point</key>
          <string>/Volumes/ResearchVault 1</string>
        </dict>
      </array>
    </dict>
  </plist>`;

  assert.deepEqual(extractAllMountPointsFromAttachPlist(plist), [
    '/Volumes/ResearchVault',
    '/Volumes/ResearchVault 1'
  ]);
});

test('default blocked app list includes common local agent tools', () => {
  assert.equal(Array.isArray(DEFAULT_BLOCKED_AGENT_APPS), true);
  assert.equal(DEFAULT_BLOCKED_AGENT_APPS.includes('Codex'), true);
  assert.equal(DEFAULT_BLOCKED_AGENT_APPS.includes('Claude Workspace'), true);
});

test('getStatus preserves blocked startup mount result for renderer warnings', async () => {
  const prefs = {
    diskImageSettings: {
      enabled: true,
      imagePath: '/Users/me/ResearchVault.sparsebundle',
      autoMount: true,
      blockedApps: ['Codex']
    }
  };
  const execFile = (command, args, options, callback) => {
    if (command === 'ps') {
      callback(null, '100 /Applications/Electron.app/Contents/MacOS/Electron /Applications/Codex.app/Contents/MacOS/Codex --type=renderer\n', '');
      return;
    }
    if (command === 'hdiutil' && Array.isArray(args) && args[0] === 'info') {
      callback(null, '', '');
      return;
    }
    callback(new Error(`Unexpected command: ${command} ${Array.isArray(args) ? args.join(' ') : ''}`));
  };
  const service = createDiskImageStorageService({
    app: {},
    ipcMain: { handle() {} },
    dialog: {},
    fs: {
      constants: { R_OK: 4 },
      promises: {
        access: async () => {}
      }
    },
    path: require('node:path'),
    execFile,
    getWindow: () => null,
    getPreferences: () => prefs,
    setPreferences: () => {},
    getCurrentProjectPath: () => '',
    clearSemanticAvailabilityCache: () => {}
  });

  const startup = await service.prepareStartupMount();
  const status = await service.getStatus();

  assert.equal(startup.blocked, true);
  assert.equal(startup.attempted, true);
  assert.equal(status.startupMountResult.blocked, true);
  assert.equal(status.startupMountResult.attempted, true);
  assert.equal(status.startupMountResult.blockedApps[0].baseName, 'Codex');
});

test('mountConfiguredImage allows manual override when blocked apps are running', async () => {
  const prefs = {
    diskImageSettings: {
      enabled: true,
      imagePath: '/Users/me/ResearchVault.sparsebundle',
      autoMount: true,
      allowManualOverride: true,
      blockedApps: ['Codex']
    }
  };
  const execFile = (command, args, options, callback) => {
    if (command === 'ps') {
      callback(null, '100 /Users/me/ /Users/me/Applications/Codex.app/Contents/MacOS/Codex\n', '');
      return;
    }
    if (command === 'hdiutil' && Array.isArray(args) && args[0] === 'info') {
      callback(null, '', '');
      return;
    }
    if (command === 'hdiutil' && Array.isArray(args) && args[0] === 'attach') {
      callback(null, `<?xml version="1.0" encoding="UTF-8"?>
      <plist version="1.0">
        <dict>
          <key>system-entities</key>
          <array>
            <dict>
              <key>mount-point</key>
              <string>/Volumes/ResearchVault</string>
            </dict>
          </array>
        </dict>
      </plist>`, '');
      return;
    }
    callback(new Error(`Unexpected command: ${command} ${Array.isArray(args) ? args.join(' ') : ''}`));
  };
  const service = createDiskImageStorageService({
    app: {},
    ipcMain: { handle() {} },
    dialog: {},
    fs: {
      constants: { R_OK: 4 },
      promises: {
        access: async () => {}
      }
    },
    path: require('node:path'),
    execFile,
    getWindow: () => null,
    getPreferences: () => prefs,
    setPreferences: () => {},
    getCurrentProjectPath: () => '',
    clearSemanticAvailabilityCache: () => {}
  });

  const result = await service.mountConfiguredImage({ manualOverride: true });

  assert.equal(result.ok, true);
  assert.equal(result.mounted, true);
  assert.equal(result.mountPath, '/Volumes/ResearchVault');
});
