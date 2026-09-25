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

/**
 * 异常退出后的待处理状态（P1-01 / 阶段 F）。
 *
 * 判定规则：会话在这次应用启动之前就已经开始，且用户还没有对它做过选择。
 * - 恢复出来的"跨次启动未结束会话" → true，必须让用户明确选择怎么处理
 * - 本次启动后自己新建的会话 → false，不要每次开始工作都弹提示
 * - 用户选择"暂不处理" → 关闭提示，但保留 needsRestoreDecision，
 *   顶部会一直显示"有一次未结束的工作待处理"，随时可以重新打开处理界面
 */
const needsRestoreDecision = ref(false);
const restorePromptDismissed = ref(false);
const appBootTime = Date.now();

let ticker = null;
let initialized = false;

function isPendingRestoreDecision(session) {
  if (!session || session.endedAt) return false;
  const started = new Date(session.startedAt).getTime();
  if (!Number.isFinite(started)) return false;
  // 允许一点点时钟误差：只要不是本次启动之后新建的，就按"恢复出来的"处理
  return started < appBootTime - 1000;
}

function applySession(session) {
  const keepDismissed = Boolean(
    session && activeSession.value && activeSession.value.id === session.id && restorePromptDismissed.value
  );
  activeSession.value = session || null;
  if (activeSession.value) {
    if (isPendingRestoreDecision(activeSession.value)) {
      needsRestoreDecision.value = true;
      restorePromptDismissed.value = keepDismissed;
    } else {
      needsRestoreDecision.value = false;
      restorePromptDismissed.value = false;
    }
    startTicker();
  } else {
    needsRestoreDecision.value = false;
    restorePromptDismissed.value = false;
    stopTicker();
  }
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
 * 用户明确选择"继续这段工作"。
 * 只记录审计时间，不新建第二条会话；计时仍以原始 startedAt 为准。
 */
async function resumeSession() {
  const session = activeSession.value;
  if (!session) throw new Error('当前没有待处理的未结束工作');
  loading.value = true;
  error.value = '';
  try {
    const resumed = await workbench.sessions.resume(session.id);
    // resumeSession 之后不再视为"待决策"，避免重复弹窗
    activeSession.value = resumed;
    needsRestoreDecision.value = false;
    restorePromptDismissed.value = false;
    startTicker();
    return resumed;
  } catch (err) {
    error.value = err.message || '继续工作失败';
    throw err;
  } finally {
    loading.value = false;
  }
}

/** 用户选择"暂不处理"：关闭弹窗，但保留待处理状态，稍后仍可回来处理 */
function dismissRestorePrompt() {
  restorePromptDismissed.value = true;
}

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

/** 恢复旧会话时，一次持久化完成结束和有效时长校正。 */
async function endAndAdjustSession(seconds, options = {}) {
  const session = activeSession.value;
  if (!session) throw new Error('当前没有正在进行的工作');
  loading.value = true;
  error.value = '';
  try {
    const ended = await workbench.sessions.endAndAdjust(session.id, seconds, options);
    applySession(null);
    return ended;
  } catch (err) {
    error.value = err.message || '结束并校正工作失败';
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
    needsRestoreDecision,
    restorePromptDismissed,
    initialized: () => initialized,
    initialize,
    resumeActiveSession,
    resumeSession,
    dismissRestorePrompt,
    startSession,
    endSession,
    endAndAdjustSession,
    refreshElapsed
  };
}
