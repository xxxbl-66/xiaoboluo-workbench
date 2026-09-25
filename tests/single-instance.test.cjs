/**
 * P1-03 Required Fix：必须只允许单实例运行。
 *
 * 两个 Electron 实例会共同读写同一批 JSON，形成跨进程丢失更新。
 * 这里用最小 electron mock 验证：
 * - 拿不到锁 → 第二实例不注册 IPC、不建窗口、直接退出
 * - 拿到锁 → 注册 second-instance，并把已有窗口 restore + focus
 * - second-instance 早于窗口创建时不能抛错，窗口建好后仍会聚焦
 *
 * 说明：真实的"双击两次"行为需要真人手动验证，见最终报告。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-single-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function createElectronMock(workRoot, options = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const windows = [];
  const calls = { quit: 0, exit: 0, restore: 0, show: 0, focus: 0 };
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });

  class BrowserWindow {
    constructor() {
      this.webContents = { on: () => {}, setWindowOpenHandler: () => {}, send: () => {} };
      this.destroyed = false;
      this.minimized = true;
      this.visible = false;
      windows.push(this);
    }
    loadURL() {}
    loadFile() {}
    isDestroyed() {
      return this.destroyed;
    }
    isMinimized() {
      return this.minimized;
    }
    isVisible() {
      return this.visible;
    }
    restore() {
      calls.restore += 1;
      this.minimized = false;
    }
    show() {
      calls.show += 1;
      this.visible = true;
    }
    focus() {
      calls.focus += 1;
    }
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
      requestSingleInstanceLock: () => options.hasLock !== false,
      hasSingleInstanceLock: () => options.hasLock !== false,
      relaunch: () => {},
      exit: () => {
        calls.exit += 1;
      },
      quit: () => {
        calls.quit += 1;
      },
      on: (event, handler) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event).push(handler);
      },
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
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers,
    __listeners: listeners,
    __windows: windows,
    __calls: calls,
    __emit: (event, ...args) => {
      for (const handler of listeners.get(event) || []) handler(...args);
    }
  };
}

async function bootWithMock(options) {
  const workRoot = tempDir();
  const electronMock = createElectronMock(workRoot, options);
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

  return {
    electronMock,
    teardown() {
      cleanup(workRoot);
    }
  };
}

test('P1-03-1 拿不到单实例锁时，第二实例不建窗口、不注册 IPC，并退出', async () => {
  const { electronMock, teardown } = await bootWithMock({ hasLock: false });
  try {
    assert.equal(electronMock.__calls.quit + electronMock.__calls.exit, 1, '第二实例必须退出');
    assert.equal(electronMock.__windows.length, 0, '第二实例不得创建窗口');
    assert.equal(electronMock.__handlers.size, 0, '第二实例不得注册任何 IPC（否则会写数据）');
  } finally {
    teardown();
  }
});

test('P1-03-2 拿到锁时正常启动，并注册 second-instance', async () => {
  const { electronMock, teardown } = await bootWithMock({ hasLock: true });
  try {
    assert.equal(electronMock.__calls.quit, 0);
    assert.equal(electronMock.__windows.length, 1, '第一个实例应创建窗口');
    assert.ok(electronMock.__handlers.size > 50, '第一个实例应注册 IPC');
    assert.ok((electronMock.__listeners.get('second-instance') || []).length >= 1, '必须注册 second-instance');
  } finally {
    teardown();
  }
});

test('P1-03-3 第二次启动时，已有窗口会被 restore + focus', async () => {
  const { electronMock, teardown } = await bootWithMock({ hasLock: true });
  try {
    const win = electronMock.__windows[0];
    win.minimized = true;
    const before = { ...electronMock.__calls };

    electronMock.__emit('second-instance', {}, ['electron'], workRootOf(electronMock));

    assert.equal(electronMock.__calls.restore, before.restore + 1, '最小化时必须 restore');
    assert.equal(electronMock.__calls.focus, before.focus + 1, '必须 focus 到已有窗口');
    assert.equal(win.minimized, false);
    assert.equal(electronMock.__windows.length, 1, '不得再开第二个窗口');
  } finally {
    teardown();
  }
});

test('P1-03-4 second-instance 在处理函数里不会再次创建窗口或注册 IPC', async () => {
  const { electronMock, teardown } = await bootWithMock({ hasLock: true });
  try {
    const windowsBefore = electronMock.__windows.length;
    const handlersBefore = electronMock.__handlers.size;

    electronMock.__emit('second-instance', {}, ['electron'], workRootOf(electronMock));
    electronMock.__emit('second-instance', {}, ['electron'], workRootOf(electronMock));

    assert.equal(electronMock.__windows.length, windowsBefore);
    assert.equal(electronMock.__handlers.size, handlersBefore);
  } finally {
    teardown();
  }
});

test('P1-03-5 窗口尚未建立时触发 second-instance：不抛错，窗口建好后补聚焦', async () => {
  const workRoot = tempDir();
  const electronMock = createElectronMock(workRoot, { hasLock: true });
  // 让 whenReady 挂起，制造"锁已拿到、窗口还没建"的窗口期
  let releaseReady = null;
  electronMock.app.whenReady = () => new Promise((resolve) => {
    releaseReady = resolve;
  });

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
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 此时还没有窗口，second-instance 不能抛错
    assert.equal(electronMock.__windows.length, 0, '窗口应尚未建立');
    assert.doesNotThrow(() => electronMock.__emit('second-instance', {}, [], workRoot));
    assert.equal(electronMock.__calls.focus, 0, '没有窗口时不应崩，也无法聚焦');

    // 放行 whenReady → 建窗口 → 应补一次聚焦
    releaseReady();
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(electronMock.__windows.length, 1, '窗口应已建立');
    assert.equal(electronMock.__calls.focus, 1, '窗口建好后必须补一次聚焦');
    assert.ok(electronMock.__calls.show >= 1, '窗口建好后应被显示到前台');
    assert.equal(electronMock.__calls.quit, 0);
  } finally {
    Module._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
    cleanup(workRoot);
  }
});

function workRootOf(electronMock) {
  return electronMock.app.getPath('userData');
}
