import { computed, ref } from 'vue';
import { workbench } from './useWorkbench.js';

/**
 * 工作会话（Work Session）的模块级状态。
 *
 * 为什么必须放在模块级：App.vue 用 <component :is> 切换页面会真正卸载组件，
 * 组件内部的计时状态会丢失。放在模块里，切换页面、甚至 WorkspaceView 被卸载，
 * 计时也不会中断。
 *
 * 计时只用于"显示"：显示值每秒用 Date.now() - startedAt 重算，
 * 真实时长由主进程在 sessions:end 时根据 startedAt 计算，切页/卡顿都不会漂移。
 */

const activeSession = ref(null);
const elapsedSeconds = ref(0);
const isWorking = computed(() => Boolean(activeSession.value && !activeSession.value.endedAt));
const loading = ref(false);
const error = ref('');

let ticker = null;
let initialized = false;

function refreshElapsed() {
  const session = activeSession.value;
  if (!session) {
    elapsedSeconds.value = 0;
    return;
  }
  const startedAt = new Date(session.startedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    elapsedSeconds.value = 0;
    return;
  }
  elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function startTicker() {
  if (ticker) return;
  refreshElapsed();
  ticker = setInterval(refreshElapsed, 1000);
}

function stopTicker() {
  if (!ticker) return;
  clearInterval(ticker);
  ticker = null;
  refreshElapsed();
}

function applySession(session) {
  activeSession.value = session || null;
  if (activeSession.value) startTicker();
  else stopTicker();
}

/** 启动时/恢复时调用：找出主进程里仍在进行的会话 */
async function initialize() {
  loading.value = true;
  error.value = '';
  try {
    const session = await workbench.sessions.getActive();
    applySession(session);
    initialized = true;
    return session;
  } catch (err) {
    error.value = err.message || '读取工作状态失败';
    applySession(null);
    return null;
  } finally {
    loading.value = false;
  }
}

/** 重新对账一次（从设置页/其他入口返回时可用） */
async function resumeActiveSession() {
  return initialize();
}

/**
 * 开始工作。
 * @returns {{started:boolean, reason?:string, session:object}} 已有进行中的会话时不会新建第二条
 */
async function startSession(workspaceId) {
  loading.value = true;
  error.value = '';
  try {
    const result = await workbench.sessions.start(workspaceId || null);
    if (result && result.started === false) {
      // 主进程返回"已有进行中的工作"，把状态同步过来
      applySession(result.session);
      return result;
    }
    applySession(result.session);
    return result;
  } catch (err) {
    error.value = err.message || '开始工作失败';
    throw err;
  } finally {
    loading.value = false;
  }
}

/** 结束工作：时长由主进程按 startedAt 计算 */
async function endSession(patch = {}) {
  const session = activeSession.value;
  if (!session) throw new Error('当前没有正在进行的工作');
  loading.value = true;
  error.value = '';
  try {
    const ended = await workbench.sessions.end(session.id, patch);
    applySession(null);
    return ended;
  } catch (err) {
    error.value = err.message || '结束工作失败';
    throw err;
  } finally {
    loading.value = false;
  }
}

export function useWorkSession() {
  return {
    activeSession,
    elapsedSeconds,
    isWorking,
    loading,
    error,
    initialized: () => initialized,
    initialize,
    resumeActiveSession,
    startSession,
    endSession,
    refreshElapsed
  };
}
