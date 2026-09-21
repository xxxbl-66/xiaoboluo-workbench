/**
 * 更名回归测试：小菠萝的工作台 → 四一四工作台
 *
 * 三条不可回退的约定：
 * 1. 用户可见的产品名称统一为「四一四工作台」（窗口标题 / 备份文件标识 / 导出备份）。
 * 2. 历史数据目录名 `Documents\小菠萝的工作台` 必须继续可用，
 *    更名不得让老用户启动后看到空数据。
 * 3. 更名前导出的备份（app 字段是旧名称）必须仍可正常导入。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const { DataStore } = require('../electron/store.cjs');
const { exportBackup, importBackup } = require('../electron/services/backup.cjs');

const LEGACY_APP_NAME = '小菠萝的工作台';
const PRODUCT_NAME = '四一四工作台';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-rename-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/* ------------------------------------------------------------------ *
 * 1. 备份文件的对外标识
 * ------------------------------------------------------------------ */
test('更名后导出的备份以「四一四工作台」标识自身', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    store.write('todos.json', [{ id: 't1', title: '待办' }]);

    const result = exportBackup(store);
    assert.equal(result.ok, true);

    const payload = JSON.parse(fs.readFileSync(result.filePath, 'utf8'));
    assert.equal(payload.app, PRODUCT_NAME, '导出的备份必须使用新的软件名称');
  } finally {
    cleanup(dir);
  }
});

test('更名前导出的备份（app 为旧名称）仍可导入', () => {
  const dir = tempDir();
  try {
    const store = new DataStore(dir);
    const legacyBackup = path.join(dir, 'legacy.json');
    fs.writeFileSync(
      legacyBackup,
      JSON.stringify({
        app: LEGACY_APP_NAME,
        exportedAt: '2026-08-01T00:00:00.000Z',
        data: { 'todos.json': [{ id: 'legacy-1', title: '旧版待办' }] }
      }),
      'utf8'
    );

    const result = importBackup(store, legacyBackup);
    assert.equal(result.ok, true, `旧名称备份必须可导入：${result.error || ''}`);
    assert.equal(store.read('todos.json', [])[0].id, 'legacy-1');
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 2. 真实启动链：窗口标题 + 历史数据目录
 * ------------------------------------------------------------------ */
function createElectronMock(workRoot, record) {
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });
  const handlers = new Map();

  class BrowserWindow {
    constructor(options) {
      record.windowOptions.push(options || {});
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
      getVersion: () => '0.1.2',
      getPath: (name) => (name === 'documents' ? documents : workRoot),
      getAppPath: () => ROOT,
      setLoginItemSettings: () => {},
      setAppUserModelId: () => {},
      requestSingleInstanceLock: () => true,
      hasSingleInstanceLock: () => true,
      relaunch: () => {},
      exit: () => {},
      quit: () => {},
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
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: () => {} },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showErrorBox: (title, message) => record.dialogs.push({ title, message })
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

/** 在「旧数据目录」里放一份真实的老用户数据，然后走真实启动链 */
async function runRealStartup() {
  const workRoot = tempDir();
  const record = { windows: 0, dialogs: [], windowOptions: [] };
  const electronMock = createElectronMock(workRoot, record);

  const legacyDataDir = path.join(electronMock.__documents, LEGACY_APP_NAME, 'data');
  fs.mkdirSync(legacyDataDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDataDir, 'meta.json'), JSON.stringify({ schemaVersion: 1, updatedAt: '2026-08-01T00:00:00.000Z' }), 'utf8');
  fs.writeFileSync(path.join(legacyDataDir, 'todos.json'), JSON.stringify([{ id: 'legacy-todo', title: '更名前就存在的待办', workspaceId: null }]), 'utf8');
  fs.writeFileSync(path.join(legacyDataDir, 'workspaces.json'), JSON.stringify([{ id: 'legacy-ws', name: '更名前的工作空间' }]), 'utf8');
  fs.writeFileSync(
    path.join(electronMock.__documents, LEGACY_APP_NAME, 'config.json'),
    JSON.stringify({}),
    'utf8'
  );

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

  return { electronMock, record, legacyDataDir, workRoot };
}

test('更名后窗口标题为「四一四工作台」', async () => {
  const { record, workRoot } = await runRealStartup();
  try {
    assert.equal(record.windows, 1, '更名不得影响窗口创建');
    assert.equal(record.windowOptions[0].title, PRODUCT_NAME);
  } finally {
    cleanup(workRoot);
  }
});

test('更名后仍从历史数据目录读取旧用户数据（不丢数据、不新建空目录）', async () => {
  const { electronMock, record, legacyDataDir, workRoot } = await runRealStartup();
  try {
    assert.deepEqual(record.dialogs, [], '读旧数据不应触发任何错误弹窗');
    assert.equal(record.windows, 1, '应正常建窗，而不是因为找不到数据而停下');

    // 旧数据必须原地保留、内容不变
    const todos = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'todos.json'), 'utf8'));
    assert.equal(todos[0].id, 'legacy-todo');
    const workspaces = JSON.parse(fs.readFileSync(path.join(legacyDataDir, 'workspaces.json'), 'utf8'));
    assert.equal(workspaces[0].id, 'legacy-ws');

    // 不得因为更名而在旁边新建一个以新名称命名的数据目录
    const documents = electronMock.__documents;
    const created = fs.readdirSync(documents).filter((name) => name !== LEGACY_APP_NAME);
    assert.deepEqual(created, [], `更名不得另建数据目录：${created.join('、')}`);
  } finally {
    cleanup(workRoot);
  }
});
