/**
 * 保存结果判定（渲染层与测试共用的单一事实来源）。
 *
 * 背景（审查报告 P1-02）：
 * 复盘与设置的保存链路过去在 catch 里把错误吞掉，返回 null / undefined，
 * 上层却无条件提示"已保存"。用户以为写盘成功，实际数据丢了。
 *
 * 这里的规则是唯一的判定入口，组件不得绕过它自己判断"成功"：
 * 1. preload 的 invoke 在 {ok:false} 时会 reject，所以走到 catch 就是失败；
 * 2. 即使调用没有抛错，返回值也必须明确表示写盘成功，才允许显示成功提示；
 * 3. 失败时返回 {ok:false, error}，由调用方保留用户输入并提供重试。
 */

/** 把任意错误值转成用户可读的中文提示 */
export function describeError(error, fallback = '保存失败，请重试') {
  if (!error) return fallback;
  if (typeof error === 'string') return error.trim() || fallback;
  const message = typeof error.message === 'string' ? error.message.trim() : '';
  return message || fallback;
}

/**
 * 主进程 / 服务层返回的写盘结果是否可信。
 *
 * - 返回对象：只有显式的 `ok === true` 才算成功
 *   （包括 {ok:true,data:...} 这种 IPC 包装与 {ok:true, record:...} 这种服务结果）
 * - 返回数组 / 标量：服务层直接回传写入后的数据，视为成功
 * - null / undefined：视为失败。这正是 P1-02 的返回形态，绝不能算成功
 */
export function isConfirmedSave(result) {
  if (result === null || result === undefined) return false;
  if (typeof result !== 'object') return true;
  if (Array.isArray(result)) return true;
  if (Object.prototype.hasOwnProperty.call(result, 'ok')) return result.ok === true;
  return true;
}

/**
 * 执行一次真实保存，并给出明确成功 / 失败结论。
 *
 * @param {() => Promise<any>} run 真正调用 IPC 的函数
 * @param {{fallback?: string, onResult?: (result:{ok:boolean,error:string}) => void}} options
 * @returns {Promise<{ok:boolean, error:string, data?:any}>} 永不抛错，调用方据 ok 决定是否提示成功
 */
export async function runSave(run, options = {}) {
  const fallback = options.fallback || '保存失败，请重试';
  let outcome;
  try {
    const data = await run();
    if (isConfirmedSave(data)) {
      outcome = { ok: true, error: '', data };
    } else if (data && typeof data === 'object' && typeof data.error === 'string' && data.error.trim()) {
      // 服务层已经给出明确原因（{ok:false, error}）：原样透出，不要吞成通用提示
      outcome = { ok: false, error: data.error.trim() };
    } else {
      outcome = { ok: false, error: `${fallback}（主进程没有确认写入）` };
    }
  } catch (error) {
    outcome = { ok: false, error: describeError(error, fallback) };
  }
  if (typeof options.onResult === 'function') {
    try {
      options.onResult(outcome);
    } catch (_) {
      // 通知回调自身的异常不能反过来污染保存结论
    }
  }
  return outcome;
}
