const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { boot } = require('./helpers/electron-harness.cjs');

const rendererFile = (name) => pathToFileURL(path.join(__dirname, '..', 'src/renderer/src', name)).href;

test('损坏的快照逐项过滤，有效标题保留，全部无效时回退旧 ID', async () => {
  const ctx = await boot('xb-stage4-snap-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '竞赛' });
    const todo = await ctx.invoke('todos:create', { title: '原任务', workspaceId: workspace.id });
    const started = await ctx.invoke('sessions:start', workspace.id);
    await ctx.invoke('sessions:end', started.session.id, { completedTodoIds: [todo.id] });
    const file = path.join(ctx.dataDir, 'data', 'work-sessions.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const snapshots of [
      [{ id: todo.id, title: '历史标题' }, null],
      [null, { id: todo.id, title: '历史标题' }],
      [false, 123, { id: todo.id, title: '历史标题' }, { id: {}, title: '坏项' }]
    ]) {
      rows[0].completedTodoSnapshots = snapshots;
      fs.writeFileSync(file, JSON.stringify(rows));
      const history = await ctx.invoke('sessions:history', { workspaceId: workspace.id });
      const last = await ctx.invoke('sessions:last', workspace.id);
      assert.deepEqual(history[0].completedTodos, [{ id: todo.id, title: '历史标题' }]);
      assert.deepEqual(last.completedTodos, history[0].completedTodos);
    }
    rows[0].completedTodoSnapshots = [null, 42, { id: null, title: '' }];
    fs.writeFileSync(file, JSON.stringify(rows));
    assert.equal((await ctx.invoke('sessions:history', { workspaceId: workspace.id }))[0].completedTodos[0].title, '原任务');
    assert.equal((await ctx.invoke('sessions:last', workspace.id)).completedTodos[0].title, '原任务');
  } finally { ctx.teardown(); }
});

test('已删除 Note 的空更新结果必须报错并保留调用方草稿', async () => {
  const { saveNoteRecord } = await import(rendererFile('components/note-record.js'));
  const draft = { title: '改后标题', content: '未保存的正文' };
  for (const response of [null, undefined]) {
    await assert.rejects(saveNoteRecord({ update: async () => response }, 'gone', draft), /已不存在.*尚未保存/);
    assert.deepEqual(draft, { title: '改后标题', content: '未保存的正文' });
  }
});

test('收藏文件移动到已有同路径的目标 Workspace 时拒绝且不改原数据', async () => {
  const ctx = await boot('xb-stage4-favorite-');
  try {
    const a = await ctx.invoke('workspaces:create', { name: 'A' });
    const b = await ctx.invoke('workspaces:create', { name: 'B' });
    const target = path.join(ctx.workRoot, 'project.txt');
    fs.writeFileSync(target, 'project');
    const first = (await ctx.invoke('files:favorites:add', target, a.id)).find((item) => item.workspaceId === a.id);
    await ctx.invoke('files:favorites:add', target, b.id);
    const before = await ctx.invoke('files:favorites:list');
    await assert.rejects(ctx.invoke('workspaces:link-resource', { kind: 'favorite', id: first.id, workspaceId: b.id }), /已收藏此路径/);
    assert.deepEqual(await ctx.invoke('files:favorites:list'), before);
  } finally { ctx.teardown(); }
});

test('恢复工作流执行期间不能结束 Session，完成后可以结束', async () => {
  const originalWindow = global.window;
  const originalSetInterval = global.setInterval;
  global.setInterval = () => 1;
  let ends = 0;
  global.window = { workbench: { sessions: {
    start: async (workspaceId) => ({ started: true, session: { id: 's4', workspaceId, startedAt: new Date().toISOString() } }),
    end: async () => { ends++; return { id: 's4', endedAt: new Date().toISOString() }; }
  } } };
  try {
    const { useWorkSession } = await import(rendererFile('composables/useWorkSession.js'));
    const session = useWorkSession();
    await session.startSession('w4');
    session.beginWorkflowOpening('s4');
    assert.equal(session.workflowOpening.value, true);
    await assert.rejects(session.endSession({}), /正在恢复工作环境/);
    assert.equal(ends, 0);
    session.finishWorkflowOpening('s4');
    await session.endSession({});
    assert.equal(ends, 1);
  } finally { global.window = originalWindow; global.setInterval = originalSetInterval; }
});

test('恢复流程在执行工作流前后成对切换繁忙状态', async () => {
  const { resumeWorkspaceWorkflow } = await import(rendererFile('utils/workflow-resume.mjs'));
  const events = [];
  const result = await resumeWorkspaceWorkflow({
    workspace: { id: 'w', resumeWorkflowId: 'wf', workflowIds: ['wf'] },
    workflows: [{ id: 'wf', name: '开发环境' }],
    startSession: async () => ({ started: true, session: { id: 's' } }),
    onBeforeWorkflow: (session) => events.push(`begin:${session.id}`),
    runDetailed: async () => { events.push('run'); return { ok: true }; },
    onAfterWorkflow: (session) => events.push(`finish:${session.id}`)
  });
  assert.equal(result.started, true);
  assert.deepEqual(events, ['begin:s', 'run', 'finish:s']);
});

test('Session 建立后刷新页面期间，结束操作也被工作流恢复锁定', async () => {
  const { resumeWorkspaceWorkflow } = await import(rendererFile('utils/workflow-resume.mjs'));
  const events = [];
  let releaseRefresh;
  const refresh = new Promise((resolve) => { releaseRefresh = resolve; });
  const running = resumeWorkspaceWorkflow({
    workspace: { id: 'w', resumeWorkflowId: 'wf', workflowIds: ['wf'] },
    workflows: [{ id: 'wf', name: '开发环境' }],
    startSession: async () => ({ started: true, session: { id: 's' } }),
    onStarted: async () => { events.push('refresh'); await refresh; },
    onBeforeWorkflow: () => events.push('begin'),
    runDetailed: async () => { events.push('run'); return { ok: true }; },
    onAfterWorkflow: () => events.push('finish')
  });
  await new Promise(setImmediate);
  assert.deepEqual(events, ['begin', 'refresh']);
  releaseRefresh();
  await running;
  assert.deepEqual(events, ['begin', 'refresh', 'run', 'finish']);
});

test('Workspace 主动作由归档、当前 Session 和历史记录唯一决定', async () => {
  const { workspacePrimaryAction } = await import(rendererFile('components/workspace-primary-action.js'));
  assert.equal(workspacePrimaryAction({ id: 'A' }, null, null).id, 'start');
  assert.equal(workspacePrimaryAction({ id: 'A' }, null, { id: 'last' }).id, 'resume');
  assert.equal(workspacePrimaryAction({ id: 'A' }, { workspaceId: 'A' }, { id: 'last' }).id, 'working');
  assert.equal(workspacePrimaryAction({ id: 'A' }, { workspaceId: 'B' }, { id: 'last' }).id, 'elsewhere');
  assert.equal(workspacePrimaryAction({ id: 'A', archived: true }, null, { id: 'last' }).id, 'restore');
});

test('收藏链接错误可在输入框旁准确提示', async () => {
  const { bookmarkUrlError } = await import(rendererFile('utils/bookmark-url.js'));
  assert.equal(bookmarkUrlError('https://example.com'), '');
  assert.equal(bookmarkUrlError(''), '');
  assert.match(bookmarkUrlError('javascript:alert(1)'), /http|https/);
  assert.match(bookmarkUrlError('not a url'), /http|https/);
});
