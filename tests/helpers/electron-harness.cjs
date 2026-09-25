/**
 * 隔离的 Electron mock 与 main.cjs 启动器（阶段一测试共用）。
 *
 * 与 tests/ipc.test.cjs、tests/session-workspace-binding.test.cjs 保持同一套做法：
 * 加载【真实的】electron/main.cjs，直接调用注册好的 ipcMain.handle 回调，
 * 走完整链路：渲染层 → preload → IPC → 服务层 → DataStore。
 *
 * 所有数据都落在 mkdtemp 出来的临时目录里，绝不触碰真实用户数据目录。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');

function tempDir(prefix = 'xb-stage1-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function createElectronMock(workRoot) {
  const handlers = new Map();
  const ipcOn = new Map();
  const sentToRenderer = [];
  const windows = [];
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
        this.handlers = new Map();
        this.destroyed = false;
        this.closeCount = 0;
        this.webContents = {
          on: () => {},
          setWindowOpenHandler: () => {},
          send: (channel, payload) => sentToRenderer.push({ channel, payload })
        };
        windows.push(this);
      }
      loadURL() {}
      loadFile() {}
      isDestroyed() {
        return this.destroyed;
      }
      isMinimized() {
        return false;
      }
      restore() {}
      show() {}
      focus() {}
      close() {
        this.closeCount += 1;
        let prevented = false;
        const event = { preventDefault: () => { prevented = true; } };
        for (const handler of this.handlers.get('close') || []) handler(event);
        if (!prevented) {
          this.destroyed = true;
          for (const handler of this.handlers.get('closed') || []) handler();
        }
        return !prevented;
      }
      on(name, handler) {
        if (!this.handlers.has(name)) this.handlers.set(name, []);
        this.handlers.get(name).push(handler);
      }
      static getAllWindows() {
        return windows.filter((window) => !window.destroyed);
      }
    },
    Notification: class {
      on() {}
      show() {}
      static isSupported() {
        return true;
      }
    },
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: (channel, fn) => ipcOn.set(channel, fn)
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers,
    __ipcOn: ipcOn,
    __sentToRenderer: sentToRenderer,
    __windows: windows,
    __documents: documents
  };
}

/**
 * 启动一套隔离的 main.cjs 环境。
 * @param {string} [prefix] 临时目录前缀
 * @param {{workRoot?: string, keepRoot?: boolean}} [options]
 *   workRoot 存在时复用同一个目录（用于模拟"关闭应用后重新启动"）
 */
async function boot(prefix, options = {}) {
  const workRoot = options.workRoot || tempDir(prefix);
  const electronMock = createElectronMock(workRoot);
  const originalLoad = Module._load;
  const originalSetInterval = globalThis.setInterval;

  Module._load = function patched(request) {
    if (request === 'electron') return electronMock;
    return originalLoad.apply(this, arguments);
  };
  // main.cjs 会挂一个每小时同步长期目标的定时器，必须桩掉，否则测试进程无法退出
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

  /** 模拟 preload：解包 {ok,data} / {ok:false,error} */
  const invoke = async (channel, ...args) => {
    const handler = electronMock.__handlers.get(channel);
    if (!handler) throw new Error(`未注册的 IPC 通道：${channel}`);
    const result = await handler({}, ...args);
    if (!result || result.ok === false) {
      throw new Error((result && result.error) || '操作失败');
    }
    return result.data;
  };

  /** 保留 IPC 包装，用于断言"业务失败没有被当成成功" */
  const raw = async (channel, ...args) => {
    const handler = electronMock.__handlers.get(channel);
    if (!handler) throw new Error(`未注册的 IPC 通道：${channel}`);
    return handler({}, ...args);
  };

  return {
    workRoot,
    /** 真实数据根目录（main.cjs 用 documents/小菠萝的工作台，兼容老目录名） */
    dataDir: path.join(electronMock.__documents, '小菠萝的工作台'),
    electronMock,
    invoke,
    raw,
    send: (channel, payload) => {
      const handler = electronMock.__ipcOn.get(channel);
      if (!handler) throw new Error(`未注册的 IPC 事件通道：${channel}`);
      return handler({}, payload);
    },
    teardown() {
      if (options.keepRoot) {
        electronMock.__handlers.clear();
        return;
      }
      cleanup(workRoot);
    }
  };
}

/** 把某个数据文件变成不可写：让 data 目录本身变成一个文件，写入必然失败 */
function breakDataDir(ctx) {
  const dataDir = path.join(ctx.dataDir, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, 'blocked', 'utf8');
}

/** 恢复可写的数据目录（删除占位文件后由 store 重建） */
function restoreDataDir(ctx) {
  const dataDir = path.join(ctx.dataDir, 'data');
  try {
    fs.rmSync(dataDir, { force: true });
  } catch (_) {}
  fs.mkdirSync(dataDir, { recursive: true });
}

module.exports = {
  ROOT,
  tempDir,
  cleanup,
  createElectronMock,
  boot,
  breakDataDir,
  restoreDataDir
};
