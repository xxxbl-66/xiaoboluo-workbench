/**
 * P1-01 Required Fix：Workflow 的 URL 步骤必须等待 openExternal 的真实结果。
 *
 * 覆盖：
 * - http / https 成功
 * - 非法协议失败
 * - shell.openExternal 直接 reject
 * - runWorkflow 的返回值必须能被 structured clone（结果里不能残留 Promise）
 * - URL 步骤失败时整个 Workflow 返回正确失败信息
 * - 继续工作时 Workflow 失败，Session 仍保持 active（不得回归）
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const { DataStore } = require('../electron/store.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-wf-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

/** 用指定的 shell mock 重新加载 launcher.cjs */
function loadLauncher(shellMock) {
  const launcherPath = require.resolve('../electron/services/launcher.cjs');
  const originalLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') return { shell: shellMock };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[launcherPath];
  try {
    return require(launcherPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createStore(dir) {
  const store = new DataStore(dir);
  store.write('todos.json', []);
  store.write('goals.json', []);
  store.write('calendar-events.json', []);
  return store;
}

function addWorkflow(store, steps) {
  const launcher = loadLauncher({ openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} });
  const items = launcher.readWorkflows(store);
  const entry = { id: `wf-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: '测试工作流', steps, sort: 1 };
  items.push(entry);
  launcher.writeWorkflows(store, items);
  return entry.id;
}

/* ------------------------------------------------------------------ *
 * URL 步骤：成功路径
 * ------------------------------------------------------------------ */
test('P1-01-1 http URL 步骤成功', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    const opened = [];
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async (url) => {
        opened.push(url);
      }
    });
    const id = addWorkflow(store, [{ id: 's1', type: 'url', url: 'http://example.com', path: '', appId: '' }]);

    const result = await launcher.runWorkflow(store, id);

    assert.equal(result.ok, true);
    assert.deepEqual(opened, ['http://example.com']);
    assert.deepEqual(result.results, [{ step: 's1', result: { ok: true } }]);
  } finally {
    cleanup(dir);
  }
});

test('P1-01-2 https URL 步骤成功', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    const opened = [];
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async (url) => {
        opened.push(url);
      }
    });
    const id = addWorkflow(store, [{ id: 's1', type: 'url', url: 'https://github.com/', path: '', appId: '' }]);

    const result = await launcher.runWorkflow(store, id);

    assert.equal(result.ok, true);
    assert.deepEqual(opened, ['https://github.com/']);
    assert.deepEqual(result.results, [{ step: 's1', result: { ok: true } }]);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * URL 步骤：失败路径
 * ------------------------------------------------------------------ */
test('P1-01-3 非法协议的 URL 步骤必须让整个 Workflow 失败', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    let called = 0;
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async () => {
        called += 1;
      }
    });
    const id = addWorkflow(store, [{ id: 's1', type: 'url', url: 'file:///C:/Windows/System32/calc.exe', path: '', appId: '' }]);

    const result = await launcher.runWorkflow(store, id);

    assert.equal(result.ok, false, '非法协议必须被判定为失败');
    assert.match(result.error, /http/);
    assert.equal(called, 0, '非法协议不能到达 shell.openExternal');
  } finally {
    cleanup(dir);
  }
});

test('P1-01-4 shell.openExternal reject 时 Workflow 失败并带出原因', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async () => {
        throw new Error('系统没有可用的浏览器');
      }
    });
    const id = addWorkflow(store, [{ id: 's1', type: 'url', url: 'https://example.com', path: '', appId: '' }]);

    const result = await launcher.runWorkflow(store, id);

    assert.equal(result.ok, false);
    assert.match(result.error, /浏览器/);
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 结果必须可序列化（不能残留 Promise）
 * ------------------------------------------------------------------ */
test('P1-01-5 runWorkflow 的返回值可以被 structured clone（结果里没有 Promise）', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    const target = path.join(dir, '目标文件.txt');
    fs.writeFileSync(target, 'x', 'utf8');
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async () => {}
    });
    const id = addWorkflow(store, [
      { id: 's1', type: 'file', path: target, url: '', appId: '' },
      { id: 's2', type: 'url', url: 'https://example.com', path: '', appId: '' }
    ]);

    const result = await launcher.runWorkflow(store, id);

    // structuredClone 遇到 Promise 会抛 DataCloneError —— 这正是 Electron IPC 的行为
    assert.doesNotThrow(() => structuredClone(result), '返回值里不能有 Promise');

    for (const item of result.results) {
      assert.ok(!(item.result instanceof Promise), `step ${item.step} 的结果不能是 Promise`);
      assert.equal(typeof item.result.ok, 'boolean', `step ${item.step} 必须带明确的 ok 字段`);
    }
  } finally {
    cleanup(dir);
  }
});

test('P1-01-6 非法的 URL 步骤即使前面有成功的步骤，也会返回正确失败信息', async () => {
  const dir = tempDir();
  try {
    const store = createStore(dir);
    const target = path.join(dir, '先打开的文件夹');
    fs.mkdirSync(target, { recursive: true });
    const launcher = loadLauncher({
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async () => {}
    });
    const id = addWorkflow(store, [
      { id: 'ok', type: 'file', path: target, url: '', appId: '' },
      { id: 'bad', type: 'url', url: 'javascript:alert(1)', path: '', appId: '' }
    ]);

    const result = await launcher.runWorkflow(store, id);

    assert.equal(result.ok, false);
    assert.equal(result.results.length, 2, '失败前已执行的步骤结果必须保留');
    assert.equal(result.results[0].result.ok, true);
    assert.equal(result.results[1].result.ok, false);
    assert.equal(result.results[1].step, 'bad');
    assert.doesNotThrow(() => structuredClone(result));
  } finally {
    cleanup(dir);
  }
});

/* ------------------------------------------------------------------ *
 * 继续工作时：工作流失败不得回滚 Session
 * ------------------------------------------------------------------ */
function createElectronMock(workRoot) {
  const handlers = new Map();
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });
  const opened = [];
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
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} },
    shell: {
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async (url) => opened.push(url)
    },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers,
    __opened: opened
  };
}

test('P1-01-7 URL 工作流失败后，Session 仍保持 active（继续工作不回归）', async () => {
  const workRoot = tempDir();
  const electronMock = createElectronMock(workRoot);
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

    const invoke = async (channel, ...args) => {
      const result = await electronMock.__handlers.get(channel)({}, ...args);
      if (!result || result.ok === false) throw new Error((result && result.error) || 'fail');
      return result.data;
    };

    const ws = await invoke('workspaces:create', { name: '程序设计大赛' });
    const wf = await invoke('workflows:create', {
      name: '恢复环境',
      steps: [{ id: 's1', type: 'url', url: 'https://github.com/', path: '', appId: '' }]
    });
    await invoke('workspaces:update', ws.id, { workflowIds: [wf.id], resumeWorkflowId: wf.id });

    // 开始工作 + 运行工作流（成功路径）
    const started = await invoke('sessions:start', ws.id);
    const runOk = await invoke('workflows:run', wf.id);
    assert.equal(runOk.ok, true);
    assert.doesNotThrow(() => structuredClone(runOk), 'IPC 返回值必须可序列化');
    assert.deepEqual(electronMock.__opened, ['https://github.com/']);

    let active = await invoke('sessions:get-active');
    assert.equal(active.id, started.session.id, '工作流成功后 Session 必须仍然 active');

    // 换成会失败的工作流（非法协议），Session 不能被回滚
    const badWf = await invoke('workflows:create', {
      name: '坏环境',
      steps: [{ id: 's1', type: 'url', url: 'ftp://example.com/x', path: '', appId: '' }]
    });
    await assert.rejects(() => invoke('workflows:run', badWf.id), /http/);

    active = await invoke('sessions:get-active');
    assert.equal(active.id, started.session.id, '工作流失败后 Session 必须仍保持 active');
    assert.equal(active.endedAt, null);

    const ended = await invoke('sessions:end', started.session.id, { note: '手动结束' });
    assert.ok(ended.endedAt);
  } finally {
    Module._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
    cleanup(workRoot);
  }
});
