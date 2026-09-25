/**
 * 快速便签保存控制器（渲染层与测试共用的单一事实来源）。
 *
 * 背景（审查报告 P1-03）：
 * 组件用 450ms 防抖保存，但卸载时只在 `quickContent` 非空才 flush。
 * 用户把便签全部删成空字符串后立即切页：
 * 1. 防抖定时器被 clearTimeout 取消，没有保存；
 * 2. 卸载钩子因为内容为空直接跳过；
 * 3. notes.json 里还是旧内容，下次打开"清空"白做了。
 *
 * 这里的规则：
 * - 空字符串是合法内容，是否需要保存只看"有没有未保存的变更"（dirty）；
 * - 卸载 / 切页时只要有未保存变更就立刻 flush，内容为空也一样写；
 * - 慢请求返回时如果用户已经改了内容，不能把"已保存"错误地标成最新；
 * - 保存失败不能清除未保存状态，必须重试并给出可见反馈。
 *
 * 这个模块不依赖 Vue、不依赖 window，因此可以被 node:test 直接覆盖。
 */

export const DEFAULT_DEBOUNCE_MS = 450;

/** 便签内容规范化：null / undefined 等价于空串，其余转成字符串 */
export function normalizeQuickNoteContent(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
}

/**
 * @param {{
 *   getContent: () => string,
 *   save: (content:string) => Promise<any>,
 *   onStatusChange?: (status:{status:string, dirty:boolean, error:string}) => void,
 *   delayMs?: number,
 *   now?: () => number
 * }} options
 */
export function createQuickNoteSaver(options) {
  const getContent = options.getContent;
  const save = options.save;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : DEFAULT_DEBOUNCE_MS;

  let timer = null;
  let dirty = false;
  let status = 'idle';
  let error = '';
  let revision = 0;
  let savedRevision = 0;
  let inFlight = null;

  function report() {
    if (typeof options.onStatusChange === 'function') {
      try {
        options.onStatusChange({ status, dirty, error });
      } catch (_) {
        // 状态回调自身异常不影响保存流程
      }
    }
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delay) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, delay === undefined ? delayMs : delay);
  }

  /** 标记"内容变了"：无论内容是否为空，都必须保存 */
  function markChanged() {
    revision += 1;
    dirty = true;
    error = '';
    status = 'pending';
    report();
    schedule();
  }

  async function performSave() {
    const savingRevision = revision;
    const content = normalizeQuickNoteContent(getContent());
    status = 'saving';
    report();
    try {
      await save(content);
      // 请求返回时如果用户又改过内容，就不能宣称"已经保存最新内容"
      if (revision === savingRevision) {
        savedRevision = savingRevision;
        dirty = false;
        error = '';
        status = 'saved';
      } else {
        dirty = true;
        status = 'pending';
      }
      report();
      return { ok: true };
    } catch (err) {
      dirty = true;
      error = (err && err.message) || '便签保存失败';
      status = 'error';
      report();
      return { ok: false, error };
    }
  }

  /**
   * 立刻把未保存的变更写盘。
   *
   * - 已有请求在飞时返回同一个 Promise（不会并发写同一个便签）
   * - 请求结束后如果仍然 dirty（期间又改了内容）会自动补写
   * - 连续失败不会无限递归：最多补写 maxRounds 次，其余交给用户重试
   */
  function flush(maxRounds = 4) {
    clearTimer();
    if (inFlight) return inFlight;
    if (!dirty) return Promise.resolve({ ok: true, skipped: true });

    const run = async () => {
      let result = { ok: true, skipped: true };
      let rounds = 0;
      while (dirty && rounds < maxRounds) {
        rounds += 1;
        result = await performSave();
        if (!result.ok) break;
      }
      inFlight = null;
      return result;
    };

    inFlight = run();
    return inFlight;
  }

  /**
   * 卸载 / 切页时的兜底：先把未保存的变更写盘，失败时再补一次。
   * 不做无限重试，剩下的交给用户下次编辑或显式重试。
   */
  function flushWithRetry() {
    return flush().then((result) => (result && result.ok === false ? flush(1) : result));
  }

  return {
    markChanged,
    flush,
    flushWithRetry,
    clearTimer,
    get status() {
      return status;
    },
    get dirty() {
      return dirty;
    },
    get error() {
      return error;
    },
    get lastSavedRevision() {
      return savedRevision;
    },
    get revision() {
      return revision;
    },
    /** 仅供测试：当前是否有防抖定时器在等待 */
    get hasPendingTimer() {
      return timer !== null;
    }
  };
}
