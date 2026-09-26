const { shell } = require('electron');
const { id } = require('../defaults.cjs');
const fs = require('node:fs');
const path = require('node:path');

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

function normalizeWorkflowInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工作流数据无效');
  }
  if (typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('工作流名称不能为空');
  }
  const name = input.name.trim();
  if (name.length > 80) throw new Error('工作流名称不能超过 80 个字');
  if (!Array.isArray(input.steps)) throw new Error('工作流步骤必须是数组');
  if (!input.steps.length) throw new Error('工作流至少需要一个步骤');

  const steps = Array.from(input.steps, (step, index) => {
    const number = `第 ${index + 1} 步`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`${number}的数据无效`);
    }
    if (!['app', 'file', 'url'].includes(step.type)) {
      throw new Error(`${number}的类型不受支持`);
    }
    const normalized = { ...step };
    if (step.type === 'app') {
      if (typeof step.appId !== 'string' || !step.appId.trim()) {
        throw new Error(`${number}尚未选择应用`);
      }
      normalized.appId = step.appId.trim();
    } else if (step.type === 'file') {
      if (typeof step.path !== 'string' || !step.path.trim()) {
        throw new Error(`${number}尚未选择文件或文件夹`);
      }
    } else {
      if (typeof step.url !== 'string' || !step.url.trim()) {
        throw new Error(`${number}的网址不能为空`);
      }
      if (!isSafeExternalUrl(step.url)) {
        throw new Error(`${number}只支持有效的 http:// 或 https:// 网址`);
      }
      normalized.url = step.url.trim();
    }
    return normalized;
  });
  return { name, steps };
}

async function openExternal(url) {
  if (!isSafeExternalUrl(url)) {
    return { ok: false, error: '只支持打开 http 或 https 链接' };
  }
  try {
    const response = await shell.openExternal(url.trim());
    if (response && (typeof response === 'string' || response.ok === false)) {
      return { ok: false, error: typeof response === 'string' ? response : (response.error || '打开链接失败') };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || '打开链接失败' };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const runningWorkflowIds = new Set();

async function runWorkflow(store, workflowId) {
  if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('工作流 ID 无效');
  const workflows = readWorkflows(store);
  const workflow = workflows.find((item) => item.id === workflowId);
  if (!workflow) return { ok: false, error: '工作流不存在' };
  if (!Array.isArray(workflow.steps)) throw new Error('工作流步骤数据损坏');
  if (!workflow.steps.length) throw new Error('工作流没有可执行步骤');
  if (runningWorkflowIds.has(workflowId)) throw new Error('工作流正在运行，请等待本次执行完成');
  runningWorkflowIds.add(workflowId);

  try {
  const results = [];
  const steps = [];
  for (const [index, step] of workflow.steps.entries()) {
    const type = step && typeof step.type === 'string' ? step.type : 'unknown';
    let label = `第 ${index + 1} 步`;
    let result;
    try {
      if (type === 'app') {
        const app = readApps(store).find((item) => item.id === step.appId);
        label = app?.name || '未找到的应用';
        if (!step.appId) result = { ok: false, error: '尚未选择应用' };
        else if (!app) result = { ok: false, error: '应用不存在' };
        else if (typeof app.path !== 'string' || !app.path) result = { ok: false, error: '应用路径无效' };
        else {
          try {
            await fs.promises.stat(app.path);
            result = await launchApp(store, step.appId);
          } catch (error) {
            result = { ok: false, error: error.code === 'ENOENT' ? '应用路径不存在' : (error.message || '无法访问应用路径') };
          }
        }
      } else if (type === 'file') {
        label = typeof step.path === 'string' && step.path ? path.basename(step.path) : '未选择的文件或文件夹';
        if (!step.path || typeof step.path !== 'string') result = { ok: false, error: '尚未选择文件或文件夹' };
        else {
          try {
            await fs.promises.stat(step.path);
            result = await openPath(step.path);
          } catch (error) {
            result = { ok: false, error: error.code === 'ENOENT' ? '路径不存在' : (error.message || '无法访问路径') };
          }
        }
      } else if (type === 'url') {
        label = isSafeExternalUrl(step.url) ? new URL(step.url.trim()).hostname : '网页';
        result = await openExternal(step.url);
      } else {
        result = { ok: false, error: '不支持的步骤类型' };
      }
    } catch (error) {
      result = { ok: false, error: error?.message || '执行失败' };
    }
    const plain = { ok: result?.ok === true, error: result?.ok === true ? null : String(result?.error || '执行失败') };
    results.push({ step: step?.id || null, result: plain.ok ? { ok: true } : { ok: false, error: plain.error } });
    steps.push({ id: step?.id || null, index, type, label, ...plain });
    await delay(350);
  }

  const failedCount = steps.filter((item) => !item.ok).length;
  const successCount = steps.length - failedCount;
  return {
    ok: failedCount === 0,
    error: steps.find((item) => !item.ok)?.error || null,
    workflowId,
    workflowName: workflow.name || '未命名工作流',
    totalCount: steps.length,
    successCount,
    failedCount,
    steps,
    results
  };
  } finally {
    runningWorkflowIds.delete(workflowId);
  }
}

module.exports = {
  readWorkflows,
  writeWorkflows,
  launchApp,
  openPath,
  revealPath,
  openExternal,
  isSafeExternalUrl,
  normalizeWorkflowInput,
  runWorkflow
};
