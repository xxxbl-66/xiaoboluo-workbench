const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { DataStore } = require('../electron/store.cjs');
const { boot } = require('./helpers/electron-harness.cjs');

const resumeModule = import(pathToFileURL(path.join(__dirname, '../src/renderer/src/utils/workflow-resume.mjs')).href);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('延迟加载时继续工作等待真实列表，只建立一条 Session 并执行默认工作流一次', async () => {
  const { createWorkflowListLoader, resumeWorkspaceWorkflow } = await resumeModule;
  const pendingList = deferred();
  let fetches = 0;
  const loader = createWorkflowListLoader(() => { fetches++; return pendingList.promise; });
  const workspace = { id: 'A', workflowIds: ['wf'], resumeWorkflowId: 'wf' };
  let starts = 0;
  let runs = 0;
  const startSession = async () => ({ started: ++starts === 1, session: { id: 's' } });
  const runDetailed = async (id) => { assert.equal(id, 'wf'); runs++; return { ok: true, steps: [] }; };
  const first = resumeWorkspaceWorkflow({ workspace, loadWorkflows: () => loader.load(), startSession, runDetailed });
  const second = resumeWorkspaceWorkflow({ workspace, loadWorkflows: () => loader.load(), startSession, runDetailed });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loader.state, 'loading');
  assert.equal(fetches, 1);
  assert.equal(starts, 0, '列表未确认前不得创建一个无法恢复的 Session');
  pendingList.resolve([{ id: 'wf', name: '真实默认工作流' }]);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(loader.state, 'loaded');
  assert.equal(loader.items.length, 1);
  assert.equal(starts, 2, '两个请求可以到主进程，但只有一个应创建成功');
  assert.equal(runs, 1);
  assert.equal([a, b].filter((item) => item.started).length, 1);
  assert.doesNotMatch(a.notice + b.notice, /已失效/);
});

test('已加载空列表才报失效；无默认工作流无需加载也能开始', async () => {
  const { createWorkflowListLoader, resumeWorkspaceWorkflow } = await resumeModule;
  const loader = createWorkflowListLoader(async () => []);
  let starts = 0;
  const startSession = async () => ({ started: true, session: { id: `s-${++starts}` } });
  const missing = await resumeWorkspaceWorkflow({
    workspace: { id: 'A', workflowIds: ['gone'], resumeWorkflowId: 'gone' },
    loadWorkflows: () => loader.load(), startSession,
    runDetailed: async () => { throw new Error('不得运行'); }
  });
  assert.equal(loader.state, 'loaded');
  assert.deepEqual(loader.items, []);
  assert.match(missing.notice, /已失效/);
  const none = await resumeWorkspaceWorkflow({
    workspace: { id: 'B', workflowIds: [], resumeWorkflowId: null },
    loadWorkflows: async () => { throw new Error('无默认时不得读取列表'); }, startSession
  });
  assert.equal(starts, 2);
  assert.match(none.notice, /未设置默认工作流/);
});

test('列表读取失败不伪装成删除，且可重试；已有 active Session 不新建', async () => {
  const { createWorkflowListLoader, resumeWorkspaceWorkflow } = await resumeModule;
  let calls = 0;
  const loader = createWorkflowListLoader(async () => {
    if (++calls === 1) throw new Error('磁盘读取失败');
    return [{ id: 'wf', name: '恢复环境' }];
  });
  const workspace = { id: 'A', workflowIds: ['wf'], resumeWorkflowId: 'wf' };
  let starts = 0;
  const options = {
    workspace, loadWorkflows: () => loader.load(),
    startSession: async () => ({ started: ++starts === 1, session: { id: 's' } }),
    runDetailed: async () => ({ ok: true, steps: [] })
  };
  await assert.rejects(() => resumeWorkspaceWorkflow(options), /磁盘读取失败/);
  assert.equal(loader.state, 'error');
  assert.equal(starts, 0);
  const first = await resumeWorkspaceWorkflow(options);
  assert.equal(first.started, true);
  assert.equal(loader.state, 'loaded');
  const again = await resumeWorkspaceWorkflow(options);
  assert.equal(again.started, false);
  assert.equal(starts, 2);
});

test('切换 A 到 B 后，共用的延迟列表只按各自默认 ID 判断', async () => {
  const { createWorkflowListLoader, resumeWorkspaceWorkflow } = await resumeModule;
  const pendingList = deferred();
  const loader = createWorkflowListLoader(() => pendingList.promise);
  const runs = [];
  const startSession = async (id) => ({ started: true, session: { id: `session-${id}` } });
  const runDetailed = async (id) => { runs.push(id); return { ok: true, steps: [] }; };
  const a = resumeWorkspaceWorkflow({ workspace: { id: 'A', workflowIds: ['a'], resumeWorkflowId: 'a' }, loadWorkflows: () => loader.load(), startSession, runDetailed });
  const b = resumeWorkspaceWorkflow({ workspace: { id: 'B', workflowIds: ['b'], resumeWorkflowId: 'b' }, loadWorkflows: () => loader.load(), startSession, runDetailed });
  pendingList.resolve([{ id: 'a', name: 'A 流程' }, { id: 'b', name: 'B 流程' }]);
  const [resultA, resultB] = await Promise.all([a, b]);
  assert.deepEqual(runs, ['a', 'b']);
  assert.equal(resultA.feedback.name, 'A 流程');
  assert.equal(resultB.feedback.name, 'B 流程');
});

test('主进程 create 独立拒绝无效名称、步骤和协议，正常 HTTP(S) 可保存', async () => {
  const ctx = await boot('workflow-write-create-');
  try {
    const valid = (url) => ({ name: '  中文工作流  ', steps: [{ id: 'u', type: 'url', url }] });
    for (const name of ['', '   ', null, 123, '中'.repeat(81)]) {
      await assert.rejects(() => ctx.invoke('workflows:create', { ...valid('https://example.com'), name }), /工作流名称/);
    }
    const invalidSteps = [
      [[], /至少/], [null, /步骤.*数组/], [[null], /第 1 步/], [[undefined], /第 1 步/], [new Array(1), /第 1 步/], [[3], /第 1 步/],
      [[{ type: 'other' }], /第 1 步.*类型/], [[{ type: 'app' }], /第 1 步.*应用/],
      [[{ type: 'file' }], /第 1 步.*文件/], [[{ type: 'url' }], /第 1 步.*网址/],
      [[{ type: 'url', url: 'file:///x' }], /第 1 步.*http/],
      [[{ type: 'url', url: 'javascript:alert(1)' }], /第 1 步.*http/],
      [[{ type: 'url', url: 'data:text/plain,x' }], /第 1 步.*http/]
    ];
    for (const [steps, reason] of invalidSteps) {
      await assert.rejects(() => ctx.invoke('workflows:create', { name: '测试', steps }), reason);
    }
    assert.deepEqual(await ctx.invoke('workflows:list'), [], '拒绝的请求不得写盘');
    const http = await ctx.invoke('workflows:create', valid('http://example.com/'));
    const https = await ctx.invoke('workflows:create', valid('  HTTPS://example.com/x%20y  '));
    assert.equal(http.name, '中文工作流');
    assert.equal(https.steps[0].url, 'HTTPS://example.com/x%20y');
  } finally { ctx.teardown(); }
});

test('主进程 update 共用校验，拒绝非白名单字段并保护持久化身份', async () => {
  const ctx = await boot('workflow-write-update-');
  try {
    const created = await ctx.invoke('workflows:create', { name: '原名', steps: [{ id: 'f', type: 'file', path: 'C:\\虚构 资料\\中文.txt' }] });
    const before = await ctx.invoke('workflows:list');
    const invalid = [
      [{ name: ' ' }, /工作流名称/], [{ steps: [] }, /至少/],
      [{ steps: [{ type: 'url', url: 'file:///x' }] }, /第 1 步.*http/],
      [{ id: 'changed' }, /不允许修改/], [{ createdAt: '2000-01-01' }, /不允许修改/],
      [{ strange: true }, /不允许修改/], [{ sort: 99 }, /不允许修改/], [{ updatedAt: '2000-01-01' }, /不允许修改/]
    ];
    for (const [patch, reason] of invalid) {
      await assert.rejects(() => ctx.invoke('workflows:update', created.id, patch), reason);
      assert.deepEqual(await ctx.invoke('workflows:list'), before, '非法更新不得修改磁盘');
    }
    const renamed = await ctx.invoke('workflows:update', created.id, { name: '  新名字  ' });
    assert.equal(renamed.name, '新名字');
    assert.equal(renamed.id, created.id);
    assert.equal(renamed.createdAt, created.createdAt);
    const changed = await ctx.invoke('workflows:update', created.id, { steps: [{ id: 'u', type: 'url', url: 'https://example.com/' }] });
    assert.equal(changed.steps[0].type, 'url');
    assert.equal(changed.updatedAt >= created.updatedAt, true);
    assert.equal((await ctx.invoke('workflows:list'))[0].strange, undefined);
  } finally { ctx.teardown(); }
});

test('旧非法工作流保持可读可执行；未修正不能保存，修正后可保存', async () => {
  const ctx = await boot('workflow-write-legacy-');
  try {
    const store = new DataStore(ctx.dataDir);
    store.write('workflows.json', [{ id: 'legacy', name: '旧流程', steps: [
      { id: 'bad', type: 'url', url: 'file:///x' },
      { id: 'good', type: 'url', url: 'https://example.com/' }
    ], createdAt: '2020-01-01', sort: 1 }]);
    const list = await ctx.invoke('workflows:list');
    assert.equal(list[0].steps.length, 2);
    const result = await ctx.invoke('workflows:run-detailed', 'legacy');
    assert.deepEqual(result.steps.map((step) => step.ok), [false, true]);
    await assert.rejects(() => ctx.invoke('workflows:update', 'legacy', { name: '仅改名' }), /第 1 步.*http/);
    const fixed = await ctx.invoke('workflows:update', 'legacy', { steps: [
      { id: 'bad', type: 'url', url: 'http://example.com/' },
      { id: 'good', type: 'url', url: 'https://example.com/' }
    ] });
    assert.equal(fixed.name, '旧流程');
    assert.equal(fixed.steps.length, 2);
    assert.equal(fixed.createdAt, '2020-01-01');
  } finally { ctx.teardown(); }
});
