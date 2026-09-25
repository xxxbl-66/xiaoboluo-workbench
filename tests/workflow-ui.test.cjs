const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

async function loadComponent(relativePath) {
  const esbuild = require('esbuild');
  const compiler = require('@vue/compiler-sfc');
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, '..', relativePath)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['vue'],
    plugins: [{ name: 'vue-sfc', setup(build) {
      build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
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
    find(root, (item) => item.type === 'button' && textOf(item) === '✎').props.onClick();
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
    find(root, (item) => item.type === 'button' && textOf(item) === '✎').props.onClick();
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
