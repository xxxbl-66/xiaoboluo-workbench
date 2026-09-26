const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { parse, compileScript } = require('@vue/compiler-sfc');
const esbuild = require('esbuild');
const fs = require('node:fs');
const { createHost } = require('./helpers/vue-host.cjs');

async function loadComponent(name, options = {}) {
  const filename = path.join(__dirname, '..', 'src/renderer/src', name === 'WorkspaceView.vue' ? 'views' : 'components', name);
  const result = await esbuild.build({
    entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['vue'],
    plugins: [{ name: 'required-fix-mocks', setup(build) {
      if (options.captureToast) {
        build.onLoad({ filter: /[\\/]composables[\\/]toast\.js$/ }, () => ({
          contents: 'export function toast(message, type = "info") { globalThis.__testToastCalls.push({ message, type }); }',
          loader: 'js'
        }));
      }
      if (options.mockActiveSession) {
        build.onLoad({ filter: /[\\/]composables[\\/]useWorkSession\.js$/ }, () => ({
          contents: `import { ref, computed } from 'vue';
            const activeSession = ref(globalThis.__testActiveSession);
            const elapsedSeconds = ref(0);
            const isWorking = computed(() => Boolean(activeSession.value && !activeSession.value.endedAt));
            export function useWorkSession() { return { activeSession, elapsedSeconds, isWorking,
              startSession: async () => {}, endSession: async () => {} }; }`,
          loader: 'js'
        }));
      }
    } }, { name: 'vue-test', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, (args) => {
        const descriptor = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path }).descriptor;
        return { contents: compileScript(descriptor, { id: 'test', inlineTemplate: true }).content, loader: 'js' };
      });
    } }]
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports.default;
}

test('WorkspaceView shows archive rejection without success feedback or leaving Workspace', async () => {
  const originalWindow = global.window;
  const originalCalls = global.__testToastCalls;
  const calls = [];
  global.__testToastCalls = calls;
  global.window = { workbench: {
    workspaces: {
      list: async () => [{ id: 'A', name: '项目 A', archived: false, pendingTodoCount: 0, totalSeconds: 0 }],
      touch: async () => true,
      archive: async () => { throw new Error('当前工作空间还有正在进行的工作，请先结束工作后再归档'); }
    },
    workflows: { list: async () => [] },
    sessions: { last: async () => null, history: async () => [] },
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  let app;
  try {
    const host = createHost(createRenderer);
    app = host.renderer.createApp(await loadComponent('WorkspaceView.vue', { captureToast: true }));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '进入'));
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '归档'));
    await new Promise(setImmediate); await nextTick();
    assert.deepEqual(calls, [{ message: '当前工作空间还有正在进行的工作，请先结束工作后再归档', type: 'error' }]);
    assert.match(host.content(host.root), /WORKSPACE \/ 项目 A/);
    assert.ok(host.find('button', '归档'));
  } finally {
    app?.unmount(); global.window = originalWindow; global.__testToastCalls = originalCalls;
  }
});

test('WorkspaceView keeps the end action for an old archived Workspace with active Session', async () => {
  const originalWindow = global.window;
  const originalActive = global.__testActiveSession;
  global.__testActiveSession = { id: 's1', workspaceId: 'A', startedAt: new Date().toISOString(), endedAt: null };
  global.window = { workbench: {
    workspaces: {
      list: async () => [{ id: 'A', name: '旧归档项目', archived: true, pendingTodoCount: 0, totalSeconds: 0 }],
      touch: async () => true
    },
    workflows: { list: async () => [] },
    sessions: { last: async () => null, history: async () => [] },
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  let app;
  try {
    const host = createHost(createRenderer);
    app = host.renderer.createApp(await loadComponent('WorkspaceView.vue', { mockActiveSession: true }));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '查看'));
    await new Promise(setImmediate); await nextTick();
    assert.ok(host.find('button', '结束工作'));
    assert.equal(host.find('button', '开始工作'), undefined);
    host.click(host.find('button', '结束工作'));
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.body), /结束/);
  } finally {
    app?.unmount(); global.window = originalWindow; global.__testActiveSession = originalActive;
  }
});

test('WorkspaceResources filters current tab and opens and saves the same Note ID', async () => {
  const originalWindow = global.window;
  const originalDocument = global.Document;
  const originalShadowRoot = global.ShadowRoot;
  const notes = [{ id: 'n1', title: '图论笔记', content: '# 初稿', workspaceId: 'w1' }];
  const calls = [];
  global.Document = class {};
  global.ShadowRoot = class {};
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: {
      list: async () => notes.map((item) => ({ ...item })),
      update: async (id, patch) => { calls.push({ id, patch }); Object.assign(notes[0], patch); return { ...notes[0] }; }
    } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const Component = await loadComponent('WorkspaceResources.vue');
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(Component, { workspaceId: 'w1', workspaces: [] });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '便签'));
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /图论笔记/);
    host.click(host.find('button', '打开'));
    await nextTick();
    assert.match(host.content(host.body), /初稿/);
    host.click(host.find('button', '编辑'));
    await nextTick();
    host.input(host.visible().find((el) => el.props.placeholder === '便签标题'), '图论更新笔记');
    const textarea = host.find('textarea');
    host.input(textarea, '');
    await nextTick();
    host.click(host.find('button', '保存'));
    await new Promise(setImmediate); await nextTick();
    assert.deepEqual(calls, [{ id: 'n1', patch: { title: '图论更新笔记', content: '' } }]);
    assert.equal(notes[0].workspaceId, 'w1');
    assert.match(host.content(host.root), /图论更新笔记/);
    app.unmount();
  } finally {
    global.window = originalWindow; global.Document = originalDocument; global.ShadowRoot = originalShadowRoot;
  }
});

test('WorkspaceResources keeps edited Note input after a failed save', async () => {
  const originalWindow = global.window;
  const originalDocument = global.Document;
  const originalShadowRoot = global.ShadowRoot;
  global.Document = class {}; global.ShadowRoot = class {};
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: {
      list: async () => [{ id: 'n1', title: '便签', content: '原内容', workspaceId: 'w1' }],
      update: async () => { throw new Error('写入失败'); }
    } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await loadComponent('WorkspaceResources.vue'), { workspaceId: 'w1' });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '便签'));
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '打开'));
    await nextTick();
    host.click(host.find('button', '编辑'));
    await nextTick();
    host.input(host.find('textarea'), '未保存的新内容');
    await nextTick();
    host.click(host.find('button', '保存'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(host.find('textarea').value, '未保存的新内容');
    assert.match(host.content(host.body), /编辑便签/);
    app.unmount();
  } finally { global.window = originalWindow; global.Document = originalDocument; global.ShadowRoot = originalShadowRoot; }
});

test('WorkspaceResources drops late A and old tab responses after switching to B Notes', async () => {
  const originalWindow = global.window;
  let resolveOld;
  let favoritesCalls = 0;
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: () => {
      favoritesCalls++;
      if (favoritesCalls === 1) return new Promise((resolve) => { resolveOld = resolve; });
      return Promise.resolve([{ id: 'b-file', name: 'B 文件', path: 'B:/b', workspaceId: 'B' }]);
    } }, notes: { list: async () => [{ id: 'b-note', title: 'B 笔记', content: '', workspaceId: 'B' }] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, h, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const Component = await loadComponent('WorkspaceResources.vue');
    host.renderer.render(h(Component, { workspaceId: 'A' }), host.root);
    await nextTick();
    host.renderer.render(h(Component, { workspaceId: 'B' }), host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '便签'));
    await new Promise(setImmediate); await nextTick();
    resolveOld([{ id: 'a-file', name: 'A 文件', path: 'A:/a', workspaceId: 'A' }]);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /B 笔记/);
    assert.doesNotMatch(host.content(host.root), /A 文件|B 文件/);
    host.renderer.render(null, host.root);
  } finally { global.window = originalWindow; }
});

test('WorkspaceResources search filters the current tab and distinguishes no results from no resources', async () => {
  const originalWindow = global.window;
  const originalDocument = global.Document;
  const originalShadowRoot = global.ShadowRoot;
  global.Document = class {}; global.ShadowRoot = class {};
  let writes = 0;
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [
      { id: 'f1', name: 'Main.CPP', path: 'C:/竞赛/Graph/Main.CPP', workspaceId: 'w1' }
    ] }, notes: { list: async () => [{ id: 'n1', title: '中文笔记', content: '', workspaceId: 'w1' }] } },
    bookmarks: { list: async () => [{ id: 'b1', title: '参考', url: 'https://example.com/graph', workspaceId: 'w1' }] },
    apps: { list: async () => [] }, system: { pathExistsBatch: async () => ({}) },
    workspaces: { linkResource: async () => { writes++; } }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await loadComponent('WorkspaceResources.vue'), { workspaceId: 'w1' });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    const search = host.find('search');
    host.input(search, ' graph ');
    await nextTick();
    assert.match(host.content(host.root), /Main.CPP/);
    host.input(search, 'NOTHING');
    await nextTick();
    assert.match(host.content(host.root), /没有匹配的资源/);
    host.input(search, '');
    await nextTick();
    assert.match(host.content(host.root), /Main.CPP/);
    host.click(host.find('button', '便签'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(host.find('search').value, '');
    host.input(host.find('search'), '中文');
    await nextTick();
    assert.match(host.content(host.root), /中文笔记/);
    host.click(host.find('button', '收藏'));
    await new Promise(setImmediate); await nextTick();
    host.input(host.find('search'), 'EXAMPLE.COM');
    await nextTick();
    assert.match(host.content(host.root), /参考/);
    assert.equal(writes, 0);
    app.unmount();
  } finally { global.window = originalWindow; global.Document = originalDocument; global.ShadowRoot = originalShadowRoot; }
});

test('WorkspaceResources opens and edits Bookmark while keeping ownership and failed input', async () => {
  const originalWindow = global.window;
  const originalDocument = global.Document;
  const originalShadowRoot = global.ShadowRoot;
  global.Document = class {}; global.ShadowRoot = class {};
  const bookmarks = [{ id: 'b1', title: '原收藏', url: 'https://example.com', note: '', workspaceId: 'w1' }];
  const opened = [];
  let fail = true;
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: {
      list: async () => bookmarks.map((item) => ({ ...item })),
      update: async (id, patch) => {
        assert.equal(id, 'b1');
        if (fail) throw new Error('只支持 http 或 https 链接');
        Object.assign(bookmarks[0], patch);
        return { ...bookmarks[0] };
      }
    },
    apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}), openExternal: async (url) => { opened.push(url); return { ok: true }; } }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await loadComponent('WorkspaceResources.vue'), { workspaceId: 'w1' });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '收藏'));
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '打开'));
    await new Promise(setImmediate);
    assert.deepEqual(opened, ['https://example.com']);
    host.click(host.find('button', '编辑'));
    await nextTick();
    const urlInput = host.visible().find((el) => el.props.placeholder === 'https://');
    host.input(urlInput, 'javascript:alert(1)');
    await nextTick();
    host.click(host.find('button', '保存'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(urlInput.value, 'javascript:alert(1)');
    fail = false;
    host.input(urlInput, 'https://new.example');
    await nextTick();
    host.click(host.find('button', '保存'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(bookmarks[0].url, 'https://new.example');
    assert.equal(bookmarks[0].workspaceId, 'w1');
    assert.match(host.content(host.root), /https:\/\/new.example/);
    app.unmount();
  } finally { global.window = originalWindow; global.Document = originalDocument; global.ShadowRoot = originalShadowRoot; }
});

test('WorkspaceSessionHistory ignores an A response after changing to B', async () => {
  const originalWindow = global.window;
  let resolveA;
  global.window = { workbench: { sessions: {
    history: ({ workspaceId }) => workspaceId === 'A'
      ? new Promise((resolve) => { resolveA = resolve; })
      : Promise.resolve([{ id: 'b-session', startedAt: '2026-09-26T01:00:00Z', endedAt: '2026-09-26T02:00:00Z', durationSeconds: 3600, note: 'B 历史', completedTodoSnapshots: [{ id: 't', title: '历史原题' }], completedTodos: [{ id: 't', title: '后来改名' }] }])
  } } };
  const { createRenderer, h, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const Component = await loadComponent('WorkspaceSessionHistory.vue');
    host.renderer.render(h(Component, { workspaceId: 'A' }), host.root);
    await nextTick();
    host.renderer.render(h(Component, { workspaceId: 'B' }), host.root);
    await new Promise(setImmediate); await nextTick();
    resolveA([{ id: 'a-session', note: 'A 历史', startedAt: '2026-09-25T01:00:00Z', endedAt: '2026-09-25T02:00:00Z' }]);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /B 历史/);
    assert.match(host.content(host.root), /历史原题/);
    assert.doesNotMatch(host.content(host.root), /A 历史/);
    assert.doesNotMatch(host.content(host.root), /后来改名/);
    host.renderer.render(null, host.root);
  } finally { global.window = originalWindow; }
});

test('WorkspaceLinkModal ignores stale list after workspace and kind changes or unmount', async () => {
  const originalWindow = global.window;
  let resolveA;
  global.window = { workbench: {
    files: { notes: { list: () => new Promise((resolve) => { resolveA = resolve; }) } },
    bookmarks: { list: async () => [{ id: 'b1', title: 'B 收藏', url: 'https://example.com', workspaceId: null }] }
  } };
  const { createRenderer, h, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const Component = await loadComponent('WorkspaceLinkModal.vue');
    host.renderer.render(h(Component, { modelValue: true, kind: 'note', workspaceId: 'A', workspaces: [] }), host.root);
    await nextTick();
    host.renderer.render(h(Component, { modelValue: true, kind: 'bookmark', workspaceId: 'B', workspaces: [] }), host.root);
    await new Promise(setImmediate); await nextTick();
    resolveA([{ id: 'a1', title: 'A 便签', workspaceId: null }]);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.body), /B 收藏/);
    assert.doesNotMatch(host.content(host.body), /A 便签/);
    host.renderer.render(null, host.root);
    await nextTick();
  } finally { global.window = originalWindow; }
});

test('WorkspaceView does not put A last session into B Resume card', async () => {
  const originalWindow = global.window;
  let resolveA;
  const workspaces = [
    { id: 'A', name: '项目 A', pendingTodoCount: 0, totalSeconds: 0 },
    { id: 'B', name: '项目 B', pendingTodoCount: 0, totalSeconds: 0 }
  ];
  global.window = { workbench: {
    workspaces: { list: async () => workspaces, touch: async () => true },
    workflows: { list: async () => [] },
    sessions: {
      last: (id) => id === 'A'
        ? new Promise((resolve) => { resolveA = resolve; })
        : Promise.resolve({ id: 'B-last', workspaceId: 'B', startedAt: '2026-09-26T01:00:00Z', durationSeconds: 60, note: 'B 上次备注', completedTodos: [], remainingTodos: [] }),
      history: async () => []
    },
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  let app;
  try {
    const host = createHost(createRenderer);
    app = host.renderer.createApp(await loadComponent('WorkspaceView.vue'));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.visible().filter((el) => el.type === 'button' && host.content(el).includes('进入'))[0]);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '全部工作空间'));
    await new Promise(setImmediate); await nextTick();
    host.click(host.visible().filter((el) => el.type === 'button' && host.content(el).includes('进入'))[1]);
    await new Promise(setImmediate); await nextTick();
    resolveA({ id: 'A-last', workspaceId: 'A', startedAt: '2026-09-25T01:00:00Z', note: 'A 上次备注', completedTodos: [], remainingTodos: [] });
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /B 上次备注/);
    assert.doesNotMatch(host.content(host.root), /A 上次备注/);
    app.unmount();
  } finally { global.window = originalWindow; }
});

test('WorkspaceResources selects file and folder, shows missing path and keeps cancel read-only', async () => {
  const originalWindow = global.window;
  const favorites = [{ id: 'missing', name: '旧文件', path: 'C:/lost.txt', type: 'file', workspaceId: 'w1' }];
  const picked = [];
  let selectedFile = 'C:/new.txt';
  global.window = { workbench: {
    todos: { list: async () => [] }, goals: { list: async () => [] },
    files: { favorites: {
      list: async () => favorites.map((item) => ({ ...item })),
      add: async (filePath, workspaceId) => {
        picked.push({ filePath, workspaceId });
        favorites.push({ id: filePath, name: path.basename(filePath), path: filePath, type: filePath.endsWith('dir') ? 'folder' : 'file', workspaceId });
      }
    }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: {
      selectFile: async () => selectedFile,
      selectDirectory: async () => 'C:/project-dir',
      pathExistsBatch: async () => ({ 'C:/lost.txt': false })
    },
    workspaces: { linkResource: async ({ id, workspaceId }) => { favorites.find((item) => item.id === id).workspaceId = workspaceId; } }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await loadComponent('WorkspaceResources.vue'), { workspaceId: 'w1' });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /路径失效/);
    host.click(host.find('button', '选择文件'));
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '选择文件夹'));
    await new Promise(setImmediate); await nextTick();
    assert.deepEqual(picked, [
      { filePath: 'C:/new.txt', workspaceId: 'w1' },
      { filePath: 'C:/project-dir', workspaceId: 'w1' }
    ]);
    selectedFile = null;
    host.click(host.find('button', '选择文件'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(picked.length, 2);
    host.click(host.find('button', '解除关联'));
    await new Promise(setImmediate); await nextTick();
    assert.equal(favorites[0].workspaceId, null);
    assert.equal(favorites.length, 3);
    assert.doesNotMatch(host.content(host.root), /旧文件/);
    app.unmount();
  } finally { global.window = originalWindow; }
});

test('WorkspaceView refreshes overview and resource count after Todo create, complete and delete', async () => {
  const originalWindow = global.window;
  const originalDocument = global.Document;
  const originalShadowRoot = global.ShadowRoot;
  global.Document = class {}; global.ShadowRoot = class {};
  const todos = [];
  const workspace = { id: 'w1', name: '竞赛项目', totalSeconds: 0 };
  global.window = { workbench: {
    workspaces: {
      list: async () => [{ ...workspace, pendingTodoCount: todos.filter((todo) => !todo.completed).length }],
      touch: async () => true
    },
    workflows: { list: async () => [] },
    sessions: { last: async () => null, history: async () => [] },
    todos: {
      list: async () => todos.map((todo) => ({ ...todo })),
      create: async (data) => { todos.push({ ...data, id: 't1', completed: false }); return todos[0]; },
      update: async (id, patch) => { Object.assign(todos.find((todo) => todo.id === id), patch); return todos.find((todo) => todo.id === id); },
      remove: async (id) => { todos.splice(todos.findIndex((todo) => todo.id === id), 1); return [...todos]; }
    },
    goals: { list: async () => [] },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] },
    system: { pathExistsBatch: async () => ({}) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  let app;
  try {
    const host = createHost(createRenderer);
    app = host.renderer.createApp(await loadComponent('WorkspaceView.vue'));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    host.click(host.find('button', '进入'));
    await new Promise(setImmediate); await nextTick();
    const overview = () => host.visible().find((el) => String(el.props.class || '').includes('ws-overview__stats'));
    host.visible().find((el) => el.type === 'form' && String(el.props.class).includes('todo-module__composer')).props.onSubmit({ preventDefault() {} });
    await nextTick();
    host.input(host.visible().find((el) => el.props.placeholder === '要做什么？'), '完成模拟赛');
    await nextTick();
    host.click(host.find('button', '保存'));
    await new Promise(setImmediate); await new Promise(setImmediate); await nextTick();
    assert.match(host.content(overview()), /未完成任务1/);
    host.click(host.find('button', '待办'));
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /完成模拟赛/);
    host.click(host.visible().find((el) => String(el.props.class || '').includes('todo-module__check')));
    await new Promise(setImmediate); await new Promise(setImmediate); await nextTick();
    assert.match(host.content(overview()), /未完成任务0/);
    host.click(host.visible().find((el) => String(el.props.class || '').includes('todo-module__delete')));
    await new Promise(setImmediate); await new Promise(setImmediate); await nextTick();
    assert.equal(todos.length, 0);
  } finally { app?.unmount(); global.window = originalWindow; global.Document = originalDocument; global.ShadowRoot = originalShadowRoot; }
});
