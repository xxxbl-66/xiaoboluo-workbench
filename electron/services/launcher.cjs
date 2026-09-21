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

/** 只允许 http/https 交给系统浏览器，避免 file: / 自定义协议被拉起本机程序 */
function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

async function openExternal(url) {
  if (!isSafeExternalUrl(url)) {
    return { ok: false, error: '只支持打开 http 或 https 链接' };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '打开链接失败' };
  }
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
      // 必须 await：openExternal 是异步的，漏掉 await 会把 Promise 写进结果，
      // 既让失败检查失效，也会在 IPC 序列化时出错。
      results.push({ step: step.id, result: await openExternal(step.url) });
    }
    await delay(350);
  }

  const failed = results.find((item) => item.result && item.result.ok === false);
  if (failed) {
    return { ok: false, error: failed.result.error || '工作流执行失败', results };
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
  isSafeExternalUrl,
  runWorkflow
};
