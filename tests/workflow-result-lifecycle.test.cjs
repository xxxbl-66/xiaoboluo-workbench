const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vue = require('vue');
const { createHost } = require('./helpers/vue-host.cjs');

let bundle;
async function loadApp() {
  if (!bundle) bundle = require('esbuild').build({
    stdin: { contents: `export { default as App } from './src/renderer/src/App.vue';
      export { useWorkspace } from './src/renderer/src/composables/useWorkspace.js';
      export { useWorkSession } from './src/renderer/src/composables/useWorkSession.js';
      export { useRecentWorkflowResult } from './src/renderer/src/composables/useRecentWorkflowResult.js';`,
      resolveDir: path.join(__dirname, '..'), sourcefile: 'lifecycle-host.js' },
    bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
    plugins: [{ name: 'vue', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
        const { parse, compileScript } = require('@vue/compiler-sfc');
        const descriptor = parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
        return { contents: compileScript(descriptor, { id: filename, inlineTemplate: true }).content, loader: 'js' };
      });
      // Feedback under test is the actual Result component; suppress unrelated Toast timers.
      build.onLoad({ filter: /[\\/]composables[\\/]toast\.js$/ }, () => ({
        contents: "import { reactive } from 'vue'; export const toastState = reactive({items:[]}); export function toast() {}", loader: 'js'
      }));
    } }]
  });
  const result = await bundle;
  const loaded = new Module(__filename, module);
  loaded.filename = __filename; loaded.paths = module.paths;
  loaded._compile(result.outputFiles[0].text, __filename);
  return loaded.exports;
}

function result(label, successCount = 1, failedCount = 0) {
  return { ok: failedCount === 0, workflowName: label, totalCount: successCount + failedCount,
    successCount, failedCount, steps: Array.from({ length: successCount + failedCount }, (_, index) => ({
      index, type: 'file', label: `${label} ${index + 1}`, ok: index < successCount,
      error: index < successCount ? null : `${label}失败`
    })) };
}

async function fixture() {
  const originals = { window: global.window, document: global.document, setInterval: global.setInterval };
  const spaces = [
    { id: 'A', name: '项目 A', workflowIds: ['resume', 'manual'], resumeWorkflowId: 'resume', archived: false },
    { id: 'B', name: '项目 B', workflowIds: [], archived: false }
  ];
  let active = null, sessionCount = 0, recentId = 'A';
  const calls = [];
  const api = {
    settings: { get: async () => ({ theme: 'light', dashboardWidgets: [] }) },
    checkins: { get: async () => ({ todayChecked: false, streak: 0, total: 0 }) },
    workspaces: { list: async () => spaces, touch: async () => {}, recent: async () => [spaces.find(x => x.id === recentId)] },
    workflows: { list: async () => [
      { id: 'resume', name: '恢复环境', steps: [{ type: 'file', path: 'resume.txt' }] },
      { id: 'manual', name: '手动环境', steps: [{ type: 'file', path: 'manual.txt' }] }
    ], runDetailed: async (id) => { calls.push(id); return run(id); } },
    sessions: { getActive: async () => active, onCloseRequest: () => () => {},
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1, nextStep: '继续检查', completedTodos: [], remainingTodos: [] }),
      history: async () => [],
      start: async workspaceId => {
        if (active) return { started: false, session: active };
        active = { id: `session-${++sessionCount}`, workspaceId, startedAt: new Date().toISOString(), endedAt: null };
        return { started: true, session: active };
      }, end: async () => { const ended = { ...active, endedAt: new Date().toISOString() }; active = null; return ended; } },
    todos: { list: async () => [] }, goals: { list: async () => [] }, review: { get: async () => ({}) },
    files: { favorites: { list: async () => [] }, notes: { list: async () => [] } },
    bookmarks: { list: async () => [] }, apps: { list: async () => [] }, system: { pathExistsBatch: async () => ({}) }
  };
  let run = async id => result(id === 'resume' ? '恢复成功' : '手动失败', id === 'resume' ? 1 : 0, id === 'resume' ? 0 : 1);
  global.window = { workbench: api };
  global.document = { documentElement: { dataset: {} }, activeElement: null };
  global.setInterval = () => 1;
  const modules = await loadApp();
  const host = createHost(vue.createRenderer);
  const app = host.renderer.createApp(modules.App); app.mount(host.root);
  const flush = async () => { await new Promise(setImmediate); await vue.nextTick(); await new Promise(setImmediate); await vue.nextTick(); };
  await flush();
  const all = () => host.visible();
  const text = () => host.content(host.root);
  const buttons = label => all().filter(el => el.type === 'button' && host.content(el).trim() === label);
  const click = async label => { const el = buttons(label)[0]; assert.ok(el, `missing button: ${label}`); host.click(el); await flush(); };
  const nav = async label => { const el = all().find(el => el.type === 'button' && String(el.props.class).includes('nav-item') && host.content(el).startsWith(label)); assert.ok(el); host.click(el); await flush(); };
  const panels = () => all().filter(el => el.type === 'section' && String(el.props.class).includes('run-result'));
  const openA = async () => { await nav('工作空间'); if (!text().includes('WORKSPACE / 项目 A')) await click('进入'); };
  const manual = async () => { const section = all().find(el => el.type === 'section' && el.props.class === 'ws-workflows'); const runButtons = section.children.flatMap(function walk(el) { return [el, ...el.children.flatMap(walk)]; }).filter(el => el.type === 'button' && host.content(el).trim() === '运行'); host.click(runButtons[1]); await flush(); };
  const close = async () => { const el = all().find(el => el.props['aria-label'] === '关闭执行结果'); assert.ok(el); host.click(el); await flush(); };
  return { api, modules, calls, text, buttons, panels, click, nav, openA, manual, close, flush,
    setRun: fn => { run = fn; }, setRecent: id => { recentId = id; },
    cleanup() { app.unmount(); Object.assign(global, originals); } };
}

test('集成：Resume success 关闭重开保留原结果且不重新执行', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.click('继续上次工作'); await f.click('查看步骤');
    const store = f.modules.useRecentWorkflowResult();
    const before = store.recentResult.value;
    assert.match(f.text(), /恢复成功/); await f.close();
    assert.equal(store.visible.value, false); assert.strictEqual(store.recentResult.value, before);
    assert.equal(f.panels().length, 0); await f.click('查看上次运行结果'); await f.click('查看步骤');
    assert.strictEqual(store.recentResult.value, before); assert.equal(store.visible.value, true);
    assert.match(f.text(), /恢复成功 1/);
    assert.deepEqual(f.calls, ['resume']);
  } finally { f.cleanup(); }
});

test('集成：Resume success → Manual failure 只有一个最新失败结果', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.click('继续上次工作'); await f.close(); await f.manual();
    assert.equal(f.panels().length, 1);
    assert.match(f.text(), /手动失败/); assert.doesNotMatch(f.text(), /查看上次运行结果/);
    await f.close(); assert.equal(f.buttons('查看上次运行结果').length, 1);
    await f.click('查看上次运行结果'); assert.match(f.text(), /全部失败/); assert.doesNotMatch(f.text(), /全部成功/);
  } finally { f.cleanup(); }
});

test('集成：关闭结果 → App Dashboard → 同一 Workspace 可以重开', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.manual(); await f.close(); await f.nav('今天');
    assert.match(f.text(), /DASHBOARD/); await f.click('先查看项目');
    assert.equal(f.buttons('查看上次运行结果').length, 1); await f.click('查看上次运行结果');
    assert.match(f.text(), /手动失败/); assert.deepEqual(f.calls, ['manual']);
  } finally { f.cleanup(); }
});

test('集成：Manual success → Resume partial failure 覆盖并保持单面板', async () => {
  const f = await fixture(); try {
    f.setRun(async id => id === 'manual' ? result('旧手动成功') : result('新恢复部分失败', 1, 1));
    await f.openA(); await f.manual(); await f.close(); await f.click('继续上次工作');
    assert.equal(f.panels().length, 1); assert.match(f.text(), /部分成功/);
    assert.equal(f.buttons('查看上次运行结果').length, 0);
    await f.close(); await f.click('查看上次运行结果'); assert.match(f.text(), /新恢复部分失败/);
  } finally { f.cleanup(); }
});

test('集成：A → Dashboard → B 清空，B → A 不复活', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.manual(); await f.close(); f.setRecent('B'); await f.nav('今天');
    await f.click('先查看项目'); assert.match(f.text(), /WORKSPACE \/ 项目 B/);
    assert.equal(f.buttons('查看上次运行结果').length, 0); assert.equal(f.panels().length, 0);
    await f.click('← 全部工作空间'); await f.click('进入');
    assert.match(f.text(), /WORKSPACE \/ 项目 A/); assert.equal(f.buttons('查看上次运行结果').length, 0);
  } finally { f.cleanup(); }
});

test('集成：A → B → A 清空旧结果', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.manual(); await f.close(); await f.click('← 全部工作空间');
    const entries = f.buttons('进入'); assert.equal(entries.length, 2);
    entries[1].props.onClick(); await f.flush(); assert.match(f.text(), /WORKSPACE \/ 项目 B/);
    await f.click('← 全部工作空间'); await f.click('进入');
    assert.equal(f.buttons('查看上次运行结果').length, 0); assert.equal(f.panels().length, 0);
  } finally { f.cleanup(); }
});

test('集成：第二次 Manual run 覆盖第一次', async () => {
  const f = await fixture(); try {
    let count = 0; f.setRun(async () => result(`第${++count}次`, 0, 1));
    await f.openA(); await f.manual(); await f.close(); await f.manual();
    assert.match(f.text(), /第2次/); assert.doesNotMatch(f.text(), /第1次/);
    await f.close(); await f.click('查看上次运行结果'); assert.match(f.text(), /第2次/);
  } finally { f.cleanup(); }
});

test('集成：新运行 IPC reject 保留明确错误，旧成功不再是最近结果', async () => {
  const f = await fixture(); try {
    await f.openA(); await f.click('继续上次工作'); await f.close();
    f.setRun(async () => { throw new Error('系统调用拒绝'); }); await f.manual();
    assert.equal(f.panels().length, 1); assert.match(f.text(), /执行失败：系统调用拒绝/);
    assert.equal(f.buttons('查看上次运行结果').length, 0);
    await f.close(); await f.click('查看上次运行结果');
    assert.match(f.text(), /系统调用拒绝/); assert.doesNotMatch(f.text(), /全部成功/);
  } finally { f.cleanup(); }
});

test('集成：较早 Manual 迟到不能覆盖较新 Resume', async () => {
  const f = await fixture(); try {
    let finishOld;
    f.setRun(id => id === 'manual' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(result('较新恢复')));
    await f.openA(); await f.manual(); await f.click('继续上次工作');
    finishOld(result('过时手动', 0, 1)); await f.flush();
    assert.equal(f.panels().length, 1); assert.match(f.text(), /全部成功/);
    assert.doesNotMatch(f.text(), /过时手动/);
  } finally { f.cleanup(); }
});

test('集成：A 运行中切 B 再回 A，迟到结果不复活', async () => {
  const f = await fixture(); try {
    let finish;
    f.setRun(() => new Promise(resolve => { finish = resolve; }));
    await f.openA(); await f.manual(); await f.click('← 全部工作空间');
    f.buttons('进入')[1].props.onClick(); await f.flush();
    await f.click('← 全部工作空间'); await f.click('进入');
    finish(result('过时 A', 0, 1)); await f.flush();
    assert.equal(f.panels().length, 0); assert.equal(f.buttons('查看上次运行结果').length, 0);
  } finally { f.cleanup(); }
});

test('集成：实际运行中离开到 Dashboard，完成后同 A 可查看', async () => {
  const f = await fixture(); try {
    let finish; f.setRun(() => new Promise(resolve => { finish = resolve; }));
    await f.openA(); await f.manual(); await f.nav('今天');
    finish(result('导航期间完成', 0, 1)); await f.flush(); await f.click('先查看项目');
    assert.equal(f.panels().length, 1); assert.match(f.text(), /导航期间完成/);
  } finally { f.cleanup(); }
});

test('集成：Resume 刷新摘要延迟时 A → B → A，旧执行不能重新成为最近结果', async () => {
  const f = await fixture(); try {
    await f.openA();
    const list = f.api.workspaces.list;
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    let hold = true;
    f.api.workspaces.list = () => hold ? delayed : list();
    await f.click('继续上次工作'); assert.equal(f.modules.useWorkSession().workflowOpening.value, true);
    await f.nav('今天'); hold = false; await f.nav('工作空间');
    await f.click('← 全部工作空间'); f.buttons('进入')[1].props.onClick(); await f.flush();
    await f.click('← 全部工作空间'); await f.click('进入');
    release(await list()); await f.flush();
    assert.equal(f.panels().length, 0); assert.equal(f.buttons('查看上次运行结果').length, 0);
    assert.equal(f.modules.useWorkSession().workflowOpening.value, false);
  } finally { f.cleanup(); }
});

test('集成：统一结果不破坏恢复期间结束 Session 锁定', async () => {
  const f = await fixture(); try {
    let finish; f.setRun(() => new Promise(resolve => { finish = resolve; }));
    await f.openA(); await f.click('继续上次工作');
    const session = f.modules.useWorkSession(); assert.equal(session.workflowOpening.value, true);
    await assert.rejects(session.endSession({}), /正在恢复工作环境/);
    await f.manual(); assert.deepEqual(f.calls, ['resume']);
    finish(result('完成')); await f.flush(); assert.equal(session.workflowOpening.value, false);
    await f.click('结束工作'); await f.click('保存并结束');
    assert.equal(session.activeSession.value, null);
  } finally { f.cleanup(); }
});

test('集成：应用模块重新初始化后最近结果为空', async () => {
  const first = await fixture();
  try { await first.openA(); await first.manual(); await first.close(); }
  finally { first.cleanup(); }
  const second = await fixture(); try {
    assert.equal(second.modules.useRecentWorkflowResult().recentResult.value, null);
    await second.openA(); assert.equal(second.buttons('查看上次运行结果').length, 0);
    assert.equal(second.panels().length, 0);
  } finally { second.cleanup(); }
});
