/**
 * P1-02 Required Fix：结束 Session 时，completedTodoIds 必须绑定到
 * 该 Session 自己的 workspaceId，不能被当前正在浏览的 Workspace 污染。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'xb-p102-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function createElectronMock(workRoot) {
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
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: () => {} },
    shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
    session: { fromPartition: () => ({ on: () => {} }) },
    nativeImage: {
      createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) })
    },
    __handlers: handlers
  };
}

async function boot() {
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
  require(path.join(ROOT, 'electron', 'main.cjs'));
  await new Promise((resolve) => setTimeout(resolve, 120));

  const invoke = async (channel, ...args) => {
    const result = await electronMock.__handlers.get(channel)({}, ...args);
    if (!result || result.ok === false) throw new Error((result && result.error) || 'fail');
    return result.data;
  };
  const raw = (channel, ...args) => electronMock.__handlers.get(channel)({}, ...args);

  return {
    invoke,
    raw,
    teardown() {
      Module._load = originalLoad;
      globalThis.setInterval = originalSetInterval;
      cleanup(workRoot);
    }
  };
}

/** Workspace A + Todo A，Workspace B + Todo B，Session 属于 A */
async function scenario(ctx) {
  const wsA = await ctx.invoke('workspaces:create', { name: 'Workspace A' });
  const wsB = await ctx.invoke('workspaces:create', { name: 'Workspace B' });
  const todoA = await ctx.invoke('todos:create', { title: 'A 的任务', workspaceId: wsA.id });
  const todoB = await ctx.invoke('todos:create', { title: 'B 的任务', workspaceId: wsB.id });
  const loose = await ctx.invoke('todos:create', { title: '未归类任务' });
  const started = await ctx.invoke('sessions:start', wsA.id);
  return { wsA, wsB, todoA, todoB, loose, session: started.session };
}

test('P1-02-1 结束 A 的 Session 时传入 B 的 Todo，必须被拒绝', async () => {
  const ctx = await boot();
  try {
    const { todoB, session } = await scenario(ctx);

    const result = await ctx.raw('sessions:end', session.id, { completedTodoIds: [todoB.id] });
    assert.equal(result.ok, false, '跨 Workspace 的 Todo 必须被拒绝');
    assert.match(result.error, /不属于/);

    // Session 不能被结束，也不能写入非法的 Todo
    const active = await ctx.invoke('sessions:get-active');
    assert.equal(active.id, session.id, 'Session 必须仍然 active');
    assert.deepEqual(active.completedTodoIds, [], '非法 Todo 绝不能写入');
  } finally {
    ctx.teardown();
  }
});

test('P1-02-2 混合合法与非法 Todo 时，整个请求被拒绝（不做部分写入）', async () => {
  const ctx = await boot();
  try {
    const { todoA, todoB, session } = await scenario(ctx);

    const result = await ctx.raw('sessions:end', session.id, { completedTodoIds: [todoA.id, todoB.id] });
    assert.equal(result.ok, false);

    const active = await ctx.invoke('sessions:get-active');
    assert.deepEqual(active.completedTodoIds, [], '不能只写入合法的那一半');
  } finally {
    ctx.teardown();
  }
});

test('P1-02-3 属于本 Session 的 Todo 正常写入', async () => {
  const ctx = await boot();
  try {
    const { todoA, session } = await scenario(ctx);

    const ended = await ctx.invoke('sessions:end', session.id, {
      note: '完成 A',
      completedTodoIds: [todoA.id]
    });
    assert.ok(ended.endedAt);
    assert.deepEqual(ended.completedTodoIds, [todoA.id]);
  } finally {
    ctx.teardown();
  }
});

test('P1-02-4 未归类（workspaceId=null）的 Session 只能记录未归类的 Todo', async () => {
  const ctx = await boot();
  try {
    const wsA = await ctx.invoke('workspaces:create', { name: 'Workspace A' });
    const todoA = await ctx.invoke('todos:create', { title: 'A 的任务', workspaceId: wsA.id });
    const loose = await ctx.invoke('todos:create', { title: '未归类任务' });
    const started = await ctx.invoke('sessions:start', null);

    // A 的 Todo 不能被记到未归类 Session
    const rejected = await ctx.raw('sessions:end', started.session.id, { completedTodoIds: [todoA.id] });
    assert.equal(rejected.ok, false);

    // 未归类的 Todo 可以
    const ended = await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [loose.id] });
    assert.deepEqual(ended.completedTodoIds, [loose.id]);
  } finally {
    ctx.teardown();
  }
});

test('P1-02-5 不存在的 Todo ID 被拒绝', async () => {
  const ctx = await boot();
  try {
    const { session } = await scenario(ctx);
    const result = await ctx.raw('sessions:end', session.id, { completedTodoIds: ['not-a-real-todo'] });
    assert.equal(result.ok, false);
    assert.match(result.error, /不存在|不属于/);
  } finally {
    ctx.teardown();
  }
});

test('P1-02-6 空 completedTodoIds 仍然可以正常结束', async () => {
  const ctx = await boot();
  try {
    const { session } = await scenario(ctx);
    const ended = await ctx.invoke('sessions:end', session.id, { note: '没有勾选' });
    assert.ok(ended.endedAt);
    assert.deepEqual(ended.completedTodoIds, []);
  } finally {
    ctx.teardown();
  }
});

test('P1-02-7 sessions:update 也不能写入跨 Workspace 的 Todo', async () => {
  const ctx = await boot();
  try {
    const { todoB, session } = await scenario(ctx);
    const result = await ctx.raw('sessions:update', session.id, { completedTodoIds: [todoB.id] });
    assert.equal(result.ok, false, 'update 路径同样必须校验归属');

    const active = await ctx.invoke('sessions:get-active');
    assert.deepEqual(active.completedTodoIds, []);
  } finally {
    ctx.teardown();
  }
});

test('P1-02-8 sessions:last 返回的 completedTodos 仍然按 Session 自己的 Workspace 计算', async () => {
  const ctx = await boot();
  try {
    const { wsA, todoA, session } = await scenario(ctx);
    await ctx.invoke('sessions:end', session.id, { completedTodoIds: [todoA.id] });

    const last = await ctx.invoke('sessions:last', wsA.id);
    assert.equal(last.id, session.id);
    assert.deepEqual(last.completedTodos.map((item) => item.id), [todoA.id]);
  } finally {
    ctx.teardown();
  }
});
