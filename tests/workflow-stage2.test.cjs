const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { DataStore } = require('../electron/store.cjs');
const { boot } = require('./helpers/electron-harness.cjs');

const formModule = import(pathToFileURL(path.join(__dirname, '../src/renderer/src/utils/workflow-form.mjs')).href);
const resumeModule = import(pathToFileURL(path.join(__dirname, '../src/renderer/src/utils/workflow-resume.mjs')).href);

test('工作流表单逐行指出空名称、缺失参数、非法网址，保留旧步骤', async () => {
  const { validateWorkflowForm } = await formModule;
  const result = validateWorkflowForm({ name: '  ', steps: [
    { id: 'a', type: 'app', appId: '' },
    { id: 'b', type: 'file', path: '' },
    { id: 'c', type: 'url', url: 'file:///tmp/x' },
    { id: 'd', type: 'legacy' }
  ] });
  assert.equal(result.valid, false);
  assert.match(result.nameError, /名称/);
  assert.match(result.stepErrors[0], /第 1 步.*应用/);
  assert.match(result.stepErrors[1], /第 2 步.*文件/);
  assert.match(result.stepErrors[2], /第 3 步.*http/);
  assert.match(result.stepErrors[3], /第 4 步.*类型/);
});

test('工作流表单接受中文、空格路径、http/https 并修剪名称', async () => {
  const { validateWorkflowForm } = await formModule;
  const result = validateWorkflowForm({ name: '  开始开发  ', steps: [
    { id: 'a', type: 'file', path: 'C:\\项目 空间\\中文.txt' },
    { id: 'b', type: 'url', url: 'https://example.com/a' },
    { id: 'c', type: 'url', url: 'http://example.com/' }
  ] });
  assert.equal(result.valid, true);
  assert.equal(result.payload.name, '开始开发');
  assert.equal(result.payload.steps.length, 3);
  assert.equal(result.payload.steps[0].path, 'C:\\项目 空间\\中文.txt');
});

test('空步骤、超长名称和缺少协议的网址不能保存', async () => {
  const { validateWorkflowForm } = await formModule;
  const empty = validateWorkflowForm({ name: '比赛', steps: [] });
  assert.equal(empty.valid, false);
  assert.match(empty.formError, /至少/);
  const long = validateWorkflowForm({ name: '中'.repeat(81), steps: [{ id: '1', type: 'url', url: 'example.com' }] });
  assert.match(long.nameError, /80/);
  assert.match(long.stepErrors[0], /http/);
});

test('文件和文件夹选择成功填写原路径，取消时保留原值', async () => {
  const { chooseWorkflowPath } = await formModule;
  const step = { path: 'C:\\原路径\\旧文件.txt' };
  await chooseWorkflowPath(step, async () => 'D:\\比赛 资料\\中文文件.txt', () => true);
  assert.equal(step.path, 'D:\\比赛 资料\\中文文件.txt');
  await chooseWorkflowPath(step, async () => null, () => true);
  assert.equal(step.path, 'D:\\比赛 资料\\中文文件.txt');
  await chooseWorkflowPath(step, async () => 'E:\\另一个文件夹', () => false);
  assert.equal(step.path, 'D:\\比赛 资料\\中文文件.txt');
});

test('恢复入口先建立 Session；无默认、失效默认和部分失败均保留开始状态', async () => {
  const { resumeWorkspaceWorkflow } = await resumeModule;
  const workspace = { id: 'ws', workflowIds: ['wf'], resumeWorkflowId: 'wf' };
  const calls = [];
  const startSession = async () => { calls.push('start'); return { started: true, session: { id: 'session' } }; };
  const onStarted = async () => { calls.push('started'); };
  const runDetailed = async () => { calls.push('run'); return { ok: false, successCount: 1, failedCount: 1, totalCount: 2, steps: [] }; };
  const result = await resumeWorkspaceWorkflow({ workspace, workflows: [{ id: 'wf', name: '恢复环境' }], startSession, onStarted, runDetailed });
  assert.deepEqual(calls, ['start', 'started', 'run']);
  assert.equal(result.started, true);
  assert.equal(result.feedback.result.failedCount, 1);
  const none = await resumeWorkspaceWorkflow({ workspace: { id: 'ws', workflowIds: [], resumeWorkflowId: null }, workflows: [], startSession, onStarted, runDetailed });
  assert.match(none.notice, /未设置默认工作流/);
  const missing = await resumeWorkspaceWorkflow({ workspace, workflows: [], startSession, onStarted, runDetailed });
  assert.match(missing.notice, /已失效/);
});

test('逐步骤结果保持顺序，失败后继续，且可 structured clone', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage2-workflow-'));
  const target = path.join(dir, '项目 空间');
  fs.mkdirSync(target);
  const calls = [];
  const shell = {
    openPath: async (value) => { calls.push(value); return value === target ? '' : '无法打开'; },
    openExternal: async (value) => { calls.push(value); }
  };
  const launcherPath = require.resolve('../electron/services/launcher.cjs');
  const originalLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') return { shell };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[launcherPath];
  let launcher;
  try { launcher = require(launcherPath); } finally { Module._load = originalLoad; }
  try {
    const store = new DataStore(dir);
    launcher.writeWorkflows(store, [{ id: 'w', name: '测试', steps: [
      { id: 's1', type: 'file', path: target },
      { id: 's2', type: 'file', path: path.join(dir, '不存在') },
      { id: 's3', type: 'url', url: 'https://example.com/' }
    ] }]);
    const result = await launcher.runWorkflow(store, 'w');
    assert.deepEqual(calls, [target, 'https://example.com/']);
    assert.equal(result.totalCount, 3);
    assert.equal(result.successCount, 2);
    assert.equal(result.failedCount, 1);
    assert.deepEqual(result.steps.map((item) => item.index), [0, 1, 2]);
    assert.deepEqual(result.steps.map((item) => item.ok), [true, false, true]);
    assert.match(result.steps[1].error, /不存在/);
    assert.doesNotThrow(() => structuredClone(result));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('详细 IPC 返回部分成功，旧 run 仍在步骤失败时 reject', async () => {
  const ctx = await boot('stage2-ipc-');
  try {
    const workflow = await ctx.invoke('workflows:create', { name: '恢复', steps: [
      { id: 'a', type: 'url', url: 'https://example.com/' },
      { id: 'b', type: 'app', appId: 'missing' }
    ] });
    const detailed = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.equal(detailed.successCount, 1);
    assert.equal(detailed.failedCount, 1);
    assert.doesNotThrow(() => structuredClone(detailed));
    await assert.rejects(() => ctx.invoke('workflows:run', workflow.id), /应用不存在/);
    await assert.rejects(() => ctx.invoke('workflows:run-detailed', 'missing'), /工作流不存在/);
  } finally { ctx.teardown(); }
});

test('旧数据中的未知步骤显示失败，后续步骤继续；空步骤明确拒绝', async () => {
  const ctx = await boot('stage2-legacy-');
  try {
    const workflow = await ctx.invoke('workflows:create', { name: '旧流程', steps: [
      { id: 'old', type: 'legacy' },
      { id: 'next', type: 'url', url: 'http://example.com/' }
    ] });
    const result = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.deepEqual(result.steps.map((step) => step.ok), [false, true]);
    assert.equal(result.steps[0].id, 'old');
    assert.equal(result.steps[1].id, 'next');
    const empty = await ctx.invoke('workflows:create', { name: '空旧流程', steps: [] });
    await assert.rejects(() => ctx.invoke('workflows:run-detailed', empty.id), /没有可执行步骤/);
  } finally { ctx.teardown(); }
});

test('全部失败时数量准确，非法网址与缺失应用逐步返回原因', async () => {
  const ctx = await boot('stage2-failure-');
  try {
    const workflow = await ctx.invoke('workflows:create', { name: '全部失败', steps: [
      { id: 'a', type: 'app', appId: 'missing' },
      { id: 'u', type: 'url', url: 'javascript:alert(1)' }
    ] });
    const result = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.equal(result.ok, false);
    assert.equal(result.successCount, 0);
    assert.equal(result.failedCount, 2);
    assert.match(result.steps[0].error, /应用不存在/);
    assert.match(result.steps[1].error, /http/);
  } finally { ctx.teardown(); }
});

test('应用、文件、网页全部成功时逐步结果和计数准确', async () => {
  const ctx = await boot('stage2-success-');
  try {
    const appPath = path.join(ctx.workRoot, '虚构工具.exe');
    const filePath = path.join(ctx.workRoot, '项目 文件夹');
    fs.writeFileSync(appPath, 'test only');
    fs.mkdirSync(filePath);
    const app = await ctx.invoke('apps:add', appPath, { name: '虚构工具' });
    const workflow = await ctx.invoke('workflows:create', { name: '全部成功', steps: [
      { id: 'a', type: 'app', appId: app.id },
      { id: 'f', type: 'file', path: filePath },
      { id: 'u', type: 'url', url: 'https://example.com/' }
    ] });
    const result = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.equal(result.ok, true);
    assert.equal(result.totalCount, 3);
    assert.equal(result.successCount, 3);
    assert.equal(result.failedCount, 0);
    assert.deepEqual(result.steps.map((item) => item.type), ['app', 'file', 'url']);
    assert.equal(result.steps[0].label, '虚构工具');
    assert.doesNotThrow(() => structuredClone(result));
  } finally { ctx.teardown(); }
});

test('应用原路径被删除后，该步骤明确失败', async () => {
  const ctx = await boot('stage2-app-path-');
  try {
    const appPath = path.join(ctx.workRoot, '已删除工具.exe');
    fs.writeFileSync(appPath, 'test only');
    const app = await ctx.invoke('apps:add', appPath, { name: '已删除工具' });
    fs.unlinkSync(appPath);
    const workflow = await ctx.invoke('workflows:create', { name: '路径失效', steps: [{ id: 'app', type: 'app', appId: app.id }] });
    const result = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.equal(result.failedCount, 1);
    assert.match(result.steps[0].error, /不存在/);
  } finally { ctx.teardown(); }
});

test('文件与文件夹选择 IPC 保留中文空格路径并在取消时返回 null', async () => {
  const ctx = await boot('stage2-picker-');
  try {
    const choices = ['C:\\竞赛 项目\\中文.txt', 'D:\\开发 文件夹'];
    const properties = [];
    ctx.electronMock.dialog.showOpenDialog = async (_window, options) => {
      properties.push(options.properties[0]);
      return { canceled: false, filePaths: [choices[properties.length - 1]] };
    };
    assert.equal(await ctx.invoke('system:select-file'), choices[0]);
    assert.equal(await ctx.invoke('system:select-directory'), choices[1]);
    assert.deepEqual(properties, ['openFile', 'openDirectory']);
    ctx.electronMock.dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.equal(await ctx.invoke('system:select-file'), null);
  } finally { ctx.teardown(); }
});

test('系统拒绝网页打开或抛错时返回逐步失败，Session 仍 active', async () => {
  const ctx = await boot('stage2-resume-');
  try {
    const workspace = await ctx.invoke('workspaces:create', { name: '虚构竞赛' });
    const workflow = await ctx.invoke('workflows:create', { name: '恢复环境', steps: [
      { id: 'u1', type: 'url', url: 'https://example.com/' },
      { id: 'u2', type: 'url', url: 'http://example.org/' }
    ] });
    await ctx.invoke('workspaces:update', workspace.id, { workflowIds: [workflow.id], resumeWorkflowId: workflow.id });
    const started = await ctx.invoke('sessions:start', workspace.id);
    let calls = 0;
    ctx.electronMock.shell.openExternal = async () => {
      calls++;
      if (calls === 1) return { ok: false, error: '系统拒绝打开' };
      throw new Error('浏览器不可用');
    };
    const result = await ctx.invoke('workflows:run-detailed', workflow.id);
    assert.equal(result.failedCount, 2);
    assert.match(result.steps[0].error, /系统拒绝/);
    assert.match(result.steps[1].error, /浏览器不可用/);
    assert.equal((await ctx.invoke('sessions:get-active')).id, started.session.id);
    assert.equal((await ctx.invoke('sessions:start', workspace.id)).started, false);
  } finally { ctx.teardown(); }
});

test('preload 的 runDetailed 传递业务失败结果，系统级 IPC 错误仍 reject', async () => {
  const preloadPath = require.resolve('../electron/preload.cjs');
  let exposed;
  let reply = { ok: true, data: { ok: false, failedCount: 1, steps: [{ index: 0, ok: false, error: '路径不存在' }] } };
  const channels = [];
  const originalLoad = Module._load;
  Module._load = function patched(request) {
    if (request === 'electron') return {
      contextBridge: { exposeInMainWorld: (_name, api) => { exposed = api; } },
      ipcRenderer: { invoke: async (channel) => { channels.push(channel); return reply; } }
    };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[preloadPath];
  try { require(preloadPath); } finally { Module._load = originalLoad; }
  const result = await exposed.workflows.runDetailed('wf');
  assert.equal(result.failedCount, 1);
  assert.deepEqual(channels, ['workflows:run-detailed']);
  reply = { ok: false, error: '工作流不存在' };
  await assert.rejects(() => exposed.workflows.runDetailed('missing'), /工作流不存在/);
});

test('同一工作流执行期间，主进程拒绝第二次启动', async () => {
  const ctx = await boot('stage2-duplicate-');
  try {
    let finish;
    ctx.electronMock.shell.openExternal = () => new Promise((resolve) => { finish = resolve; });
    const workflow = await ctx.invoke('workflows:create', { name: '慢流程', steps: [{ id: 'u', type: 'url', url: 'https://example.com/' }] });
    const first = ctx.invoke('workflows:run-detailed', workflow.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await assert.rejects(() => ctx.invoke('workflows:run-detailed', workflow.id), /正在运行/);
    finish();
    assert.equal((await first).successCount, 1);
  } finally { ctx.teardown(); }
});
