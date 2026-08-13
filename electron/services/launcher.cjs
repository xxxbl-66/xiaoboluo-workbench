const { shell } = require('electron');
const { id } = require('../defaults.cjs');

function readWorkflows(store) {
  return store.read('workflows.json', []);
}

function writeWorkflows(store, items) {
  store.write('workflows.json', items);
}

function readApps(store) {
  return store.read('apps.json', []);
}

function writeApps(store, items) {
  store.write('apps.json', items);
}

async function launchApp(store, appId) {
  const apps = readApps(store);
  const appEntry = apps.find((item) => item.id === appId);
  if (!appEntry) return { ok: false, error: '应用不存在' };
  const error = await shell.openPath(appEntry.path);
  if (error) return { ok: false, error };
  appEntry.lastLaunched = new Date().toISOString();
  appEntry.launchCount = (appEntry.launchCount || 0) + 1;
  writeApps(store, apps);
  return { ok: true };
}

async function openPath(filePath) {
  const error = await shell.openPath(filePath);
  return error ? { ok: false, error } : { ok: true };
}

function revealPath(filePath) {
  shell.showItemInFolder(filePath);
  return { ok: true };
}

function openExternal(url) {
  shell.openExternal(url);
  return { ok: true };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkflow(store, workflowId) {
  const workflows = readWorkflows(store);
  const workflow = workflows.find((item) => item.id === workflowId);
  if (!workflow) return { ok: false, error: '工作流不存在' };

  const results = [];
  for (const step of workflow.steps || []) {
    if (step.type === 'app') {
      results.push({ step: step.id, result: await launchApp(store, step.appId) });
    } else if (step.type === 'file') {
      results.push({ step: step.id, result: await openPath(step.path) });
    } else if (step.type === 'url') {
      results.push({ step: step.id, result: openExternal(step.url) });
    }
    await delay(350);
  }
  return { ok: true, results };
}

module.exports = {
  readWorkflows,
  writeWorkflows,
  launchApp,
  openPath,
  revealPath,
  openExternal,
  runWorkflow
};
