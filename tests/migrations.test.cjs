const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DataStore } = require('../electron/store.cjs');
const migrations = require('../electron/migrations.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-migrate-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function readData(store, name) {
  return JSON.parse(fs.readFileSync(store.filePath(name), 'utf8'));
}

test('老用户没有 meta.json 时视为 version 0', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    assert.equal(migrations.readMeta(store).schemaVersion, 0);
  } finally {
    cleanup(dir);
  }
});

test('version 0 → 1：缺失的 workspaceId 被补为 null', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1', title: '旧任务' }]);
    store.write('goals.json', [{ id: 'g1', title: '旧目标' }]);
    store.write('files.json', [{ id: 'f1', path: 'D:\\a', name: 'a', type: 'folder' }]);
    store.write('notes.json', [{ id: 'n1', title: '旧便签', content: '' }]);
    store.write('bookmarks.json', [{ id: 'b1', url: 'https://a.com', title: 'a' }]);
    store.write('apps.json', [{ id: 'p1', name: 'VS Code', path: 'C:\\vscode.exe', groupId: 'dev' }]);

    const result = migrations.runMigrations(store);

    assert.equal(result.from, 0);
    assert.equal(result.to, 1);
    assert.equal(result.skipped, false);
    for (const name of migrations.WORKSPACE_TABLES) {
      for (const record of readData(store, name)) {
        assert.equal(record.workspaceId, null, `${name} 的记录应补上 workspaceId: null`);
      }
    }
  } finally {
    cleanup(dir);
  }
});

test('version 0 → 1：已有 workspaceId 不被覆盖（含具体值与非 null）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [
      { id: 't1', workspaceId: 'ws-a' },
      { id: 't2', workspaceId: null },
      { id: 't3' }
    ]);
    store.write('apps.json', [
      { id: 'p1', workspaceId: 'ws-b', groupId: 'dev' },
      { id: 'p2', groupId: 'dev' }
    ]);

    migrations.runMigrations(store);

    const todos = readData(store, 'todos.json');
    assert.equal(todos[0].workspaceId, 'ws-a');
    assert.equal(todos[1].workspaceId, null);
    assert.equal(todos[2].workspaceId, null);
    assert.ok(Object.prototype.hasOwnProperty.call(todos[1], 'workspaceId'));

    const apps = readData(store, 'apps.json');
    assert.equal(apps[0].workspaceId, 'ws-b');
    assert.equal(apps[0].groupId, 'dev', 'groupId 必须保留');
    assert.equal(apps[1].workspaceId, null);
    assert.equal(apps[1].groupId, 'dev', 'groupId 必须保留');
  } finally {
    cleanup(dir);
  }
});

test('migration 不改变记录数量，也不丢失任何原有字段', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const original = [
      { id: 't1', title: 'A', priority: 'high', completed: true, sort: 3, nested: { x: [1, 2] } },
      { id: 't2', title: 'B', generated: true, sourceGoalId: 'g1', sourceDate: '2026-01-01' }
    ];
    store.write('todos.json', structuredClone(original));

    migrations.runMigrations(store);

    const after = readData(store, 'todos.json');
    assert.equal(after.length, original.length);
    for (let i = 0; i < original.length; i += 1) {
      const { workspaceId, ...rest } = after[i];
      assert.equal(workspaceId, null);
      assert.deepEqual(rest, original[i], `第 ${i} 条记录除 workspaceId 外应完全一致`);
    }
  } finally {
    cleanup(dir);
  }
});

test('migration 幂等：重复执行结果完全一致', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }, { id: 't2', workspaceId: 'ws-a' }]);
    store.write('notes.json', [{ id: 'n1', type: 'quick' }]);

    migrations.runMigrations(store);
    const snapshot = {
      todos: readData(store, 'todos.json'),
      notes: readData(store, 'notes.json'),
      meta: readData(store, migrations.META_FILE)
    };

    const second = migrations.runMigrations(store);
    assert.equal(second.skipped, true, '第二次运行应被跳过');

    assert.deepEqual(readData(store, 'todos.json'), snapshot.todos);
    assert.deepEqual(readData(store, 'notes.json'), snapshot.notes);
    assert.equal(readData(store, migrations.META_FILE).schemaVersion, snapshot.meta.schemaVersion);
  } finally {
    cleanup(dir);
  }
});

test('schemaVersion 正确更新为 1，并带 updatedAt', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);
    migrations.runMigrations(store);

    const meta = readData(store, migrations.META_FILE);
    assert.equal(meta.schemaVersion, migrations.CURRENT_SCHEMA_VERSION);
    assert.equal(typeof meta.updatedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(meta.updatedAt)), 'updatedAt 应为合法时间');
  } finally {
    cleanup(dir);
  }
});

test('缺失的数据文件不会被 migration 凭空创建', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);

    migrations.runMigrations(store);

    for (const name of ['goals.json', 'notes.json', 'bookmarks.json', 'apps.json', 'files.json']) {
      assert.equal(fs.existsSync(store.filePath(name)), false, `${name} 不应被创建`);
    }
  } finally {
    cleanup(dir);
  }
});

test('migration 会尝试在 backups/ 下留下迁移前备份', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1', title: '迁移前' }]);

    const result = migrations.runMigrations(store);

    assert.ok(result.backupPath, '应创建迁移前备份');
    const backup = JSON.parse(fs.readFileSync(result.backupPath, 'utf8'));
    assert.equal(backup.kind, 'migration-backup');
    assert.deepEqual(backup.data['todos.json'], [{ id: 't1', title: '迁移前' }]);
  } finally {
    cleanup(dir);
  }
});

test('迁移步骤抛错时不更新 schemaVersion（不静默吞掉错误）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);

    assert.throws(
      () => migrations.runMigrations(store, {
        targetVersion: 2,
        migrations: [
          { version: 1, name: 'ok-step', run: () => [] },
          {
            version: 2,
            name: 'boom',
            run: () => {
              throw new Error('模拟迁移失败');
            }
          }
        ]
      }),
      /模拟迁移失败/
    );

    assert.equal(fs.existsSync(store.filePath(migrations.META_FILE)), false, 'meta.json 不应被写出');
    assert.equal(migrations.readMeta(store).schemaVersion, 0);
    assert.deepEqual(readData(store, 'todos.json'), [{ id: 't1' }], '数据应保持原样');
  } finally {
    cleanup(dir);
  }
});

test('失败后重跑成功，schemaVersion 与数据都正确', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1' }]);

    assert.throws(() => migrations.runMigrations(store, {
      targetVersion: 1,
      migrations: [{
        version: 1,
        name: 'boom',
        run: () => {
          throw new Error('第一次失败');
        }
      }]
    }));

    const retry = migrations.runMigrations(store);
    assert.equal(retry.skipped, false);
    assert.equal(retry.to, migrations.CURRENT_SCHEMA_VERSION);
    assert.equal(readData(store, migrations.META_FILE).schemaVersion, migrations.CURRENT_SCHEMA_VERSION);
    assert.equal(readData(store, 'todos.json')[0].workspaceId, null);
  } finally {
    cleanup(dir);
  }
});

test('workspaceId 为 undefined 的键（JSON 无法表达）按缺失处理', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('bookmarks.json'), JSON.stringify([{ id: 'b1', title: 'x' }]), 'utf8');
    migrations.runMigrations(store);
    assert.equal(readData(store, 'bookmarks.json')[0].workspaceId, null);
  } finally {
    cleanup(dir);
  }
});

// P0-02：旧行为是"跳过非数组 + 仍写 schemaVersion=1"，会让启动链崩溃，已被推翻。
test('非数组内容（损坏的数据表）被隔离并重建为安全结构，而不是跳过', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', { not: 'an array' });

    const result = migrations.runMigrations(store);

    assert.equal(result.repaired.length, 1);
    assert.equal(result.repaired[0].name, 'todos.json');

    // 原始内容必须保留在 .broken- 副本里，不能被静默丢弃
    const copies = fs.readdirSync(store.dataDir).filter((name) => name.startsWith('todos.json.broken-'));
    assert.equal(copies.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(store.dataDir, copies[0]), 'utf8')), { not: 'an array' });

    // 修复后的表必须是合法数组，后续启动链才不会崩
    assert.deepEqual(readData(store, 'todos.json'), []);
    assert.equal(readData(store, migrations.META_FILE).schemaVersion, 1);
  } finally {
    cleanup(dir);
  }
});
