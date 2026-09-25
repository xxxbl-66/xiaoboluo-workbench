/**
 * IPC 冒烟测试：用最小的 electron mock 加载真实的 electron/main.cjs，
 * 直接调用注册好的 ipcMain.handle 回调，验证"渲染层 → preload → IPC → 服务层 → DataStore"整条链路。
 *
 * 这里不启动任何窗口，也不会碰到用户的真实数据目录。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const MAIN_PATH = path.join(ROOT, 'electron', 'main.cjs');

function createElectronMock(workRoot) {
  const handlers = new Map();
  const documents = path.join(workRoot, 'documents');
  fs.mkdirSync(documents, { recursive: true });
  const openedExternal = [];
  const notifications = [];

  const app = {
    isPackaged: false,
    getVersion: () => '0.0.0-test',
    getPath: (name) => (name === 'documents' ? documents : workRoot),
    getAppPath: () => ROOT,
    setLoginItemSettings: () => {},
    setAppUserModelId: () => {},
    // P1-03：main.cjs 现在会先抢单实例锁；这里的 mock 扮演"第一个实例"
    requestSingleInstanceLock: () => true,
    hasSingleInstanceLock: () => true,
    relaunch: () => {},
    exit: () => {},
    quit: () => {},
    on: () => {},
    whenReady: () => Promise.resolve()
  };

  class BrowserWindow {
    constructor() {
      this.webContents = {
        on: () => {},
        setWindowOpenHandler: () => {},
        send: () => {}
      };
    }
    loadURL() {}
    loadFile() {}
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    show() {}
    focus() {}
    on() {}
    static getAllWindows() {
      return [];
    }
  }

  class Notification {
    constructor(options) {
      notifications.push(options);
      this.handlers = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    show() {}
    static isSupported() {
      return true;
    }
  }

  return {
    app,
    BrowserWindow,
    Notification,
    ipcMain: {
      handle: (channel, fn) => handlers.set(channel, fn),
      on: () => {}
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showErrorBox: () => {}
    },
    shell: {
      openPath: async () => '',
      showItemInFolder: () => {},
      openExternal: async (url) => {
        openedExternal.push(url);
      }
    },
    session: {
      fromPartition: () => ({ on: () => {} })
    },
    nativeImage: {
      createFromPath: () => ({
        isEmpty: () => true,
        resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' })
      })
    },
    __handlers: handlers,
    __documents: documents,
    __openedExternal: openedExternal,
    __notifications: notifications
  };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

/**
 * 在受控的 electron mock 下加载 main.cjs，返回 ipcMain 的 handler 表。
 *
 * 注意：main.cjs 通过 app.whenReady().then(...) 启动，回调是微任务，会在 require()
 * 返回之后才执行。所以 setInterval 的桩必须一直保留到微任务跑完，否则真正的
 * "每小时同步长期目标" 定时器会被创建，node:test 进程永远无法退出。
 */
const capturedIntervals = [];

async function loadMainWithMock() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xb-ipc-'));
  const electronMock = createElectronMock(workRoot);

  const originalLoad = Module._load;
  const originalSetInterval = globalThis.setInterval;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') return electronMock;
    return originalLoad.apply(this, arguments);
  };
  globalThis.setInterval = function stubSetInterval(fn, ms, ...rest) {
    capturedIntervals.push({ fn, ms });
    return { fake: true, unref: () => {}, ref: () => {} };
  };

  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT) && !key.includes('node_modules')) delete require.cache[key];
  }

  try {
    require(MAIN_PATH);
    await settle();
  } finally {
    Module._load = originalLoad;
    globalThis.setInterval = originalSetInterval;
  }

  return { electronMock, workRoot };
}

/** 模拟 preload 的 invoke：解包 {ok,data} / {ok:false,error} */
function makeInvoke(handlers) {
  return async (channel, ...args) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`未注册的 IPC 通道：${channel}`);
    const result = await handler({}, ...args);
    if (!result || result.ok === false) {
      throw new Error((result && result.error) || '操作失败');
    }
    return result.data;
  };
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

test('IPC 冒烟：main.cjs 在 mock 环境下能注册全部 Workspace / Session 通道', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const handlers = electronMock.__handlers;
    const required = [
      'workspaces:list',
      'workspaces:get',
      'workspaces:create',
      'workspaces:update',
      'workspaces:archive',
      'workspaces:reorder',
      'workspaces:touch',
      'workspaces:recent',
      'workspaces:link-resource',
      'sessions:list',
      'sessions:get-active',
      'sessions:start',
      'sessions:end',
      'sessions:update',
      'sessions:summary',
      'sessions:last',
      // 阶段一新增：受控时长校正 / 继续未结束会话 / 最小工作历史
      'sessions:adjust-duration',
      'sessions:resume',
      'sessions:history',
      'system:path-exists',
      'system:path-exists-batch'
    ];
    for (const channel of required) {
      assert.ok(handlers.has(channel), `缺少 IPC 通道 ${channel}`);
    }
    for (const channel of ['todos:list', 'goals:list', 'apps:list', 'files:favorites:list', 'workflows:list', 'backup:export']) {
      assert.ok(handlers.has(channel), `原有 IPC 通道丢失：${channel}`);
    }
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：创建 → 修改 → 归档 → 开始/结束会话 全链路可用', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);

    const list0 = await invoke('workspaces:list');
    assert.deepEqual(list0, []);

    const ws = await invoke('workspaces:create', { name: '程序设计大赛', description: '比赛项目' });
    assert.equal(ws.name, '程序设计大赛');

    const listed = await invoke('workspaces:list');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].pendingTodoCount, 0);
    assert.equal(listed[0].totalSeconds, 0);

    await invoke('workspaces:touch', ws.id);
    const touched = await invoke('workspaces:list');
    assert.ok(touched[0].lastOpenedAt);

    const todo = await invoke('todos:create', { title: '登录接口', workspaceId: ws.id });
    assert.equal(todo.workspaceId, ws.id, 'todos:create 必须保留 workspaceId');
    const todo2 = await invoke('todos:create', { title: '未归类任务' });
    assert.equal(todo2.workspaceId, null);

    const withTodo = await invoke('workspaces:list');
    assert.equal(withTodo[0].pendingTodoCount, 1);

    const started = await invoke('sessions:start', ws.id);
    assert.equal(started.started, true);

    const active = await invoke('sessions:get-active');
    assert.equal(active.id, started.session.id);

    const blocked = await invoke('sessions:start', ws.id);
    assert.equal(blocked.started, false);
    assert.equal(blocked.reason, 'active-exists');

    const ended = await invoke('sessions:end', started.session.id, {
      note: '登录接口基本完成',
      nextStep: '完成 Token 刷新与权限测试',
      completedTodoIds: [todo.id]
    });
    assert.ok(ended.endedAt);
    assert.equal(ended.note, '登录接口基本完成');

    const last = await invoke('sessions:last', ws.id);
    assert.equal(last.id, ended.id);
    assert.equal(last.completedTodos.length, 1);
    assert.equal(last.remainingTodos.length, 1);

    await invoke('workspaces:archive', ws.id);
    assert.deepEqual(await invoke('workspaces:list'), []);
    const archived = await invoke('workspaces:list', { includeArchived: true });
    assert.equal(archived.length, 1);
    assert.equal(archived[0].archived, true);

    // 归档后关联数据与历史会话必须完整保留
    const todosAfter = await invoke('todos:list');
    assert.equal(todosAfter.length, 2);
    assert.equal(todosAfter.find((item) => item.id === todo.id).workspaceId, ws.id);
    const sessionsAfter = await invoke('sessions:list', { workspaceId: ws.id });
    assert.equal(sessionsAfter.length, 1);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：未归类（workspaceId: null）与具体 Workspace 是不同作用域', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const wsA = await invoke('workspaces:create', { name: 'A' });
    const wsB = await invoke('workspaces:create', { name: 'B' });

    const goal = await invoke('goals:create', { title: '每日算法', workspaceId: wsA.id });
    assert.equal(goal.workspaceId, wsA.id);

    const bookmark = await invoke('bookmarks:create', { title: '文章', workspaceId: wsB.id });
    assert.equal(bookmark.workspaceId, wsB.id);
    const loose = await invoke('bookmarks:create', { title: '未归类文章' });
    assert.equal(loose.workspaceId, null);

    const note = await invoke('files:notes:create', { title: '便签', content: '', workspaceId: wsA.id });
    assert.equal(note.workspaceId, wsA.id);

    // 文件收藏：同一路径可以在两个 Workspace 中分别收藏，但同一作用域内不允许重复
    const target = path.join(workRoot, 'BugLens');
    fs.mkdirSync(target, { recursive: true });
    const fav1 = await invoke('files:favorites:add', target, wsA.id);
    assert.equal(fav1.length, 1);
    const fav2 = await invoke('files:favorites:add', target, wsA.id);
    assert.equal(fav2.length, 1, '同一 workspaceId 内重复添加应被拒绝');
    const fav3 = await invoke('files:favorites:add', target, wsB.id);
    assert.equal(fav3.length, 2, '不同 Workspace 可以收藏同一路径');
    const fav4 = await invoke('files:favorites:add', target);
    assert.equal(fav4.length, 3, 'null 是独立作用域');

    const moved = await invoke('workspaces:link-resource', { kind: 'goal', id: goal.id, workspaceId: wsB.id });
    assert.equal(moved.workspaceId, wsB.id);

    const detached = await invoke('workspaces:link-resource', { kind: 'bookmark', id: loose.id, workspaceId: null });
    assert.equal(detached.workspaceId, null);

    await assert.rejects(
      () => invoke('workspaces:link-resource', { kind: 'goal', id: goal.id, workspaceId: 'not-exist' }),
      /工作空间不存在/
    );
    await assert.rejects(
      () => invoke('workspaces:link-resource', { kind: 'unknown', id: 'x', workspaceId: wsA.id }),
      /不支持的资源类型/
    );
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：App 的 workspaceId 与 groupId 互不影响', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: '程序设计大赛' });

    const exe = path.join(workRoot, 'vscode.exe');
    fs.writeFileSync(exe, 'stub', 'utf8');
    const added = await invoke('apps:add', exe, { name: 'VS Code', groupId: '开发工具', workspaceId: ws.id });

    assert.equal(added.workspaceId, ws.id);
    assert.equal(added.groupId, '开发工具');
    assert.equal(added.launchCount, 0);

    const updated = await invoke('apps:update', added.id, { workspaceId: null });
    assert.equal(updated.workspaceId, null);
    assert.equal(updated.groupId, '开发工具', '清除 workspaceId 不应影响 groupId');

    const back = await invoke('apps:update', added.id, { groupId: '其他工具' });
    assert.equal(back.groupId, '其他工具');
    assert.equal(back.workspaceId, null);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：workspaces:delete 默认被拒绝（只允许归档）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: 'A' });
    await assert.rejects(() => invoke('workspaces:delete', ws.id), /只支持归档/);
    assert.equal((await invoke('workspaces:list')).length, 1);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：path-exists 返回 boolean 而不是抛错', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const existing = path.join(workRoot, 'exists.txt');
    fs.writeFileSync(existing, 'x', 'utf8');

    assert.equal(await invoke('system:path-exists', existing), true);
    assert.equal(await invoke('system:path-exists', path.join(workRoot, 'nope.txt')), false);
    assert.equal(await invoke('system:path-exists', ''), false);
    assert.equal(await invoke('system:path-exists', null), false);

    const batch = await invoke('system:path-exists-batch', [existing, path.join(workRoot, 'nope.txt')]);
    assert.equal(batch[existing], true);
    assert.equal(batch[path.join(workRoot, 'nope.txt')], false);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：openExternal 只允许 http/https（P1-6 协议白名单）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);

    await invoke('system:open-external', 'https://github.com/xiaoboluo');
    await invoke('system:open-external', 'http://example.com');
    assert.deepEqual(electronMock.__openedExternal, ['https://github.com/xiaoboluo', 'http://example.com']);

    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'ms-settings:', 'javascript:alert(1)', 'ftp://x/y', '', 'nonsense']) {
      await assert.rejects(() => invoke('system:open-external', bad), /http/, `应拒绝：${bad}`);
    }
    assert.equal(electronMock.__openedExternal.length, 2, '被拒绝的协议不能到达 shell.openExternal');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：待办提醒走主进程通知（P1-1）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const result = await invoke('system:notify', { title: '待办提醒', body: '提交比赛材料' });
    assert.equal(result.shown, true);
    assert.equal(electronMock.__notifications.length, 1);
    assert.equal(electronMock.__notifications[0].body, '提交比赛材料');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：review:get 是只读的，不再写盘（P1-3）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const dataDir = path.join(electronMock.__documents, '小菠萝的工作台', 'data');
    const reviewFile = path.join(dataDir, 'daily-review.json');

    const readRecords = () => (fs.existsSync(reviewFile)
      ? JSON.parse(fs.readFileSync(reviewFile, 'utf8'))
      : null);

    const before = readRecords();

    const record = await invoke('review:get', '2026-05-20');
    assert.equal(record.date, '2026-05-20');
    assert.equal(record.readingMinutes, 0);
    assert.deepEqual(record.answers, { whatDid: '', whatLearned: '', whatImprove: '' });

    const after = readRecords();
    assert.deepEqual(after, before === null ? [] : before, 'review:get 不应新增任何复盘记录');

    const list = await invoke('review:list');
    assert.deepEqual(list, [], '不应该凭空产生一条空复盘记录');

    // 只有 update 才落盘
    await invoke('review:update', '2026-05-20', { answers: { whatDid: '完成了工作空间' } });
    const saved = await invoke('review:list');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].answers.whatDid, '完成了工作空间');
    // 部分更新不应覆盖其他字段
    await invoke('review:update', '2026-05-20', { readingMinutes: 30 });
    const saved2 = await invoke('review:get', '2026-05-20');
    assert.equal(saved2.answers.whatDid, '完成了工作空间');
    assert.equal(saved2.readingMinutes, 30);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：无权限目录返回可读错误而不是崩溃', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const result = await invoke('files:browse', path.join(workRoot, '不存在的目录'));
    assert.equal(result.error, '目录不存在');
    assert.deepEqual(result.entries, []);

    // 正常目录依然可用
    const ok = await invoke('files:browse', workRoot);
    assert.equal(ok.error, null);
    assert.ok(Array.isArray(ok.entries));
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：快速便签读写可用（writeNotes 导出回归）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);

    const created = await invoke('files:notes:get-quick');
    assert.ok(created && created.id, 'get-quick 应返回一条快速便签');
    assert.equal(created.type, 'quick');

    const saved = await invoke('files:notes:save-quick', '明天要做的事');
    assert.equal(saved.content, '明天要做的事');

    const reloaded = await invoke('files:notes:get-quick');
    assert.equal(reloaded.content, '明天要做的事');
    assert.equal(reloaded.id, created.id, '不应重复创建快速便签');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：便签与文件收藏可以关联/解除关联工作空间（writeFavorites/writeNotes 导出回归）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: 'A' });

    const note = await invoke('files:notes:create', { title: '便签', content: 'x' });
    const linkedNote = await invoke('workspaces:link-resource', { kind: 'note', id: note.id, workspaceId: ws.id });
    assert.equal(linkedNote.workspaceId, ws.id);
    const unlinkedNote = await invoke('workspaces:link-resource', { kind: 'note', id: note.id, workspaceId: null });
    assert.equal(unlinkedNote.workspaceId, null);

    const target = path.join(workRoot, '资料');
    fs.mkdirSync(target, { recursive: true });
    const favorites = await invoke('files:favorites:add', target);
    const entry = favorites.find((item) => item.path === target);
    assert.ok(entry, '应能收藏这个文件夹');

    const linkedFav = await invoke('workspaces:link-resource', { kind: 'favorite', id: entry.id, workspaceId: ws.id });
    assert.equal(linkedFav.workspaceId, ws.id);

    const overview = await invoke('workspaces:list');
    assert.equal(overview[0].id, ws.id);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：旧数据没有 workspaceId 时，原有列表通道仍然正常', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);

    // 直接写入"迁移前"形态的旧数据（完全没有 workspaceId 字段）
    const dataDir = path.join(electronMock.__documents, '小菠萝的工作台', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'todos.json'), JSON.stringify([
      { id: 'legacy-1', title: '旧待办', priority: 'medium', completed: false, sort: 1 },
      { id: 'legacy-2', title: '旧待办 2', priority: 'low', completed: true, sort: 2 }
    ]), 'utf8');
    fs.writeFileSync(path.join(dataDir, 'bookmarks.json'), JSON.stringify([
      { id: 'b-legacy', type: 'article', url: 'https://a.com', title: '旧收藏', note: '' }
    ]), 'utf8');

    const todos = await invoke('todos:list');
    assert.equal(todos.length, 2);
    assert.equal(todos[0].workspaceId, undefined, '读路径本身不应改写数据');

    const bookmarks = await invoke('bookmarks:list');
    assert.equal(bookmarks.length, 1);

    const ws = await invoke('workspaces:create', { name: '新空间' });
    const overview = await invoke('workspaces:list');
    assert.equal(overview.length, 1);
    assert.equal(overview[0].id, ws.id);
    assert.equal(overview[0].pendingTodoCount, 0, '未归类旧数据不应被算进新空间');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：长期目标生成的待办继承 workspaceId，手动待办不受同步算法影响', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: '程序设计大赛' });

    const goal = await invoke('goals:create', { title: '刷题目标', workspaceId: ws.id });
    await invoke('goals:update', goal.id, {
      recurrence: { type: 'daily', days: [] },
      recurrenceTask: '每日一题'
    });

    const todos = await invoke('todos:list');
    const generated = todos.filter((item) => item.generated && item.sourceGoalId === goal.id);
    assert.ok(generated.length > 0, '应生成至少一条周期待办');
    for (const item of generated) {
      assert.equal(item.workspaceId, ws.id, '自动生成的待办必须继承目标的 workspaceId');
    }

    // 手动待办：同步算法不得清掉它的 workspaceId
    const manual = await invoke('todos:create', { title: '手动任务', workspaceId: ws.id });
    await invoke('goals:update', goal.id, { recurrenceTask: '每日一题（改）' });
    const after = await invoke('todos:list');
    assert.equal(
      after.find((item) => item.id === manual.id).workspaceId,
      ws.id,
      '手动待办的 workspaceId 不能被同步算法清掉'
    );
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：目标换工作空间后，它生成的待办跟着走', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const wsA = await invoke('workspaces:create', { name: 'A' });
    const wsB = await invoke('workspaces:create', { name: 'B' });

    const goal = await invoke('goals:create', { title: '目标', workspaceId: wsA.id });
    await invoke('goals:update', goal.id, { recurrence: { type: 'daily', days: [] }, recurrenceTask: '每日' });

    const before = (await invoke('todos:list')).filter((item) => item.sourceGoalId === goal.id);
    assert.ok(before.length > 0);
    assert.ok(before.every((item) => item.workspaceId === wsA.id));

    await invoke('goals:update', goal.id, { workspaceId: wsB.id });

    const after = (await invoke('todos:list')).filter((item) => item.sourceGoalId === goal.id);
    assert.ok(after.length > 0);
    assert.ok(after.every((item) => item.workspaceId === wsB.id), '生成待办应跟随目标换到 B');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：工作空间详情数据（sessions:last）包含上次完成与当前剩余', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: '程序设计大赛' });

    assert.equal(await invoke('sessions:last', ws.id), null, '还没有工作记录时应返回 null');

    const done = await invoke('todos:create', { title: '登录页面', workspaceId: ws.id });
    const pending = await invoke('todos:create', { title: '权限测试', workspaceId: ws.id });
    await invoke('todos:create', { title: '别的空间的任务', workspaceId: null });

    const started = await invoke('sessions:start', ws.id);
    const ended = await invoke('sessions:end', started.session.id, {
      note: 'Token 刷新接口还有问题',
      nextStep: '修复 Token 刷新并进行权限测试',
      completedTodoIds: [done.id]
    });

    const last = await invoke('sessions:last', ws.id);
    assert.equal(last.id, ended.id);
    assert.deepEqual(last.completedTodos.map((item) => item.id), [done.id]);
    assert.deepEqual(
      last.remainingTodos.map((item) => item.id),
      [done.id, pending.id],
      '剩余任务必须按工作空间过滤（未归类的不算进来）'
    );

    // 完成之后不应再出现在"当前剩余"里
    await invoke('todos:update', done.id, { completed: true });
    const last2 = await invoke('sessions:last', ws.id);
    assert.deepEqual(last2.remainingTodos.map((item) => item.id), [pending.id]);
    assert.deepEqual(last2.completedTodos.map((item) => item.id), [done.id], '上次完成是快照，不随之后的状态变化');
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟：继续工作相关的工作流能力（run 成功 / 失败 / 已删除）', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);

    // 成功路径：file 步骤 + 被 mock 的 shell.openPath
    const target = path.join(workRoot, '项目文件夹');
    fs.mkdirSync(target, { recursive: true });
    const good = await invoke('workflows:create', {
      name: '打开项目',
      steps: [{ id: 's1', type: 'file', path: target, url: '', appId: '' }]
    });
    const runOk = await invoke('workflows:run', good.id);
    assert.equal(runOk.ok, true);

    // 失败路径：app 步骤引用不存在的应用
    const bad = await invoke('workflows:create', {
      name: '坏工作流',
      steps: [{ id: 's1', type: 'app', appId: 'not-exist', path: '', url: '' }]
    });
    await assert.rejects(() => invoke('workflows:run', bad.id), /应用不存在/);

    // 工作流被删除后，workspaces:update 不应报错，只是默认工作流失效
    const ws = await invoke('workspaces:create', {
      name: 'A',
      workflowIds: [good.id],
      resumeWorkflowId: good.id
    });
    assert.equal(ws.resumeWorkflowId, good.id);

    await invoke('workflows:delete', good.id);
    const afterDelete = await invoke('workspaces:list');
    assert.equal(afterDelete[0].workflowIds.length, 1, 'workspaceId 侧仍然保留这个 id（容错由前端忽略）');

    // 再次运行已删除的工作流应明确报错，而不是静默成功
    await assert.rejects(() => invoke('workflows:run', good.id), /工作流不存在/);
  } finally {
    cleanupDir(workRoot);
  }
});

/* ------------------------------------------------------------------ *
 * 阶段一新增：校正后的时长必须贯穿"复盘 / 累计时长 / 历史 / 快照"
 * ------------------------------------------------------------------ */

test('IPC 冒烟（阶段一）：校正时长后，复盘汇总、Workspace 累计、历史与快照保持一致', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: '全链路项目' });
    const todo = await invoke('todos:create', { title: '完成主流程', workspaceId: ws.id });

    const started = await invoke('sessions:start', ws.id);
    const ended = await invoke('sessions:end', started.session.id, {
      note: '完成主要功能',
      nextStep: '补测试',
      completedTodoIds: [todo.id]
    });

    // 校正前：各处都使用机器计算的墙上时长
    const summaryBefore = await invoke('sessions:summary', { dateKey: ended.dateKey });
    assert.equal(summaryBefore.totalSeconds, ended.durationSeconds);
    const wsBefore = (await invoke('workspaces:list', { includeArchived: true })).find((item) => item.id === ws.id);
    assert.equal(wsBefore.totalSeconds, ended.durationSeconds);

    // 受控校正
    const adjusted = await invoke('sessions:adjust-duration', started.session.id, 2700, { reason: '实际工作时长' });
    assert.equal(adjusted.durationSeconds, 2700);
    assert.equal(adjusted.originalDurationSeconds, ended.durationSeconds, '原始时长必须留档');

    // 校正后：四处必须一致，不允许同时存在互相矛盾的总时长
    const summaryAfter = await invoke('sessions:summary', { dateKey: ended.dateKey });
    assert.equal(summaryAfter.totalSeconds, 2700, '今日复盘必须使用校正后的有效时长');

    const wsAfter = (await invoke('workspaces:list', { includeArchived: true })).find((item) => item.id === ws.id);
    assert.equal(wsAfter.totalSeconds, 2700, 'Workspace 累计时长必须同步更新');

    const last = await invoke('sessions:last', ws.id);
    assert.equal(last.durationSeconds, 2700, '工作快照不能继续显示旧时长');

    const history = await invoke('sessions:history', { workspaceId: ws.id });
    assert.equal(history.length, 1);
    assert.equal(history[0].durationSeconds, 2700);
    assert.equal(history[0].durationAdjusted, true);
    assert.equal(history[0].completedCount, 1);
    assert.equal(history[0].completedTodos[0].title, '完成主流程');
    assert.equal(history[0].note, '完成主要功能');
    assert.equal(history[0].nextStep, '补测试');

    // 单 active 规则不回归
    const second = await invoke('sessions:start', ws.id);
    assert.equal(second.started, true);
    const blocked = await invoke('sessions:start', ws.id);
    assert.equal(blocked.started, false);
    assert.equal(blocked.reason, 'active-exists');
    await invoke('sessions:end', second.session.id, {});
    assert.equal(await invoke('sessions:get-active'), null);

    const all = await invoke('sessions:list', { workspaceId: ws.id });
    assert.equal(all.length, 2);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟（阶段一）：继续未结束的工作不新建记录，且会话结束的 Todo 归属校验不回归', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const wsA = await invoke('workspaces:create', { name: 'A' });
    const wsB = await invoke('workspaces:create', { name: 'B' });
    const todoB = await invoke('todos:create', { title: 'B 的任务', workspaceId: wsB.id });

    const started = await invoke('sessions:start', wsA.id);
    const resumed = await invoke('sessions:resume', started.session.id);
    assert.equal(resumed.id, started.session.id);
    assert.ok(resumed.resumedAt);
    assert.equal((await invoke('sessions:list', {})).length, 1, '继续不能新建第二条记录');

    // 归属校验不回归：B 的任务不能写进 A 的会话
    await assert.rejects(
      () => invoke('sessions:end', started.session.id, { completedTodoIds: [todoB.id] }),
      /不属于/
    );
    const stillActive = await invoke('sessions:get-active');
    assert.equal(stillActive.id, started.session.id, '非法结束被拒绝后会话必须仍然 active');

    const ended = await invoke('sessions:end', started.session.id, { note: '正常结束' });
    assert.ok(ended.endedAt);
    assert.equal(ended.completedTodoIds.length, 0);

    // 已结束的会话不能被重复结束覆盖
    await assert.rejects(() => invoke('sessions:end', started.session.id, { note: '重复' }), /已经结束/);
  } finally {
    cleanupDir(workRoot);
  }
});

test('IPC 冒烟（阶段一）：备份导出 / 导入在新增 Session 审计字段后仍可用', async () => {
  const { electronMock, workRoot } = await loadMainWithMock();
  try {
    const invoke = makeInvoke(electronMock.__handlers);
    const ws = await invoke('workspaces:create', { name: '备份项目' });
    const started = await invoke('sessions:start', ws.id);
    await invoke('sessions:end', started.session.id, { note: '待备份' });
    await invoke('sessions:adjust-duration', started.session.id, 900, { reason: '校正后备份' });

    const exported = await invoke('backup:export');
    assert.ok(exported && exported.filePath, '备份导出必须返回文件路径');
    assert.ok(fs.existsSync(exported.filePath), '备份文件必须真实存在');

    const payload = JSON.parse(fs.readFileSync(exported.filePath, 'utf8'));
    const data = payload.data || payload;
    const sessions = data['work-sessions.json'];
    assert.ok(Array.isArray(sessions), '备份必须包含 work-sessions.json');
    assert.equal(sessions[0].durationSeconds, 900);
    assert.equal(sessions[0].durationAdjustmentReason, '校正后备份');
  } finally {
    cleanupDir(workRoot);
  }
});
