/**
 * P0-01 Required Fix：备份导入必须校验白名单 + 每表根类型，
 * 必须先完整验证再写入，必须可回滚，且导入旧数据后必须重新走迁移。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DataStore } = require('../electron/store.cjs');
const { importBackup, isSafeTableName } = require('../electron/services/backup.cjs');
const migrations = require('../electron/migrations.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-imp-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function writeBackup(dir, data, extra = {}) {
  const file = path.join(dir, `payload-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify({ app: '小菠萝的工作台', exportedAt: new Date().toISOString(), data, ...extra }), 'utf8');
  return file;
}

function snapshotData(store) {
  const result = {};
  for (const name of fs.readdirSync(store.dataDir)) {
    result[name] = fs.readFileSync(path.join(store.dataDir, name), 'utf8');
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 1. 根类型错误的表 → 整个导入失败，任何表都不被改写
 * ------------------------------------------------------------------ */
test('P0-01-1 todos.json 是对象而不是数组时，整个导入被拒绝', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 'keep-1', title: '原有待办' }]);
    const before = fs.readFileSync(store.filePath('todos.json'), 'utf8');

    const file = writeBackup(dir, { 'todos.json': { not: 'an-array' } });
    const result = importBackup(store, file);

    assert.equal(result.ok, false, '结构错误的备份必须整体失败');
    assert.match(result.error, /todos\.json/);
    assert.equal(fs.readFileSync(store.filePath('todos.json'), 'utf8'), before, '原有 todos.json 必须逐字节不变');
  } finally {
    cleanup(dir);
  }
});

test('P0-01-2 一张表非法时，同一备份中的其他合法表也完全不被写入', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    store.write('notes.json', [{ id: 'n1', title: '原有便签' }]);
    const before = snapshotData(store);

    const file = writeBackup(dir, {
      'todos.json': [{ id: 'new-todo' }],       // 合法
      'notes.json': { not: 'an-array' },        // 非法 → 应导致整体失败
      'goals.json': [{ id: 'new-goal' }]        // 合法
    });
    const result = importBackup(store, file);

    assert.equal(result.ok, false);
    assert.deepEqual(snapshotData(store), before, '不能出现"前几张已写、后一张失败"的半导入状态');
  } finally {
    cleanup(dir);
  }
});

test('P0-01-3 对象表收到数组、数组表收到 null 同样被拒绝', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('settings.json', { theme: 'dark', user: { name: '小菠萝' } });
    const before = fs.readFileSync(store.filePath('settings.json'), 'utf8');

    const asArray = writeBackup(dir, { 'settings.json': [{ theme: 'light' }] });
    assert.equal(importBackup(store, asArray).ok, false, 'settings.json 必须是对象');

    const asNull = writeBackup(dir, { 'todos.json': null });
    assert.equal(importBackup(store, asNull).ok, false, 'todos.json 必须是数组');

    assert.equal(fs.readFileSync(store.filePath('settings.json'), 'utf8'), before);

    const readerAsArray = writeBackup(dir, { 'reader.json': [1, 2, 3] });
    assert.equal(importBackup(store, readerAsArray).ok, false, 'reader.json 必须是对象');
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 2. 白名单：未知表、ADS、保留设备名一律拒绝
 * ------------------------------------------------------------------ */
test('P0-01-4 未知数据表被拒绝，且不会在数据目录产生额外文件', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    const before = snapshotData(store);

    const file = writeBackup(dir, {
      'todos.json': [{ id: 'new' }],
      'unexpected.json': { hello: 'world' }
    });
    const result = importBackup(store, file);

    assert.equal(result.ok, false, '未知表必须导致整体失败');
    assert.match(result.error, /unexpected\.json/);
    assert.equal(fs.existsSync(store.filePath('unexpected.json')), false, '不能写入未知表');
    assert.deepEqual(snapshotData(store), before);
  } finally {
    cleanup(dir);
  }
});

test('P0-01-5 Windows ADS 与保留设备名被拒绝', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);

    for (const name of ['todos.json:stream.json', 'CON.json', 'aux.json', 'NUL.json', 'COM1.json', 'LPT1.json', 'todos.json.']) {
      const file = writeBackup(dir, { [name]: [] });
      const result = importBackup(store, file);
      assert.equal(result.ok, false, `必须拒绝：${name}`);
      assert.equal(fs.existsSync(path.join(store.dataDir, name)), false, `不得写入：${name}`);
    }

    // 白名单外的合法文件名同样拒绝
    assert.equal(isSafeTableName('meta.json', store.dataDir), true);
    assert.equal(isSafeTableName('unexpected.json', store.dataDir), false);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 3. 旧备份 / 当前备份仍然可以正常导入
 * ------------------------------------------------------------------ */
test('P0-01-6 旧版（无 meta.json、无 workspaceId）备份仍可导入，并自动补迁移', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    // 模拟当前数据目录已经是 v1
    store.write('meta.json', { schemaVersion: 1, updatedAt: new Date().toISOString() });
    store.write('todos.json', [{ id: 'current', workspaceId: null }]);

    // 旧版备份：没有 meta.json，表里也没有 workspaceId
    const file = writeBackup(dir, {
      'todos.json': [{ id: 'legacy-1', title: '旧待办', completed: false, sort: 1 }],
      'bookmarks.json': [{ id: 'legacy-b', title: '旧收藏', url: 'https://a.com' }]
    });

    const result = importBackup(store, file);
    assert.equal(result.ok, true);

    const todos = store.read('todos.json', []);
    assert.equal(todos.length, 1);
    assert.equal(todos[0].id, 'legacy-1');
    assert.ok(
      Object.prototype.hasOwnProperty.call(todos[0], 'workspaceId'),
      '导入旧数据后必须重新走迁移，补齐 workspaceId'
    );
    assert.equal(todos[0].workspaceId, null);

    const bookmarks = store.read('bookmarks.json', []);
    assert.ok(Object.prototype.hasOwnProperty.call(bookmarks[0], 'workspaceId'));

    assert.equal(migrations.readMeta(store).schemaVersion, migrations.CURRENT_SCHEMA_VERSION);
  } finally {
    cleanup(dir);
  }
});

test('P0-01-7 当前版本的正常备份可以完整导入', () => {
  const dir = tempDir();
  const source = tempDir();
  try {
    const store = new DataStore(dir);
    const sourceStore = new DataStore(source);
    sourceStore.write('todos.json', [{ id: 'a', title: '任务', workspaceId: null }]);
    sourceStore.write('workspaces.json', [{ id: 'w1', name: '程序设计大赛', archived: false }]);
    sourceStore.write('work-sessions.json', [{ id: 's1', workspaceId: 'w1', endedAt: null }]);
    sourceStore.write('settings.json', { theme: 'dark', user: { name: '小菠萝' } });
    sourceStore.write('meta.json', { schemaVersion: 1, updatedAt: new Date().toISOString() });

    const { exportBackup } = require('../electron/services/backup.cjs');
    const exported = exportBackup(sourceStore);

    const result = importBackup(store, exported.filePath);
    assert.equal(result.ok, true);
    assert.equal(result.count, 5);
    assert.deepEqual(store.read('todos.json', []), [{ id: 'a', title: '任务', workspaceId: null }]);
    assert.equal(store.read('settings.json', {}).theme, 'dark');
    assert.equal(store.read('workspaces.json', [])[0].name, '程序设计大赛');
    assert.equal(migrations.readMeta(store).schemaVersion, 1);
  } finally {
    cleanup(dir);
    cleanup(source);
  }
});

/* ------------------------------------------------------------------ *
 * 4. 事务性：中途失败必须完整回滚
 * ------------------------------------------------------------------ */
test('P0-01-8 写入中途异常时，全部数据恢复到导入前状态', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 'orig-todo' }]);
    store.write('notes.json', [{ id: 'orig-note' }]);
    store.write('meta.json', { schemaVersion: 1 });
    const before = snapshotData(store);

    const file = writeBackup(dir, {
      'todos.json': [{ id: 'new-todo' }],
      'notes.json': [{ id: 'new-note' }],
      'goals.json': [{ id: 'new-goal' }]
    });

    // 在第 2 次真实写入时抛错，模拟磁盘/权限故障
    const originalWrite = store.write.bind(store);
    let calls = 0;
    store.write = (name, data) => {
      calls += 1;
      if (calls === 2) throw new Error('模拟写入失败');
      return originalWrite(name, data);
    };

    const result = importBackup(store, file);
    store.write = originalWrite;

    assert.equal(result.ok, false);
    assert.match(result.error, /模拟写入失败/);
    assert.deepEqual(snapshotData(store), before, '失败后必须逐字节恢复到导入前');
    assert.equal(fs.existsSync(store.filePath('goals.json')), false, '导入中途新建的表必须被撤销');
  } finally {
    cleanup(dir);
  }
});

test('P0-01-9 导入前会留下可恢复的恢复点文件', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 'before-import', title: '导入前的数据' }]);

    const file = writeBackup(dir, { 'todos.json': [{ id: 'after-import' }] });
    const result = importBackup(store, file);

    assert.equal(result.ok, true);
    assert.ok(result.recoveryPoint, '应返回恢复点路径');
    const point = JSON.parse(fs.readFileSync(result.recoveryPoint, 'utf8'));
    assert.equal(point.kind, 'pre-import-backup');
    assert.deepEqual(point.data['todos.json'], [{ id: 'before-import', title: '导入前的数据' }]);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 5. 缺表语义：不清空用户现有表
 * ------------------------------------------------------------------ */
test('P0-01-10 备份中缺失的表保持原样（部分覆盖语义）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    store.write('notes.json', [{ id: 'keep-note' }]);

    const file = writeBackup(dir, { 'todos.json': [{ id: 'imported' }] });
    const result = importBackup(store, file);

    assert.equal(result.ok, true);
    assert.deepEqual(result.importedTables, ['todos.json']);

    // 被导入的表：内容来自备份（随后由迁移补齐 workspaceId）
    assert.deepEqual(store.read('todos.json', []), [{ id: 'imported', workspaceId: null }]);

    // 备份中缺失的表：记录不能被删除，只允许迁移补字段
    const notes = store.read('notes.json', []);
    assert.equal(notes.length, 1, '备份中缺失的表不能被删除');
    assert.equal(notes[0].id, 'keep-note');
    assert.equal(notes[0].workspaceId, null, '旧版备份导入后统一走一次迁移');
  } finally {
    cleanup(dir);
  }
});

test('P0-01-11 语法损坏的备份仍然被拒绝，且不产生任何写入', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    const before = snapshotData(store);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json', 'utf8');
    const result = importBackup(store, broken);

    assert.equal(result.ok, false);
    assert.match(result.error, /格式错误/);
    assert.deepEqual(snapshotData(store), before);
  } finally {
    cleanup(dir);
  }
});
