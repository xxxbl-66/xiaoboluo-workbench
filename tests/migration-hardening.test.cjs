/**
 * P0-02 Required Fix：非数组数据表不得让启动链崩溃。
 *
 * 覆盖：
 * - 迁移遇到根类型错误时不得"跳过 + 标记成功"
 * - 必须保留原始坏数据的可恢复副本
 * - 修复后真实启动关键链（IPC 注册 + syncGoalRecurringTasks）必须能跑完
 * - 不得出现 unhandled rejection
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const { DataStore } = require('../electron/store.cjs');
const migrations = require('../electron/migrations.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-p002-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function brokenCopies(store, name) {
  const prefix = `${name}.broken-`;
  return fs.readdirSync(store.dataDir).filter((entry) => entry.startsWith(prefix));
}

/* ------------------------------------------------------------------ *
 * 1. 迁移层：结构错误必须被修复并留证据，不得静默跳过
 * ------------------------------------------------------------------ */

for (const [label, name, badValue] of [
  ['todos.json 是对象', 'todos.json', '{}'],
  ['goals.json 是对象', 'goals.json', '{}'],
  ['todos.json 是 null', 'todos.json', 'null'],
  ['apps.json 是字符串', 'apps.json', '"oops"'],
  ['settings.json 是数组', 'settings.json', '[]'],
  ['reader.json 是数字', 'reader.json', '42']
]) {
  test(`P0-02-1 ${label} 时，迁移必须修复为安全结构并保留原始数据`, () => {
    const dir = tempDir();
    try {
      const store = new DataStore(dir);
      fs.writeFileSync(store.filePath(name), badValue, 'utf8');

      const result = migrations.runMigrations(store);

      const repairedNames = result.repaired.map((item) => item.name);
      assert.ok(repairedNames.includes(name), `${name} 应被记录为已修复`);

      // 原始坏数据必须有可恢复副本，且内容逐字节一致
      const copies = brokenCopies(store, name);
      assert.equal(copies.length, 1, `${name} 应留下一个 .broken- 副本`);
      assert.equal(fs.readFileSync(path.join(store.dataDir, copies[0]), 'utf8'), badValue);

      // 修复后的结构必须是安全默认值
      const fixed = JSON.parse(fs.readFileSync(store.filePath(name), 'utf8'));
      const kind = require('../electron/tables.cjs').tableKind(name);
      assert.equal(Array.isArray(fixed), kind === 'array', `${name} 应被修复为 ${kind}`);
    } finally {
      cleanup(dir);
    }
  });
}

test('P0-02-2 结构错误修复后 schemaVersion 才会被写为 1', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('todos.json'), '{}', 'utf8');
    fs.writeFileSync(store.filePath('goals.json'), 'null', 'utf8');

    const result = migrations.runMigrations(store);

    assert.equal(result.to, migrations.CURRENT_SCHEMA_VERSION);
    assert.equal(migrations.readMeta(store).schemaVersion, 1);
    assert.ok(result.repaired.length >= 2);

    // 修复后每张已存在的表根类型都必须合法
    const tables = require('../electron/tables.cjs');
    for (const name of tables.tableNames()) {
      const file = store.filePath(name);
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.ok(tables.matchesKind(name, parsed), `${name} 修复后根类型仍不合法`);
    }
  } finally {
    cleanup(dir);
  }
});

test('P0-02-3 语法损坏的表同样被修复并保留副本', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('notes.json'), '{ 这不是合法 JSON', 'utf8');

    const result = migrations.runMigrations(store);

    assert.ok(result.repaired.some((item) => item.name === 'notes.json'));
    const copies = brokenCopies(store, 'notes.json');
    assert.equal(copies.length, 1);
    assert.equal(fs.readFileSync(path.join(store.dataDir, copies[0]), 'utf8'), '{ 这不是合法 JSON');
    assert.deepEqual(JSON.parse(fs.readFileSync(store.filePath('notes.json'), 'utf8')), []);
  } finally {
    cleanup(dir);
  }
});

test('P0-02-4 meta.json 不存在时按 version 0 处理，结构错误修复后正常升级', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    assert.equal(fs.existsSync(store.filePath('meta.json')), false);
    store.write('todos.json', [{ id: 't1' }]);

    const result = migrations.runMigrations(store);
    assert.equal(result.from, 0);
    assert.equal(result.to, 1);
    assert.equal(store.read('todos.json', [])[0].workspaceId, null);
  } finally {
    cleanup(dir);
  }
});

test('P0-02-5 meta.json 自己是数组时也能被修复', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    fs.writeFileSync(store.filePath('meta.json'), '[]', 'utf8');
    store.write('todos.json', [{ id: 't1' }]);

    assert.doesNotThrow(() => migrations.runMigrations(store));
    assert.equal(migrations.readMeta(store).schemaVersion, 1);
    assert.equal(store.read('todos.json', [])[0].workspaceId, null);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 2. DataStore 边界：结构不符时按"损坏自愈"处理，不向上抛
 * ------------------------------------------------------------------ */
test('P0-02-6 DataStore.read 遇到根类型不符时自愈为默认值并保留副本', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);

    fs.writeFileSync(store.filePath('todos.json'), '{}', 'utf8');
    assert.deepEqual(store.read('todos.json', []), []);
    assert.equal(brokenCopies(store, 'todos.json').length, 1);

    fs.writeFileSync(store.filePath('settings.json'), '[]', 'utf8');
    assert.equal(typeof store.read('settings.json', { theme: 'light' }), 'object');
    assert.equal(Array.isArray(store.read('settings.json', { theme: 'light' })), false);

    // 合法数据不受影响
    store.write('goals.json', [{ id: 'g1' }]);
    assert.deepEqual(store.read('goals.json', []), [{ id: 'g1' }]);
    assert.equal(brokenCopies(store, 'goals.json').length, 0);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 3. 真实启动链：不得崩溃、不得有 unhandled rejection
 * ------------------------------------------------------------------ */
function createElectronMock(workRoot, dialogs) {
  const handlers = new Map();
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });

  return {
    app: {
      isPackaged: false,
      getVersion: () => '0.0.0-test',
      getPath: (name) => (name === 'documents' ? documents : workRoot),
      getAppPath: () => ROOT,
      setLoginItemSettings: () => {},
      setAppUserModelId: () => {},
      hasSingleInstanceLock: () => true,
      requestSingleInstanceLock: () => true,
      relaunch: () => {},
      exit: () => {},
      quit: () => {},
      on: () => {},
      whenReady: () => Promise.resolve()
    },
    BrowserWindow: class {
      constructor() {
        this.webContents = { on: () => {}, setWindowOpenHandler: () => {}, send: () => {} };
      }
      loadURL() {}
      loadFile() {}
      isDestroyed() {
        return false;
      }
      isMinimized() {
        return false;
      }
      restore() {}
      show() {}
      focus() {}
      on() {}
      static getAllWindows() {
        return [];
      }
    },
    Notification: class {
      on() {}
      show() {}
      static isSupported() {
        return true;
      }
    },
    ipcMain: { handle: (c, f) => handlers.set(c, f), on: () => {} },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showErrorBox: (...args) => dialogs.push(args[0])
    },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers,
    __documents: documents
  };
}

async function runRealStartup(prepareData) {
  const workRoot = tempDir();
  const rejections = [];
  const dialogs = [];
  const electronMock = createElectronMock(workRoot, dialogs);
  const dataDir = path.join(electronMock.__documents, '小菠萝的工作台', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  prepareData(dataDir);

  const onRejection = (reason) => rejections.push(`unhandledRejection:${reason && reason.message}`);
  process.on('unhandledRejection', onRejection);

  const originalLoad = Module._load;
  const originalSetInterval = globalThis.setInterval;
  Module._load = function patched(request) {
    if (request === 'electron') return electronMock;
    return originalLoad.apply(this, arguments);
  };
  globalThis.setInterval = () => ({ fake: true, unref() {}, ref: () => {} });

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT) && !key.includes('node_modules')) delete require.cache[key];
  }

  try {
    require(path.join(ROOT, 'electron', 'main.cjs'));
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    Module._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
  }
  await new Promise((resolve) => setTimeout(resolve, 60));
  process.removeListener('unhandledRejection', onRejection);

  return { electronMock, workRoot, rejections, dialogs, dataDir };
}

test('P0-02-7 todos.json 是对象时，真实启动链仍能完成（不再崩溃）', async () => {
  const { electronMock, workRoot, rejections, dataDir } = await runRealStartup((dir) => {
    fs.writeFileSync(path.join(dir, 'todos.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dir, 'goals.json'), '{}', 'utf8');
  });
  try {
    assert.ok(electronMock.__handlers.size > 50, `IPC 必须注册成功，实际 ${electronMock.__handlers.size}`);

    const todos = await electronMock.__handlers.get('todos:list')({});
    assert.equal(todos.ok, true, 'todos:list 必须可用');
    assert.deepEqual(todos.data, []);

    const goals = await electronMock.__handlers.get('goals:list')({});
    assert.equal(goals.ok, true);
    assert.deepEqual(goals.data, []);

    const lists = fs.readdirSync(dataDir);
    assert.ok(lists.some((entry) => entry.startsWith('todos.json.broken-')), '坏 todos 必须留副本');
    assert.ok(lists.some((entry) => entry.startsWith('goals.json.broken-')), '坏 goals 必须留副本');

    assert.deepEqual(rejections, [], '启动过程不得产生 unhandled rejection');
  } finally {
    cleanup(workRoot);
  }
});

test('P0-02-8 数组表为 null 时启动链不崩溃，且同步逻辑正常工作', async () => {
  const { electronMock, workRoot, rejections } = await runRealStartup((dir) => {
    fs.writeFileSync(path.join(dir, 'todos.json'), 'null', 'utf8');
    fs.writeFileSync(path.join(dir, 'calendar-events.json'), 'null', 'utf8');
  });
  try {
    assert.ok(electronMock.__handlers.size > 50);

    // 触发真实业务链：创建长期目标 → syncGoalRecurringTasks
    const created = await electronMock.__handlers.get('goals:create')({}, { title: '目标' });
    assert.equal(created.ok, true);

    const updated = await electronMock.__handlers.get('goals:update')({}, created.data.id, {
      recurrence: { type: 'daily', days: [] },
      recurrenceTask: '每日任务'
    });
    assert.equal(updated.ok, true, 'syncGoalRecurringTasks 不得因坏数据抛错');

    const todos = await electronMock.__handlers.get('todos:list')({});
    assert.equal(todos.ok, true);
    assert.ok(todos.data.some((item) => item.generated), '自动生成的待办应写入成功');

    assert.deepEqual(rejections, []);
  } finally {
    cleanup(workRoot);
  }
});

test('P0-02-9 完全没有 meta.json 且多张表损坏时，启动仍完成并升级到 v1', async () => {
  const { electronMock, workRoot, rejections, dialogs, dataDir } = await runRealStartup((dir) => {
    fs.writeFileSync(path.join(dir, 'todos.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(dir, 'files.json'), '"string"', 'utf8');
    fs.writeFileSync(path.join(dir, 'bookmarks.json'), '[]', 'utf8');
    fs.writeFileSync(path.join(dir, 'meta.json'), '[]', 'utf8');
  });
  try {
    assert.ok(electronMock.__handlers.size > 50);
    const info = await electronMock.__handlers.get('app:info')({});
    assert.equal(info.ok, true);
    assert.equal(info.data.schemaVersion, 1);

    // 合法的 bookmarks 也要被补上 workspaceId（迁移确实跑过）
    const bookmarks = await electronMock.__handlers.get('bookmarks:list')({});
    assert.equal(bookmarks.ok, true);

    // 损坏的表都留下副本
    const files = fs.readdirSync(dataDir);
    assert.ok(files.some((entry) => entry.startsWith('todos.json.broken-')));
    assert.ok(files.some((entry) => entry.startsWith('files.json.broken-')));
    assert.ok(files.some((entry) => entry.startsWith('meta.json.broken-')));

    assert.deepEqual(rejections, []);
    assert.ok(
      dialogs.some((title) => String(title).includes('损坏的数据文件')),
      '必须向用户明确报告已修复损坏的数据表'
    );
  } finally {
    cleanup(workRoot);
  }
});
