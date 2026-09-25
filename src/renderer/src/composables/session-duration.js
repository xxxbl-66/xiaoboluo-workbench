/**
 * 有效工作时长校正的渲染层共享逻辑（P1-01）。
 *
 * 与服务层 electron/services/sessions.cjs 的校验规则保持一致：
 * 前端先给即时反馈，服务层再做权威校验，两者都不能省。
 * 组件不得绕过这里直接调用 adjustDuration。
 */

/** 单次工作的合理上限：7 天（与服务层 MAX_ADJUSTABLE_SECONDS 对齐） */
export const MAX_ADJUSTABLE_SECONDS = 7 * 24 * 60 * 60;

export const DURATION_ADJUST_HINT = '工作时长按工作开始日期统计。';

/**
 * 把用户输入（秒或字符串）解析成合法秒数。
 * @returns {{ok:true, seconds:number} | {ok:false, error:string}}
 */
export function parseDurationSeconds(input) {
  if (input === undefined || input === null || input === '') {
    return { ok: false, error: '请输入有效的工作时长' };
  }
  if (typeof input === 'number') {
    if (Number.isNaN(input)) return { ok: false, error: '工作时长不能是 NaN' };
    if (!Number.isFinite(input)) return { ok: false, error: '工作时长必须是有限的数字' };
  } else if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return { ok: false, error: '请输入有效的工作时长' };
    if (!/^\d+$/.test(text)) return { ok: false, error: '工作时长必须是非负整数（秒）' };
  } else {
    return { ok: false, error: '工作时长必须是数字' };
  }

  const seconds = Math.round(Number(input));
  if (!Number.isFinite(seconds)) return { ok: false, error: '工作时长必须是有限的数字' };
  if (seconds < 0) return { ok: false, error: '工作时长不能为负数' };
  if (seconds > MAX_ADJUSTABLE_SECONDS) {
    return { ok: false, error: `工作时长不能超过 ${Math.round(MAX_ADJUSTABLE_SECONDS / 3600)} 小时` };
  }
  return { ok: true, seconds };
}

/** 把分钟输入转成秒（UI 用分钟更直观） */
export function minutesToSeconds(minutes) {
  const parsed = Number(minutes);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 60);
}

/**
 * 校正一个已结束会话的时长。
 *
 * @param {{id:string}} session
 * @param {number|string} secondsOrMinutes 由 unit 决定
 * @param {{
 *   adjust: (sessionId:string, seconds:number, options:{reason:string}) => Promise<any>,
 *   unit?: 'seconds'|'minutes',
 *   reason?: string
 * }} options
 * @returns {Promise<{ok:boolean, error:string, session?:object}>}
 */
export async function adjustSessionDuration(session, secondsOrMinutes, options) {
  if (!session || !session.id) {
    return { ok: false, error: '缺少要校正的工作记录' };
  }
  if (!options.allowActive && (session.endedAt === null || session.endedAt === undefined || session.endedAt === '')) {
    return { ok: false, error: '这次工作还没有结束，请先结束再校正时长' };
  }
  const unit = options.unit || 'seconds';
  const raw = unit === 'minutes' ? minutesToSeconds(secondsOrMinutes) : secondsOrMinutes;
  const parsed = parseDurationSeconds(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  try {
    const updated = await options.adjust(session.id, parsed.seconds, { reason: options.reason || '' });
    if (!updated || updated.durationSeconds === undefined) {
      return { ok: false, error: '校正未被主进程确认，请重试' };
    }
    return { ok: true, error: '', session: updated };
  } catch (error) {
    return { ok: false, error: (error && error.message) || '工作时长校正失败' };
  }
}

/**
 * 关闭窗口确认界面的三个操作（P1-01 阶段 E）。
 *
 * 必须准确区分，不能含糊：
 * - back  返回工作：取消关闭，当前工作继续，窗口保持可用
 * - end   结束工作：走现有结束 Session 流程，保存成功后才关闭应用
 * - keep  保留会话并退出：允许关闭，会话保持未结束，下次启动必须提示处理
 */
export const CLOSE_ACTIONS = ['back', 'end', 'keep'];

/**
 * 主进程询问"如何处理正在进行的工作"时的判定。
 * 没有正在进行的会话时不弹确认框，按正常关闭放行。
 *
 * @returns {'confirm'|'proceed'} confirm = 显示确认界面；proceed = 直接允许关闭
 */
export function decideCloseAction(activeSession) {
  if (!activeSession) return 'proceed';
  if (activeSession.endedAt) return 'proceed';
  return 'confirm';
}

/**
 * 用户点击某个关闭操作后，窗口是否应该被放行关闭。
 * 只有"结束工作保存成功"与"保留会话并退出"允许真正退出。
 *
 * @param {'back'|'end'|'keep'} action
 * @param {boolean} savedOk "结束工作"的保存是否成功
 */
export function shouldExitAfterClose(action, savedOk) {
  if (action === 'keep') return true;
  if (action === 'end') return savedOk === true;
  return false;
}

/** 把 UI 动作翻译成主进程需要的回执 */
export function toCloseResponse(action) {
  if (action === 'keep') return 'exit';
  if (action === 'end') return 'exit';
  return 'cancel';
}
