/**
 * P1-04 Required Fix：schemaVersion 高于当前程序版本时不得按普通模式打开并写数据。
 *
 * 覆盖：
 * - 返回明确的 UNSUPPORTED_FUTURE_SCHEMA，而不是静默 skipped
 * - 不修改任何业务 JSON（逐字节一致）
 * - 不覆盖 meta.json
 * - 普通启动逻辑（注册 IPC / 建窗口 / 可写同步）不得继续执行
 * - 即使目录里同时存在损坏表，也不能"顺手修复"（数据必须保持原样）
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

const FUTURE = migrations.CURRENT_SCHEMA_VERSION + 1;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-future-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function snapshot(store) {
  const result = {};
  for (const name of fs.readdirSync(store.dataDir)) {
    result[name] = fs.readFileSync(path.join(store.dataDir, name), 'utf8');
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 1. 迁移层
 * ------------------------------------------------------------------ */
test('P1-04-1 迁移遇到未来版本时返回 UNSUPPORTED_FUTURE_SCHEMA', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('meta.json', { schemaVersion: FUTURE, updatedAt: '2099-01-01T00:00:00.000Z' });
    store.write('todos.json', [{ id: 't1', someFutureField: true }]);

    const result = migrations.runMigrations(store);

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'UNSUPPORTED_FUTURE_SCHEMA');
    assert.equal(result.from, FUTURE);
    assert.equal(result.current, migrations.CURRENT_SCHEMA_VERSION);
    assert.deepEqual(result.applied, [], '不得执行任何迁移步骤');
  } finally {
    cleanup(dir);
  }
});

test('P1-04-2 未来版本时，所有数据文件与 meta 都逐字节不变', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('meta.json', { schemaVersion: FUTURE, updatedAt: '2099-01-01T00:00:00.000Z' });
    store.write('todos.json', [{ id: 't1', someFutureField: true }]);
    store.write('goals.json', [{ id: 'g1' }]);
    store.write('workspaces.json', [{ id: 'w1', name: '未来空间', futureField: 1 }]);
    const before = snapshot(store);

    migrations.runMigrations(store);

    assert.deepEqual(snapshot(store), before, '数据必须保持原样');
    assert.equal(
      JSON.parse(fs.readFileSync(store.filePath('meta.json'), 'utf8')).schemaVersion,
      FUTURE,
      'meta.json 不得被偷偷降级或覆盖'
    );
  } finally {
    cleanup(dir);
  }
});

test('P1-04-3 未来版本 + 目录里还有结构损坏的表时，也不能顺手修复', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('meta.json', { schemaVersion: FUTURE, updatedAt: '2099-01-01T00:00:00.000Z' });
    fs.writeFileSync(store.filePath('todos.json'), '{}', 'utf8');
    const before = snapshot(store);

    const result = migrations.runMigrations(store);

    assert.equal(result.reason, 'UNSUPPORTED_FUTURE_SCHEMA');
    assert.deepEqual(result.repaired, [], '未来版本下不做任何修复');
    assert.deepEqual(snapshot(store), before, '连损坏表也保持原样，交给更新版本处理');
  } finally {
    cleanup(dir);
  }
});

test('P1-04-4 等于当前版本时仍然是正常的 skipped（不受影响）', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('meta.json', { schemaVersion: migrations.CURRENT_SCHEMA_VERSION });
    store.write('todos.json', [{ id: 't1', workspaceId: null }]);
    const before = snapshot(store);

    const result = migrations.runMigrations(store);

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(result.futureSchema, undefined);
    assert.deepEqual(snapshot(store), before);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 2. 真实启动链：必须停下来，不能进普通读写模式
 * ------------------------------------------------------------------ */
function createElectronMock(workRoot, record) {
  const handlers = new Map();
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });

  class BrowserWindow {
    constructor() {
      record.windows += 1;
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
    isVisible() {
      return true;
    }
    restore() {}
    show() {}
    focus() {}
    on() {}
    static getAllWindows() {
      return [];
    }
  }

  return {
    app: {
      isPackaged: false,
      getVersion: () => '0.0.0-test',
      getPath: (name) => (name === 'documents' ? documents : workRoot),
      getAppPath: () => ROOT,
      setLoginItemSettings: () => {},
      setAppUserModelId: () => {},
      requestSingleInstanceLock: () => true,
      hasSingleInstanceLock: () => true,
      relaunch: () => {},
      exit: (code) => {
        record.exit += 1;
        record.exitCode = code;
      },
      quit: () => {
        record.quit += 1;
      },
      on: () => {},
      whenReady: () => Promise.resolve()
    },
    BrowserWindow,
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
      showErrorBox: (title, message) => record.dialogs.push({ title, message })
    },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers
  };
}

async function runRealStartup(prepareData) {
  const workRoot = tempDir();
  const record = { windows: 0, exit: 0, exitCode: null, quit: 0, dialogs: [] };
  const electronMock = createElectronMock(workRoot, record);
  const dataDir = path.join(electronMock.app.getPath('documents'), '小菠萝的工作台', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  prepareData(dataDir);

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
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    Module._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
  }

  return { electronMock, record, dataDir, workRoot };
}

const futureData = (dir) => {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: FUTURE, updatedAt: '2099-01-01T00:00:00.000Z' }), 'utf8');
  fs.writeFileSync(path.join(dir, 'todos.json'), JSON.stringify([{ id: 'future-todo', futureField: 'keep-me' }]), 'utf8');
  fs.writeFileSync(path.join(dir, 'workspaces.json'), JSON.stringify([{ id: 'future-ws', name: '未来空间' }]), 'utf8');
};

test('P1-04-5 未来版本启动时：不注册 IPC、不建窗口、安全退出', async () => {
  const { electronMock, record, dataDir, workRoot } = await runRealStartup(futureData);
  try {
    assert.equal(electronMock.__handlers.size, 0, '不得注册任何可写 IPC');
    assert.equal(record.windows, 0, '不得创建窗口');
    assert.equal(record.exit, 1, '必须安全退出');
    assert.equal(record.exitCode, 1);

    const dialog = record.dialogs.find((item) => /更新版本/.test(`${item.title}${item.message}`));
    assert.ok(dialog, '必须提示使用更新版本打开');
    assert.match(dialog.message, /数据目录/);
    assert.match(dialog.message, /备份/);
    void dataDir;
  } finally {
    cleanup(workRoot);
  }
});

test('P1-04-6 未来版本启动后，数据文件逐字节未被修改', async () => {
  const { dataDir, workRoot } = await runRealStartup(futureData);
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
    assert.equal(meta.schemaVersion, FUTURE, 'meta 不得被覆盖');
    assert.equal(meta.updatedAt, '2099-01-01T00:00:00.000Z');

    const todos = JSON.parse(fs.readFileSync(path.join(dataDir, 'todos.json'), 'utf8'));
    assert.deepEqual(todos, [{ id: 'future-todo', futureField: 'keep-me' }], '业务数据必须原样保留');

    const workspaces = JSON.parse(fs.readFileSync(path.join(dataDir, 'workspaces.json'), 'utf8'));
    assert.deepEqual(workspaces, [{ id: 'future-ws', name: '未来空间' }]);

    // 不得产生 .broken- 之类的隔离文件
    const strays = fs.readdirSync(dataDir).filter((name) => name.includes('.broken-'));
    assert.deepEqual(strays, [], '未来版本下不得隔离/修复任何文件');
  } finally {
    cleanup(workRoot);
  }
});

test('P1-04-7 当前版本正常启动不受影响（对照）', async () => {
  const { electronMock, record, workRoot } = await runRealStartup((dir) => {
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: migrations.CURRENT_SCHEMA_VERSION }), 'utf8');
    fs.writeFileSync(path.join(dir, 'todos.json'), JSON.stringify([{ id: 't1', workspaceId: null }]), 'utf8');
  });
  try {
    assert.ok(electronMock.__handlers.size > 50, '当前版本应正常注册 IPC');
    assert.equal(record.windows, 1, '当前版本应正常创建窗口');
    assert.equal(record.exit, 0, '当前版本不应退出');
  } finally {
    cleanup(workRoot);
  }
});
