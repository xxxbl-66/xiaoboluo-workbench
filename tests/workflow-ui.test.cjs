const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

async function loadComponent(relativePath, shallowWorkspace = false) {
  const esbuild = require('esbuild');
  const compiler = require('@vue/compiler-sfc');
  const entry = path.join(__dirname, '..', relativePath);
  const manualWorkspace = relativePath.endsWith('/WorkspaceWorkflows.vue');
  const result = await esbuild.build({
    entryPoints: manualWorkspace ? undefined : [entry],
    // Production's WorkspaceView owns the result panel. Exercise the real execution
    // component together with that real shared panel instead of expecting local state.
    stdin: manualWorkspace ? {
      resolveDir: path.join(__dirname, '..'), sourcefile: 'workspace-workflows-host.js',
      contents: `import { h } from 'vue';
        import Workflows from './src/renderer/src/components/WorkspaceWorkflows.vue';
        import RecentResult from './src/renderer/src/components/RecentWorkflowResult.vue';
        export default { props: ['workspace', 'workflows', 'busy', 'archived'],
          render() { return h('div', [h(Workflows, this.$props), h(RecentResult, { currentWorkspaceId: this.workspace.id })]); } };`
    } : undefined,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['vue'],
    plugins: [{ name: 'vue-sfc', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
        if (shallowWorkspace && filename !== entry) {
          if (filename.endsWith('WorkspaceCard.vue')) {
            return { contents: "import { h } from 'vue'; export default { props: ['workspace'], emits: ['open'], setup(props, { emit }) { return () => h('button', { onClick: () => emit('open', props.workspace) }, '打开工作空间 ' + props.workspace.id); } };", loader: 'js' };
          }
          if (!filename.endsWith('ResumeWorkCard.vue') && !filename.endsWith('WorkflowRunResult.vue') && !filename.endsWith('RecentWorkflowResult.vue')) {
            return { contents: 'export default { render() { return null; } };', loader: 'js' };
          }
        }
        const source = fs.readFileSync(filename, 'utf8');
        const { descriptor } = compiler.parse(source, { filename });
        const script = compiler.compileScript(descriptor, { id: filename, inlineTemplate: true });
        return { contents: script.content, loader: 'js' };
      });
    } }]
  });
  const compiled = new Module(path.join(__dirname, '__workflow_ui_bundle.cjs'), module);
  compiled.filename = path.join(__dirname, '__workflow_ui_bundle.cjs');
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  return compiled.exports.default;
}

test('Workspace 页面先显示但工作流列表延迟时，立即继续会等待列表后运行默认工作流', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let resolveList;
  let starts = 0;
  let runs = 0;
  const workflowList = new Promise((resolve) => { resolveList = resolve; });
  const workspace = { id: 'ws-a', name: '竞赛', workflowIds: ['wf'], resumeWorkflowId: 'wf' };
  global.window = { workbench: {
    workspaces: { list: async () => [workspace], touch: async () => {} },
    workflows: { list: () => workflowList, runDetailed: async (id) => {
      assert.equal(id, 'wf'); runs++;
      return { ok: true, workflowName: '恢复环境', totalCount: 1, successCount: 1, failedCount: 0, steps: [{ index: 0, type: 'url', label: 'example.com', ok: true }] };
    } },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 60, completedTodos: [], remainingTodos: [] }),
      start: async () => ({ started: true, session: { id: `session-${++starts}`, workspaceId: 'ws-a', startedAt: new Date().toISOString(), endedAt: null } })
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    const resume = find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作'));
    assert.ok(resume, 'Workspace 已显示，而 workflow 列表仍未返回');
    resume.props.onClick();
    resume.props.onClick();
    await vue.nextTick();
    assert.equal(starts, 0);
    resolveList([{ id: 'wf', name: '恢复环境' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.equal(starts, 1);
    assert.equal(runs, 1);
    assert.doesNotMatch(textOf(root), /默认工作流已失效/);
    assert.match(textOf(root), /全部成功/);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('Workspace A 等待列表时切到 B，A 不创建 Session 或执行工作流', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let resolveList;
  const workflowList = new Promise((resolve) => { resolveList = resolve; });
  const workspaces = [
    { id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' },
    { id: 'ws-b', name: 'B', workflowIds: ['wf-b'], resumeWorkflowId: 'wf-b' }
  ];
  let starts = 0;
  let runs = 0;
  global.window = { workbench: {
    workspaces: { list: async () => workspaces, touch: async () => {} },
    workflows: { list: () => workflowList, runDetailed: async () => { runs++; return { ok: true, totalCount: 1, successCount: 1, failedCount: 0, steps: [] }; } },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async (id) => ({ started: true, session: { id: `session-${++starts}`, workspaceId: id, startedAt: new Date().toISOString(), endedAt: null } })
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('全部工作空间')).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-b').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    resolveList([{ id: 'wf-a', name: 'A 恢复结果' }, { id: 'wf-b', name: 'B 恢复结果' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.equal(starts, 0);
    assert.equal(runs, 0);
    assert.match(textOf(root), /WORKSPACE \/ B/);
    assert.doesNotMatch(textOf(root), /A 恢复结果/);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('A 等待时切到 B 并立即继续，旧 A 不清理 B 的忙碌状态或结果', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let resolveList;
  let finishB;
  const starts = [];
  const runs = [];
  const workflowList = new Promise((resolve) => { resolveList = resolve; });
  const workspaces = [
    { id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' },
    { id: 'ws-b', name: 'B', workflowIds: ['wf-b'], resumeWorkflowId: 'wf-b' }
  ];
  global.window = { workbench: {
    workspaces: { list: async () => workspaces, touch: async () => {} },
    workflows: { list: () => workflowList, runDetailed: (id) => {
      runs.push(id);
      return new Promise((resolve) => { finishB = resolve; });
    } },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async (id) => {
        starts.push(id);
        return { started: true, session: { id: `session-${id}`, workspaceId: id, startedAt: new Date().toISOString(), endedAt: null } };
      }
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('全部工作空间')).props.onClick();
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-b').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    const resumeB = find(root, (item) => item.type === 'button' && /继续上次工作|正在恢复/.test(textOf(item)));
    assert.ok(resumeB, textOf(root));
    assert.equal(resumeB.props.disabled, false, 'B 不应等待 A 的恢复意图结束');
    resumeB.props.onClick();
    resolveList([{ id: 'wf-a', name: 'A 流程' }, { id: 'wf-b', name: 'B 流程' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.deepEqual(starts, ['ws-b']);
    assert.deepEqual(runs, ['wf-b']);
    assert.match(textOf(root), /正在打开工作环境|正在恢复工作环境/, 'A 的旧 finally 不能清掉 B 的忙碌状态');
    finishB({ ok: true, totalCount: 1, successCount: 1, failedCount: 0, steps: [{ index: 0, type: 'url', label: 'B 结果', ok: true }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.match(textOf(root), /B 流程全部成功/);
    assert.doesNotMatch(textOf(root), /A 流程/);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('A1 等待时切 B 再回 A，只有新 A2 能启动 Session 和工作流', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let resolveList;
  const starts = [];
  const runs = [];
  const workflowList = new Promise((resolve) => { resolveList = resolve; });
  const workspaces = [
    { id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' },
    { id: 'ws-b', name: 'B', workflowIds: ['wf-b'], resumeWorkflowId: 'wf-b' }
  ];
  global.window = { workbench: {
    workspaces: { list: async () => workspaces, touch: async () => {} },
    workflows: { list: () => workflowList, runDetailed: async (id) => {
      runs.push(id);
      return { ok: true, totalCount: 1, successCount: 1, failedCount: 0, steps: [] };
    } },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async (id) => {
        starts.push(id);
        return { started: true, session: { id: `session-${id}`, workspaceId: id, startedAt: new Date().toISOString(), endedAt: null } };
      }
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    const open = async (id) => {
      find(root, (item) => item.type === 'button' && textOf(item) === `打开工作空间 ${id}`).props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await vue.nextTick();
    };
    const back = async () => {
      find(root, (item) => item.type === 'button' && textOf(item).includes('全部工作空间')).props.onClick();
      await vue.nextTick();
    };
    await open('ws-a');
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    await back();
    await open('ws-b');
    await back();
    await open('ws-a');
    const resumeA2 = find(root, (item) => item.type === 'button' && /继续上次工作|正在恢复/.test(textOf(item)));
    assert.ok(resumeA2, textOf(root));
    assert.equal(resumeA2.props.disabled, false);
    resumeA2.props.onClick();
    resolveList([{ id: 'wf-a', name: 'A 流程' }, { id: 'wf-b', name: 'B 流程' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.deepEqual(starts, ['ws-a']);
    assert.deepEqual(runs, ['wf-a']);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('WorkspaceView 卸载时等待中的恢复不会创建 Session 或运行工作流', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let resolveList;
  let starts = 0;
  let runs = 0;
  const workflowList = new Promise((resolve) => { resolveList = resolve; });
  global.window = { workbench: {
    workspaces: { list: async () => [{ id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' }], touch: async () => {} },
    workflows: { list: () => workflowList, runDetailed: async () => { runs++; return { ok: true, steps: [] }; } },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async () => { starts++; return { started: true, session: { id: 's' } }; }
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    app.unmount();
    resolveList([{ id: 'wf-a', name: 'A 流程' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(starts, 0);
    assert.equal(runs, 0);
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('Session 已创建后切到 B，A 工作流继续完成但结果不写入 B', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let finishA;
  const starts = [];
  const runs = [];
  const workspaces = [
    { id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' },
    { id: 'ws-b', name: 'B', workflowIds: [], resumeWorkflowId: null }
  ];
  global.window = { workbench: {
    workspaces: { list: async () => workspaces, touch: async () => {} },
    workflows: {
      list: async () => [{ id: 'wf-a', name: 'A 流程' }],
      runDetailed: (id) => {
        runs.push(id);
        return new Promise((resolve) => { finishA = resolve; });
      }
    },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async (id) => {
        starts.push(id);
        return { started: true, session: { id: `session-${id}`, workspaceId: id, startedAt: new Date().toISOString(), endedAt: null } };
      }
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.deepEqual(starts, ['ws-a']);
    assert.deepEqual(runs, ['wf-a']);
    find(root, (item) => item.type === 'button' && textOf(item).includes('全部工作空间')).props.onClick();
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-b').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    finishA({ ok: false, totalCount: 1, successCount: 0, failedCount: 1, steps: [{ index: 0, type: 'url', label: 'A 私有结果', ok: false, error: '失败' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.deepEqual(starts, ['ws-a'], '已提交的 A Session 不回滚或重建');
    assert.deepEqual(runs, ['wf-a']);
    assert.match(textOf(root), /WORKSPACE \/ B/);
    assert.doesNotMatch(textOf(root), /A 私有结果|A 流程/);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

test('Workflow 读取失败不启动 Session，显示错误后可重试', async () => {
  const vue = require('vue');
  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = () => ({ fake: true });
  let rejectList;
  let fetches = 0;
  let starts = 0;
  let runs = 0;
  const firstList = new Promise((_, reject) => { rejectList = reject; });
  global.window = { workbench: {
    workspaces: { list: async () => [{ id: 'ws-a', name: 'A', workflowIds: ['wf-a'], resumeWorkflowId: 'wf-a' }], touch: async () => {} },
    workflows: {
      list: () => ++fetches === 1 ? firstList : Promise.resolve([{ id: 'wf-a', name: 'A 流程' }]),
      runDetailed: async () => { runs++; return { ok: true, totalCount: 1, successCount: 1, failedCount: 0, steps: [] }; }
    },
    sessions: {
      last: async () => ({ id: 'previous', startedAt: new Date().toISOString(), durationSeconds: 1 }),
      start: async () => ({ started: true, session: { id: `session-${++starts}`, workspaceId: 'ws-a', startedAt: new Date().toISOString(), endedAt: null } })
    }
  } };
  try {
    const Component = await loadComponent('src/renderer/src/views/WorkspaceView.vue', true);
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '打开工作空间 ws-a').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    rejectList(new Error('磁盘读取失败'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.equal(starts, 0);
    assert.equal(runs, 0);
    assert.match(textOf(root), /磁盘读取失败/);
    assert.doesNotMatch(textOf(root), /已失效/);
    find(root, (item) => item.type === 'button' && textOf(item).includes('继续上次工作')).props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.equal(fetches, 2);
    assert.equal(starts, 1);
    assert.equal(runs, 1);
    app.unmount();
  } finally {
    globalThis.setInterval = originalSetInterval;
    delete global.window;
  }
});

function hostRenderer(vue) {
  const node = (type, text = '') => {
    const target = { type, tagName: type.toUpperCase(), text, children: [], props: {}, parent: null, value: '', listeners: {} };
    target.addEventListener = (event, callback) => { target.listeners[event] = callback; };
    target.removeEventListener = (event) => { delete target.listeners[event]; };
    target.dispatchEvent = (event) => { target.listeners[event.type]?.(event); };
    target.getAttribute = (key) => target.props[key];
    target.getRootNode = () => ({ activeElement: null });
    Object.defineProperty(target, 'options', { get: () => target.children.filter((item) => item.type === 'option') });
    return target;
  };
  const body = node('body');
  const insert = (child, parent, anchor) => {
    if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child);
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index < 0) parent.children.push(child); else parent.children.splice(index, 0, child);
    child.parent = parent;
  };
  const renderer = vue.createRenderer({
    createElement: (type) => node(type),
    createText: (text) => node('#text', text),
    createComment: (text) => node('#comment', text),
    setText: (target, text) => { target.text = text; },
    setElementText: (target, text) => { target.text = text; target.children = []; },
    patchProp: (target, key, _old, value) => { target.props[key] = value; if (key === 'value') target.value = value; },
    insert,
    insertStaticContent: (content, parent, anchor) => { const target = node('#static', content); insert(target, parent, anchor); return [target, target]; },
    querySelector: (selector) => selector === 'body' ? body : null,
    remove: (child) => {
      if (child.parent) child.parent.children = child.parent.children.filter((item) => item !== child);
      child.parent = null;
    },
    parentNode: (child) => child.parent,
    nextSibling: (child) => {
      const siblings = child.parent?.children || [];
      return siblings[siblings.indexOf(child) + 1] || null;
    }
  });
  const textOf = (target) => `${target.text || ''}${target.children.map(textOf).join('')}`;
  const find = (target, predicate) => predicate(target) ? target : target.children.map((item) => find(item, predicate)).find(Boolean);
  return { renderer, node, body, textOf, find };
}

test('Workspace 手动运行显示逐步结果并阻止重复点击', async () => {
  const vue = require('vue');
  let finish;
  let calls = 0;
  global.window = { workbench: { workflows: { runDetailed: async () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  } } } };
  try {
    const Component = await loadComponent('src/renderer/src/components/WorkspaceWorkflows.vue');
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component, {
      workspace: { id: 'ws-a', workflowIds: ['w'], resumeWorkflowId: 'w' },
      workflows: [{ id: 'w', name: '恢复环境', steps: [{ type: 'url' }] }]
    });
    app.mount(root);
    const runButton = find(root, (item) => item.type === 'button' && textOf(item).includes('运行'));
    runButton.props.onClick();
    runButton.props.onClick();
    assert.equal(calls, 1);
    finish({ ok: false, workflowName: '恢复环境', totalCount: 2, successCount: 1, failedCount: 1, steps: [
      { index: 0, type: 'url', label: 'example.com', ok: true, error: null },
      { index: 1, type: 'file', label: '项目文件夹', ok: false, error: '路径不存在' }
    ] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.match(textOf(root), /部分成功/);
    assert.match(textOf(root), /项目文件夹/);
    assert.match(textOf(root), /路径不存在/);
    app.unmount();
  } finally {
    delete global.window;
  }
});

test('Workspace 最近一次工作流结果关闭后可重看，下一次覆盖，切空间清空', async () => {
  const vue = require('vue');
  let count = 0;
  global.window = { workbench: { workflows: { runDetailed: async () => ({
    ok: true, totalCount: 1, successCount: 1, failedCount: 0,
    steps: [{ index: 0, type: 'url', label: `结果 ${++count}`, ok: true }]
  }) } } };
  try {
    const Component = await loadComponent('src/renderer/src/components/WorkspaceWorkflows.vue');
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const workflows = [{ id: 'wf', name: '开发环境', steps: [{ type: 'url' }] }];
    renderer.render(vue.h(Component, { workspace: { id: 'A', workflowIds: ['wf'] }, workflows }), root);
    find(root, (item) => item.type === 'button' && textOf(item).includes('运行')).props.onClick();
    await new Promise(setImmediate); await vue.nextTick();
    assert.match(textOf(root), /全部成功/);
    find(root, (item) => item.type === 'button' && textOf(item) === '关闭').props.onClick();
    await vue.nextTick();
    assert.doesNotMatch(textOf(root), /全部成功/);
    const reopen = find(root, (item) => item.type === 'button' && textOf(item).includes('查看上次运行结果'));
    assert.ok(reopen);
    reopen.props.onClick(); await vue.nextTick();
    find(root, (item) => item.type === 'button' && textOf(item) === '查看步骤').props.onClick();
    await vue.nextTick();
    assert.match(textOf(root), /结果 1/);
    find(root, (item) => item.type === 'button' && textOf(item).includes('运行')).props.onClick();
    await new Promise(setImmediate); await vue.nextTick();
    assert.doesNotMatch(textOf(root), /结果 1/);
    renderer.render(vue.h(Component, { workspace: { id: 'B', workflowIds: [] }, workflows }), root);
    await vue.nextTick();
    assert.doesNotMatch(textOf(root), /查看上次运行结果|全部成功/);
    renderer.render(null, root);
  } finally { delete global.window; }
});

test('切换 Workspace 后，旧工作流异步结果不会显示在新空间', async () => {
  const vue = require('vue');
  let finish;
  global.window = { workbench: { workflows: { runDetailed: () => new Promise((resolve) => { finish = resolve; }) } } };
  try {
    const Component = await loadComponent('src/renderer/src/components/WorkspaceWorkflows.vue');
    const { renderer, node, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const selected = vue.ref({ id: 'a', workflowIds: ['w'], resumeWorkflowId: null });
    const app = renderer.createApp({ render: () => vue.h(Component, {
      workspace: selected.value,
      workflows: [{ id: 'w', name: '工作流 A', steps: [{ type: 'url' }] }]
    }) });
    app.mount(root);
    find(root, (item) => item.type === 'button' && textOf(item).includes('运行')).props.onClick();
    selected.value = { id: 'b', workflowIds: [], resumeWorkflowId: null };
    await vue.nextTick();
    finish({ ok: false, totalCount: 1, successCount: 0, failedCount: 1, steps: [{ index: 0, type: 'url', label: '旧结果', ok: false, error: '不应显示' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    assert.doesNotMatch(textOf(root), /不应显示/);
    app.unmount();
  } finally { delete global.window; }
});

test('编辑保存失败后工作流名称和步骤仍留在表单', async () => {
  const vue = require('vue');
  const workflow = { id: 'old', name: '旧工作流', steps: [{ id: 's', type: 'file', path: 'C:\\虚构 文件夹' }] };
  global.window = { workbench: {
    workflows: { list: async () => [workflow], update: async () => { throw new Error('磁盘写入失败'); } },
    apps: { list: async () => [] },
    system: { selectFile: async () => null, selectDirectory: async () => 'D:\\竞赛 项目\\中文文件夹' }
  } };
  global.document = { activeElement: null };
  global.Document = class Document {};
  global.ShadowRoot = class ShadowRoot {};
  try {
    const Component = await loadComponent('src/renderer/src/components/WorkflowPanel.vue');
    const { renderer, node, body, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && String(item.props['aria-label'] || '').startsWith('编辑')).props.onClick();
    await vue.nextTick();
    const nameInput = find(body, (item) => item.type === 'input' && item.props.placeholder === '例如：开始一天');
    assert.ok(nameInput);
    nameInput.value = '修改后名称';
    nameInput.listeners.input({ target: nameInput });
    nameInput.props.onInput?.({ target: nameInput });
    await vue.nextTick();
    const directoryButton = find(body, (item) => item.type === 'button' && textOf(item) === '选择文件夹');
    await directoryButton.props.onClick();
    await vue.nextTick();
    const pathInput = find(body, (item) => item.type === 'input' && item.props.placeholder === '文件或文件夹路径');
    assert.equal(pathInput.value, 'D:\\竞赛 项目\\中文文件夹');
    await find(body, (item) => item.type === 'button' && textOf(item) === '选择文件').props.onClick();
    assert.equal(pathInput.value, 'D:\\竞赛 项目\\中文文件夹', '取消文件选择必须保留现有路径');
    const save = find(body, (item) => item.type === 'button' && textOf(item) === '保存');
    await save.props.onClick();
    await vue.nextTick();
    assert.ok(find(body, (item) => item.type === 'input' && item.props.placeholder === '例如：开始一天'));
    assert.equal(nameInput.value, '修改后名称');
    assert.equal(pathInput.value, 'D:\\竞赛 项目\\中文文件夹');
    app.unmount();
  } finally {
    delete global.window;
    delete global.document;
    delete global.Document;
    delete global.ShadowRoot;
  }
});

test('旧工作流的非法 URL 在对应步骤旁显示错误，不能静默保存', async () => {
  const vue = require('vue');
  let updates = 0;
  global.window = { workbench: {
    workflows: {
      list: async () => [{ id: 'old', name: '旧工作流', steps: [{ id: 's', type: 'url', url: 'file:///secret' }] }],
      update: async () => { updates++; }
    },
    apps: { list: async () => [] },
    system: { selectFile: async () => null, selectDirectory: async () => null }
  } };
  global.document = { activeElement: null };
  global.Document = class Document {};
  global.ShadowRoot = class ShadowRoot {};
  try {
    const Component = await loadComponent('src/renderer/src/components/WorkflowPanel.vue');
    const { renderer, node, body, textOf, find } = hostRenderer(vue);
    const root = node('root');
    const app = renderer.createApp(Component);
    app.mount(root);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await vue.nextTick();
    find(root, (item) => item.type === 'button' && String(item.props['aria-label'] || '').startsWith('编辑')).props.onClick();
    await vue.nextTick();
    await find(body, (item) => item.type === 'button' && textOf(item) === '保存').props.onClick();
    await vue.nextTick();
    assert.equal(updates, 0);
    assert.match(textOf(body), /第 1 步只支持有效的 http/);
    app.unmount();
  } finally {
    delete global.window;
    delete global.document;
    delete global.Document;
    delete global.ShadowRoot;
  }
});
