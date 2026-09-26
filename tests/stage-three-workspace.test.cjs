const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./helpers/electron-harness.cjs');
const { DataStore } = require('../electron/store.cjs');
const { exportBackup, importBackup } = require('../electron/services/backup.cjs');

function table(ctx, name) {
  return JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'data', name), 'utf8'));
}

test('Session completion snapshots preserve real titles across rename, deletion and move', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: '程序设计竞赛' });
    const b = await ctx.invoke('workspaces:create', { name: '其他项目' });
    const todo = await ctx.invoke('todos:create', { title: '完成图论题', workspaceId: a.id });
    const started = await ctx.invoke('sessions:start', a.id);
    const ended = await ctx.invoke('sessions:end', started.session.id, {
      completedTodoIds: [todo.id],
      completedTodoSnapshots: [{ id: todo.id, title: '伪造标题' }]
    });
    assert.deepEqual(ended.completedTodoSnapshots, [{ id: todo.id, title: '完成图论题' }]);
    assert.deepEqual(table(ctx, 'work-sessions.json')[0].completedTodoSnapshots, ended.completedTodoSnapshots);

    await ctx.invoke('todos:update', todo.id, { title: '改名后任务', workspaceId: b.id });
    const moved = await ctx.invoke('sessions:last', a.id);
    assert.equal(moved.completedTodos[0].title, '完成图论题');
    assert.equal(moved.remainingTodos.length, 0);
    await ctx.invoke('todos:delete', todo.id);
    const deleted = await ctx.invoke('sessions:history', { workspaceId: a.id });
    assert.equal(deleted[0].completedTodos[0].title, '完成图论题');

    await ctx.invoke('sessions:adjust-duration', ended.id, 60, { reason: '校正' });
    assert.deepEqual(table(ctx, 'work-sessions.json')[0].completedTodoSnapshots, ended.completedTodoSnapshots);
  } finally { ctx.teardown(); }
});

test('Session completion rejects foreign Todo and legacy history still resolves current Todo', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const b = await ctx.invoke('workspaces:create', { name: 'B' });
    const foreign = await ctx.invoke('todos:create', { title: '其他任务', workspaceId: b.id });
    const own = await ctx.invoke('todos:create', { title: '旧任务', workspaceId: a.id });
    const started = await ctx.invoke('sessions:start', a.id);
    await assert.rejects(ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [foreign.id] }), /不属于/);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [own.id] });
    const rows = table(ctx, 'work-sessions.json');
    delete rows[0].completedTodoSnapshots;
    fs.writeFileSync(path.join(ctx.dataDir, 'data', 'work-sessions.json'), JSON.stringify(rows));
    assert.equal((await ctx.invoke('sessions:history', { workspaceId: a.id }))[0].completedTodos[0].title, '旧任务');
    await ctx.invoke('todos:delete', own.id);
    assert.match((await ctx.invoke('sessions:history', { workspaceId: a.id }))[0].completedTodos[0].title, /已删除/);
  } finally { ctx.teardown(); }
});

test('Session update rebuilds all snapshot titles from real Todos when completed IDs change', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '竞赛' });
    const first = await ctx.invoke('todos:create', { title: '结束时标题', workspaceId: workspace.id });
    const second = await ctx.invoke('todos:create', { title: '新增任务', workspaceId: workspace.id });
    const started = await ctx.invoke('sessions:start', workspace.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [first.id] });
    await ctx.invoke('todos:update', first.id, { title: '后来改名' });
    const edited = await ctx.invoke('sessions:update', started.session.id, {
      completedTodoIds: [first.id, second.id],
      completedTodoSnapshots: [{ id: second.id, title: '伪造新增' }]
    });
    assert.deepEqual(edited.completedTodoSnapshots, [
      { id: first.id, title: '后来改名' }, { id: second.id, title: '新增任务' }
    ]);
  } finally { ctx.teardown(); }
});

test('Bookmark create and edit use the same safe URL rule as opening links', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '项目' });
    const bookmark = await ctx.invoke('bookmarks:create', { title: '文档', url: 'https://example.com', workspaceId: workspace.id });
    assert.equal((await ctx.invoke('bookmarks:update', bookmark.id, { title: '新文档', url: 'https://example.org' })).workspaceId, workspace.id);
    for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/html,test']) {
      await assert.rejects(ctx.invoke('bookmarks:update', bookmark.id, { url }), /http|https/);
    }
    assert.equal((await ctx.invoke('bookmarks:list'))[0].url, 'https://example.org');
  } finally { ctx.teardown(); }
});

test('Workspace resource filter handles Chinese, case, paths, URL and empty query without mutation', async () => {
  const { filterWorkspaceResourceRows } = await import(pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/components/workspace-resource-filter.js')).href);
  const rows = [
    { id: 'n', title: '图论笔记', meta: '' },
    { id: 'f', title: 'Main.CPP', meta: 'C:\\Contest\\Graph\\Main.CPP' },
    { id: 'b', title: '参考', meta: 'https://example.com/Graph' }
  ];
  assert.deepEqual(filterWorkspaceResourceRows(rows, ' 图论 ').map((r) => r.id), ['n']);
  assert.deepEqual(filterWorkspaceResourceRows(rows, 'MAIN.cpp').map((r) => r.id), ['f']);
  assert.deepEqual(filterWorkspaceResourceRows(rows, 'contest\\graph').map((r) => r.id), ['f']);
  assert.deepEqual(filterWorkspaceResourceRows(rows, 'EXAMPLE.COM').map((r) => r.id), ['b']);
  assert.deepEqual(filterWorkspaceResourceRows(rows, '   '), rows);
  assert.deepEqual(filterWorkspaceResourceRows(rows, 'nothing'), []);
  assert.deepEqual(filterWorkspaceResourceRows([{ title: '便签标题', meta: '正文关键词', searchText: '便签标题' }], '正文关键词'), []);
  assert.equal(rows.length, 3);
});

test('Shared Note save keeps empty content and does not replace workspace ownership', async () => {
  const { saveNoteRecord } = await import(pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/components/note-record.js')).href);
  const calls = [];
  const notesApi = { update: async (id, patch) => { calls.push({ id, patch }); return { id, ...patch, workspaceId: 'w1' }; } };
  const saved = await saveNoteRecord(notesApi, 'n1', { title: '更新', content: '', workspaceId: 'other' });
  assert.deepEqual(calls, [{ id: 'n1', patch: { title: '更新', content: '' } }]);
  assert.equal(saved.workspaceId, 'w1');
  await assert.rejects(saveNoteRecord({ update: async () => { throw new Error('写入失败'); } }, 'n1', { title: '草稿', content: '' }), /写入失败/);
});

test('Archived workspace keeps history but cannot start a new session until restored', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '归档项目' });
    const start = await ctx.invoke('sessions:start', workspace.id);
    await ctx.invoke('sessions:end', start.session.id, { completedTodoIds: [] });
    await ctx.invoke('workspaces:archive', workspace.id, true);
    assert.equal((await ctx.invoke('sessions:history', { workspaceId: workspace.id })).length, 1);
    await assert.rejects(ctx.invoke('sessions:start', workspace.id), /归档/);
    await ctx.invoke('workspaces:archive', workspace.id, false);
    assert.equal((await ctx.invoke('sessions:start', workspace.id)).started, true);
  } finally { ctx.teardown(); }
});

test('Workspace workflow summary tolerates null, primitive and unknown steps', async () => {
  const { workflowStepSummary } = await import(pathToFileURL(path.join(__dirname, '..', 'src/renderer/src/components/workspace-workflow-summary.js')).href);
  assert.match(workflowStepSummary({ steps: [null] }), /无效步骤/);
  assert.match(workflowStepSummary({ steps: [123] }), /无效步骤/);
  assert.match(workflowStepSummary({ steps: [{ type: 'legacy' }] }), /legacy/);
});

test('WorkspaceWorkflows renders malformed legacy steps without changing stored data', async () => {
  const { createServer } = await import('vite');
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const originalWindow = global.window;
  global.window = { workbench: {} };
  const server = await createServer({ configFile: 'vite.config.mjs', server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: Component } = await server.ssrLoadModule('/src/components/WorkspaceWorkflows.vue');
    const workflows = [{ id: 'wf', name: '旧工作流', steps: [null, 123, { type: 'legacy' }] }];
    const before = JSON.stringify(workflows);
    const html = await renderToString(createSSRApp(Component, {
      workspace: { id: 'w', workflowIds: ['wf'], resumeWorkflowId: null }, workflows
    }));
    assert.match(html, /无效步骤×2/);
    assert.match(html, /legacy×1/);
    assert.equal(JSON.stringify(workflows), before);
  } finally { await server.close(); global.window = originalWindow; }
});

test('ResumeWorkCard prefers historical snapshot titles while showing live remaining Todos', async () => {
  const { createServer } = await import('vite');
  const { createSSRApp } = await import('vue');
  const { renderToString } = await import('@vue/server-renderer');
  const server = await createServer({ configFile: 'vite.config.mjs', server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { default: Component } = await server.ssrLoadModule('/src/components/ResumeWorkCard.vue');
    const html = await renderToString(createSSRApp(Component, { session: {
      startedAt: '2026-09-26T01:00:00Z', durationSeconds: 120,
      completedTodoSnapshots: [{ id: 't1', title: '历史标题' }],
      completedTodos: [{ id: 't1', title: '后来改名' }],
      remainingTodos: [{ id: 't2', title: '当前任务' }]
    } }));
    assert.match(html, /历史标题/);
    assert.match(html, /当前任务/);
    assert.doesNotMatch(html, /后来改名/);
  } finally { await server.close(); }
});

test('Workspace note and bookmark edits preserve ID and ownership; unlink keeps source records', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '竞赛' });
    const note = await ctx.invoke('files:notes:create', { title: '初稿', content: '# 标题', workspaceId: workspace.id });
    const bookmark = await ctx.invoke('bookmarks:create', { title: '资料', url: 'https://example.com', workspaceId: workspace.id });
    const changedNote = await ctx.invoke('files:notes:update', note.id, { title: '更新', content: '' });
    assert.equal(changedNote.id, note.id);
    assert.equal(changedNote.content, '');
    assert.equal(changedNote.workspaceId, workspace.id);
    const changedBookmark = await ctx.invoke('bookmarks:update', bookmark.id, { title: '新资料', url: 'https://example.org' });
    assert.equal(changedBookmark.workspaceId, workspace.id);
    await ctx.invoke('workspaces:link-resource', { kind: 'note', id: note.id, workspaceId: null });
    await ctx.invoke('workspaces:link-resource', { kind: 'bookmark', id: bookmark.id, workspaceId: null });
    assert.equal((await ctx.invoke('files:notes:list')).find((item) => item.id === note.id).content, '');
    assert.equal((await ctx.invoke('bookmarks:list')).find((item) => item.id === bookmark.id).url, 'https://example.org');
    assert.equal((await ctx.invoke('files:notes:list')).find((item) => item.id === note.id).workspaceId, null);
  } finally { ctx.teardown(); }
});

test('Workspace file and folder selectors, cancellation, path failure and unlink preserve disk content', async () => {
  const ctx = await boot('xb-stage3-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '竞赛' });
    const filePath = path.join(ctx.workRoot, 'main.cpp');
    const folderPath = path.join(ctx.workRoot, 'project');
    fs.writeFileSync(filePath, 'int main() {}');
    fs.mkdirSync(folderPath);
    ctx.electronMock.dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: [options.properties.includes('openDirectory') ? folderPath : filePath] });
    const selectedFile = await ctx.invoke('system:select-file');
    const selectedFolder = await ctx.invoke('system:select-directory');
    assert.equal(selectedFile, filePath);
    assert.equal(selectedFolder, folderPath);
    await ctx.invoke('files:favorites:add', selectedFile, workspace.id);
    await ctx.invoke('files:favorites:add', selectedFolder, workspace.id);
    assert.deepEqual((await ctx.invoke('files:favorites:list')).map((item) => item.type).sort(), ['file', 'folder']);
    ctx.electronMock.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.equal(await ctx.invoke('system:select-directory'), null);
    assert.equal((await ctx.invoke('files:favorites:list')).length, 2);
    fs.rmSync(filePath);
    assert.equal((await ctx.invoke('system:path-exists', filePath)), false);
    const folder = (await ctx.invoke('files:favorites:list')).find((item) => item.type === 'folder');
    await ctx.invoke('workspaces:link-resource', { kind: 'favorite', id: folder.id, workspaceId: null });
    assert.equal(fs.existsSync(folderPath), true);
    assert.equal((await ctx.invoke('files:favorites:list')).find((item) => item.id === folder.id).workspaceId, null);
  } finally { ctx.teardown(); }
});

test('Backup export and import retain completed Todo snapshots without schema migration', async () => {
  const ctx = await boot('xb-stage3-');
  const target = fs.mkdtempSync(path.join(ctx.workRoot, 'import-'));
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '竞赛' });
    const todo = await ctx.invoke('todos:create', { title: '做题', workspaceId: workspace.id });
    const started = await ctx.invoke('sessions:start', workspace.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [todo.id] });
    const source = new DataStore(ctx.dataDir);
    const exported = exportBackup(source);
    const payload = JSON.parse(fs.readFileSync(exported.filePath, 'utf8'));
    assert.equal(payload.data['work-sessions.json'][0].completedTodoSnapshots[0].title, '做题');
    const destination = new DataStore(target);
    assert.equal(importBackup(destination, exported.filePath).ok, true);
    assert.deepEqual(destination.read('work-sessions.json', [])[0].completedTodoSnapshots, [{ id: todo.id, title: '做题' }]);
  } finally { ctx.teardown(); }
});
