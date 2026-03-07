const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomically } = require('../electron-main/project-files');

test('writeFileAtomically replaces the target file via a temp file in the same directory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quackdas-project-files-'));
  const targetPath = path.join(tempDir, 'analysis.qdpx');
  fs.writeFileSync(targetPath, Buffer.from('old-project'));

  await writeFileAtomically({ fs, path }, targetPath, Buffer.from('new-project'));

  assert.equal(fs.readFileSync(targetPath, 'utf8'), 'new-project');
  const leftovers = fs.readdirSync(tempDir).filter((name) => /\.tmp$/i.test(name));
  assert.deepEqual(leftovers, []);
});

test('writeFileAtomically cleans up the temp file when rename fails', async () => {
  const events = [];
  let tempPath = '';
  const fakeFs = {
    promises: {
      open: async (filePath) => {
        tempPath = filePath;
        events.push(`open:${filePath}`);
        return {
          async writeFile(data) {
            events.push(`write:${Buffer.from(data).toString('utf8')}`);
          },
          async sync() {
            events.push('sync');
          },
          async close() {
            events.push('close');
          }
        };
      },
      rename: async () => {
        events.push('rename');
        throw new Error('rename failed');
      },
      unlink: async (filePath) => {
        events.push(`unlink:${filePath}`);
      }
    }
  };

  await assert.rejects(
    writeFileAtomically({ fs: fakeFs, path }, '/tmp/failing-project.qdpx', Buffer.from('payload')),
    /rename failed/
  );

  assert.ok(tempPath.endsWith('.tmp'));
  assert.deepEqual(events, [
    `open:${tempPath}`,
    'write:payload',
    'sync',
    'close',
    'rename',
    `unlink:${tempPath}`
  ]);
});
