const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DataStore } = require('../electron/store.cjs');
const { exportBackup, importBackup, isSafeTableName } = require('../electron/services/backup.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-backup-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

test('备份导出包含全部数据表（含 workspaces / work-sessions / meta）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    store.write('workspaces.json', [{ id: 'w1', name: 'A' }]);
    store.write('work-sessions.json', [{ id: 's1', workspaceId: 'w1' }]);
    store.write('meta.json', { schemaVersion: 1 });

    const result = exportBackup(store);
    const backup = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
    assert.ok(backup.data['workspaces.json']);
    assert.ok(backup.data['work-sessions.json']);
    assert.ok(backup.data['meta.json']);
    assert.equal(result.count, Object.keys(backup.data).length);
  } finally {
    cleanup(dir);
  }
});

test('isSafeTableName 拒绝路径穿越与非法名称', () => {
  const dataDir = path.join('C:', 'data');
  for (const bad of [
    '..\\..\\evil.json',
    '../../evil.json',
    '..\\evil.json',
    'sub/evil.json',
    'sub\\evil.json',
    '/abs/evil.json',
    'C:\\Windows\\evil.json',
    '..',
    '.',
    '',
    'notes.txt',
    'evil.json\u0000'
  ]) {
    assert.equal(isSafeTableName(bad, dataDir), false, `应拒绝：${JSON.stringify(bad)}`);
  }

  for (const good of ['todos.json', 'workspaces.json', 'work-sessions.json', 'meta.json']) {
    assert.equal(isSafeTableName(good, dataDir), true, `应接受：${good}`);
  }
});

test('导入恶意备份不会写到数据目录之外（P0 路径穿越）', () => {
  const dir = tempDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'xb-outside-'));
  try {
    const store = new DataStore(dir);
    const evilTarget = path.join(outside, 'evil.json');
    const relative = path.relative(store.dataDir, evilTarget);

    const payload = {
      app: '小菠萝的工作台',
      exportedAt: new Date().toISOString(),
      data: {
        'todos.json': [{ id: 'legit' }],
        '..\\..\\evil.json': { pwned: true },
        [relative]: { pwned: true },
        'sub/deep.json': { pwned: true }
      }
    };
    const file = path.join(outside, 'malicious-backup.json');
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');

    const result = importBackup(store, file);

    // P0-01 后语义收紧：只要有一张表不合法，整个导入被拒绝，不做部分写入
    assert.equal(result.ok, false, '含非法表名的备份必须整体拒绝');
    assert.match(result.error, /无法识别/);
    assert.equal(fs.existsSync(evilTarget), false, '数据目录之外不能出现新文件');
    assert.equal(fs.existsSync(store.filePath('todos.json')), false, '被拒绝的导入不得写入任何表');
    assert.equal(fs.existsSync(store.filePath('sub')), false, '不得创建子目录');

    const strays = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
    assert.deepEqual(strays, [], `数据目录根下不应出现杂散文件：${strays.join(',')}`);
  } finally {
    cleanup(dir);
    cleanup(outside);
  }
});

test('导入正常备份仍然完全可用（格式未变）', () => {
  const dir = tempDir();
  const source = tempDir();
  try {
    const store = new DataStore(dir);
    const sourceStore = new DataStore(source);
    sourceStore.write('todos.json', [{ id: 'a', title: '任务' }]);
    sourceStore.write('workspaces.json', [{ id: 'w1', name: '程序设计大赛' }]);
    const result = exportBackup(sourceStore);

    const imported = importBackup(store, result.filePath);
    assert.equal(imported.ok, true);
    assert.equal(imported.count, 2);
    assert.deepEqual(store.read('todos.json', []), [{ id: 'a', title: '任务' }]);
    assert.deepEqual(store.read('workspaces.json', []), [{ id: 'w1', name: '程序设计大赛' }]);
  } finally {
    cleanup(dir);
    cleanup(source);
  }
});

test('导入损坏或不存在的备份返回可读错误而不是抛错', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    assert.equal(importBackup(store, path.join(dir, 'nope.json')).ok, false);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json', 'utf8');
    const result = importBackup(store, broken);
    assert.equal(result.ok, false);
    assert.match(result.error, /格式错误/);
  } finally {
    cleanup(dir);
  }
});
