const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { createHost } = require('./helpers/vue-host.cjs');

async function component(relativePath) {
  const esbuild = require('esbuild');
  const { parse, compileScript } = require('@vue/compiler-sfc');
  const filename = path.join(__dirname, '..', 'src/renderer/src', relativePath);
  const result = await esbuild.build({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['vue'], plugins: [{ name: 'mock-session', setup(build) {
      build.onLoad({ filter: /[\\/]composables[\\/]useWorkSession\.js$/ }, () => ({
        contents: "import { ref } from 'vue'; const activeSession = ref(globalThis.__stage4Active); globalThis.__stage4SessionRef = activeSession; export function useWorkSession() { return { activeSession, elapsedSeconds: ref(90) }; }", loader: 'js'
      }));
    } }, { name: 'vue', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, (args) => {
        const descriptor = parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path }).descriptor;
        return { contents: compileScript(descriptor, { id: 'stage4', inlineTemplate: true }).content, loader: 'js' };
      });
    } }] });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(result.outputFiles[0].text, filename);
  return loaded.exports.default;
}

test('Dashboard 主信息显示最近工作的下一步并发出继续意图', async () => {
  const oldWindow = global.window;
  global.__stage4Active = null;
  global.window = { workbench: {
    workspaces: { recent: async () => [{ id: 'w', name: '程序设计大赛', lastWorkedAt: '2026-09-25T08:00:00Z' }] },
    sessions: { last: async () => ({ nextStep: '完善错误反馈', completedTodos: [{ id: 't', title: '保存比赛资料' }] }) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    let target = null;
    const app = host.renderer.createApp(await component('components/DashboardWorkFocus.vue'), { onContinue: (id) => { target = id; } });
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /程序设计大赛/);
    assert.match(host.content(host.root), /完善错误反馈/);
    assert.match(host.content(host.root), /保存比赛资料/);
    host.click(host.find('button', '继续工作'));
    assert.equal(target, 'w');
    app.unmount();
  } finally { global.window = oldWindow; delete global.__stage4Active; }
});

test('Dashboard 工作中状态显示项目、计时和上次留下的工作上下文', async () => {
  const oldWindow = global.window;
  global.__stage4Active = { id: 's', workspaceId: 'w', startedAt: '2026-09-27T03:00:00Z' };
  global.window = { workbench: {
    workspaces: { list: async () => [{ id: 'w', name: '程序设计大赛' }] },
    sessions: { last: async () => ({ nextStep: '检查答辩材料' }) }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await component('components/DashboardWorkFocus.vue'));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    const content = host.content(host.root);
    assert.match(content, /当前正在工作/);
    assert.match(content, /程序设计大赛/);
    assert.match(content, /检查答辩材料/);
    assert.ok(host.find('button', '进入工作空间'));
    app.unmount();
  } finally { global.window = oldWindow; delete global.__stage4Active; }
});

test('Dashboard 项目资料暂时加载失败时仍显示正在计时的 Session', async () => {
  const oldWindow = global.window;
  global.__stage4Active = { id: 's2', workspaceId: 'w2', startedAt: '2026-09-27T03:00:00Z' };
  global.window = { workbench: { workspaces: { list: async () => { throw new Error('暂不可读'); } } } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await component('components/DashboardWorkFocus.vue'));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /当前正在工作/);
    assert.match(host.content(host.root), /暂不可读/);
    app.unmount();
  } finally { global.window = oldWindow; delete global.__stage4Active; }
});

test('Dashboard 切换到工作中的 B 后不显示迟到的 A 下一步', async () => {
  const oldWindow = global.window;
  global.__stage4Active = null;
  let releaseOld;
  const oldResult = new Promise((resolve) => { releaseOld = resolve; });
  global.window = { workbench: {
    workspaces: {
      recent: async () => [{ id: 'A', name: 'A 项目' }],
      list: async () => [{ id: 'B', name: 'B 项目' }]
    },
    sessions: { last: async (id) => id === 'A' ? oldResult : { nextStep: 'B 下一步' } }
  } };
  const { createRenderer, nextTick } = await import('vue');
  try {
    const host = createHost(createRenderer);
    const app = host.renderer.createApp(await component('components/DashboardWorkFocus.vue'));
    app.mount(host.root);
    await new Promise(setImmediate); await nextTick();
    global.__stage4SessionRef.value = { id: 'active-B', workspaceId: 'B' };
    await new Promise(setImmediate); await nextTick();
    releaseOld({ nextStep: 'A 迟到下一步' });
    await new Promise(setImmediate); await nextTick();
    assert.match(host.content(host.root), /B 下一步/);
    assert.doesNotMatch(host.content(host.root), /A 迟到下一步/);
    app.unmount();
  } finally { global.window = oldWindow; delete global.__stage4Active; delete global.__stage4SessionRef; }
});
