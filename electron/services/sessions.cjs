const { id } = require('../defaults.cjs');
const { localDateKey, elapsedSeconds } = require('../dates.cjs');
const { normalizeWorkspaceId } = require('./workspaces.cjs');

const FILE = 'work-sessions.json';

/** 默认返回条数上限：不把全部历史推给渲染层 */
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 2000;

function readSessions(store) {
  const items = store.read(FILE, []);
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
}

function writeSessions(store, items) {
  store.write(FILE, items);
}

/** endedAt 缺失 / null / 空串 都视为"仍在进行中" */
function isActive(session) {
  if (!session) return false;
  return session.endedAt === null || session.endedAt === undefined || session.endedAt === '';
}

function timeValue(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortByStartDesc(items) {
  return [...items].sort((left, right) => timeValue(right.startedAt) - timeValue(left.startedAt));
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}

/**
 * 列表查询。所有过滤条件都是可选的：
 * @param {{workspaceId?:string|null, dateKey?:string, from?:string, to?:string, limit?:number, includeActive?:boolean}} options
 */
function listSessions(store, options = {}) {
  const opts = options || {};
  let items = sortByStartDesc(readSessions(store));

  if (Object.prototype.hasOwnProperty.call(opts, 'workspaceId')) {
    const target = normalizeWorkspaceId(opts.workspaceId);
    items = items.filter((item) => normalizeWorkspaceId(item.workspaceId) === target);
  }
  if (opts.dateKey) {
    items = items.filter((item) => item.dateKey === opts.dateKey);
  }
  if (opts.from) {
    const from = timeValue(opts.from);
    items = items.filter((item) => timeValue(item.startedAt) >= from);
  }
  if (opts.to) {
    const to = timeValue(opts.to);
    items = items.filter((item) => timeValue(item.startedAt) <= to);
  }

  return items.slice(0, clampLimit(opts.limit));
}

function getActiveSession(store) {
  return readSessions(store).find((item) => isActive(item)) || null;
}

function findSession(store, sessionId) {
  return readSessions(store).find((item) => item.id === sessionId) || null;
}

/**
 * 开始一次工作会话。
 * 全局同一时间只允许一个 active session；已有则返回明确状态，不静默新建第二条。
 */
function startSession(store, workspaceId) {
  const items = readSessions(store);
  const active = items.find((item) => isActive(item));
  if (active) {
    return { started: false, reason: 'active-exists', session: active };
  }

  const now = new Date();
  const iso = now.toISOString();
  const entry = {
    id: id(),
    workspaceId: normalizeWorkspaceId(workspaceId),
    startedAt: iso,
    endedAt: null,
    durationSeconds: 0,
    dateKey: localDateKey(now),
    note: '',
    nextStep: '',
    completedTodoIds: [],
    createdAt: iso,
    updatedAt: iso
  };

  items.push(entry);
  writeSessions(store, items);
  return { started: true, session: entry };
}

function normalizeTodoIds(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const text = entry === undefined || entry === null ? '' : String(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

/**
 * 校验 completedTodoIds 是否都属于该 Session 自己的 workspaceId 作用域。
 *
 * 结束"另一个 Workspace 正在进行的工作"时，界面过去会按当前浏览的 Workspace
 * 加载 Todo，把 B 的 Todo 写进 A 的 Session，污染快照与今日复盘。
 * 这里在主进程把归属钉死：任一 Todo 不属于该 Session 的工作空间就整体拒绝，
 * 不做静默过滤，避免出现"一半合法一半被丢掉"的难以察觉的数据污染。
 */
function assertTodosInScope(session, todos, completedTodoIds) {
  const ids = normalizeTodoIds(completedTodoIds);
  if (!ids || !ids.length) return [];

  const scope = normalizeWorkspaceId(session && session.workspaceId);
  const byId = new Map(
    (Array.isArray(todos) ? todos : [])
      .filter((todo) => todo && todo.id)
      .map((todo) => [todo.id, todo])
  );

  const invalid = [];
  for (const id of ids) {
    const todo = byId.get(id);
    if (!todo) {
      invalid.push(`${id}（待办不存在）`);
      continue;
    }
    if (normalizeWorkspaceId(todo.workspaceId) !== scope) {
      invalid.push(`${id}（不属于本次工作的工作空间）`);
    }
  }

  if (invalid.length) {
    throw new Error(`以下待办不属于本次工作的范围，已阻止保存：${invalid.join('、')}`);
  }
  return ids;
}

/**
 * 结束会话。
 * durationSeconds 依据 startedAt 与结束时刻的真实时间差计算，不依赖前端计时器。
 *
 * 已结束的会话不能被普通 end 再次覆盖：否则异常重启后的"保留并退出"流程里，
 * 一次误调用就能把用户校正过的有效时长重新改回虚高的墙上时间。
 * 需要修正已结束记录请使用 adjustSessionDuration（有界、可审计）。
 */
function endSession(store, sessionId, patch = {}) {
  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');

  const session = items[index];
  if (!isActive(session)) {
    throw new Error('这次工作已经结束，无需重复结束');
  }

  const now = new Date();
  const iso = now.toISOString();
  const duration = elapsedSeconds(session.startedAt, iso);
  const todoIds = normalizeTodoIds(patch.completedTodoIds);

  const next = {
    ...session,
    endedAt: iso,
    durationSeconds: duration,
    note: patch.note === undefined ? String(session.note || '') : String(patch.note || ''),
    nextStep: patch.nextStep === undefined ? String(session.nextStep || '') : String(patch.nextStep || ''),
    completedTodoIds: todoIds || (Array.isArray(session.completedTodoIds) ? session.completedTodoIds : []),
    updatedAt: iso
  };

  items[index] = next;
  writeSessions(store, items);
  return next;
}

/**
 * 用户明确选择"继续这段未结束的工作"。
 *
 * 只记录一次 resumedAt 作为审计痕迹，不新建会话、不修改 startedAt。
 * 离线期间无法判断用户是否真的在工作，因此计时仍以 startedAt 为准，
 * UI 必须明确告知这一点（不得声称系统能自动识别离开电脑的时间）。
 */
function resumeSession(store, sessionId) {
  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');

  const session = items[index];
  if (!isActive(session)) {
    throw new Error('这段工作已经结束，不需要继续');
  }

  const iso = new Date().toISOString();
  const next = {
    ...session,
    resumedAt: iso,
    // 首次继续时才写，保留"第一次发现它未结束"的时间线索
    resumeCount: Math.max(0, Math.round(Number(session.resumeCount) || 0)) + 1,
    updatedAt: iso
  };

  items[index] = next;
  writeSessions(store, items);
  return next;
}

/**
 * 更新会话的可变字段。id / startedAt / createdAt 受保护。
 * endedAt 与 durationSeconds 由 endSession 负责，这里只允许修正文字内容。
 */
function updateSession(store, sessionId, patch = {}) {
  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');

  const current = items[index];
  const next = { ...current };

  if (patch.note !== undefined) next.note = String(patch.note || '');
  if (patch.nextStep !== undefined) next.nextStep = String(patch.nextStep || '');
  if (patch.completedTodoIds !== undefined) {
    next.completedTodoIds = normalizeTodoIds(patch.completedTodoIds) || [];
  }
  if (patch.workspaceId !== undefined) next.workspaceId = normalizeWorkspaceId(patch.workspaceId);

  next.id = current.id;
  next.startedAt = current.startedAt;
  next.createdAt = current.createdAt;
  next.updatedAt = new Date().toISOString();

  items[index] = next;
  writeSessions(store, items);
  return next;
}

function deleteSession(store, sessionId) {
  const items = readSessions(store);
  if (!items.some((item) => item.id === sessionId)) throw new Error('工作记录不存在');
  writeSessions(store, items.filter((item) => item.id !== sessionId));
  return true;
}

/** 某个 workspace 最近一次【已结束】的会话（用于"继续上次工作"） */
function lastFinishedSession(store, workspaceId) {
  const target = normalizeWorkspaceId(workspaceId);
  const finished = sortByStartDesc(readSessions(store)).filter((item) => (
    !isActive(item) && normalizeWorkspaceId(item.workspaceId) === target
  ));
  return finished[0] || null;
}

function sumDuration(items) {
  return items.reduce((total, item) => {
    const value = Number(item.durationSeconds);
    return total + (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
  }, 0);
}

/**
 * 会话汇总（供今日复盘 / Dashboard 使用）。
 * options.dateKey 省略时按今天统计。
 */
function summarizeSessions(store, options = {}) {
  const opts = options || {};
  const dateKey = opts.dateKey || localDateKey(new Date());
  const sessions = sortByStartDesc(readSessions(store));

  const todayItems = sessions.filter((item) => item.dateKey === dateKey);
  const finishedToday = todayItems.filter((item) => !isActive(item));

  const grouped = new Map();
  for (const item of finishedToday) {
    const key = normalizeWorkspaceId(item.workspaceId) || '';
    if (!grouped.has(key)) grouped.set(key, { workspaceId: key || null, seconds: 0, sessionCount: 0 });
    const bucket = grouped.get(key);
    bucket.seconds += Math.max(0, Math.round(Number(item.durationSeconds) || 0));
    bucket.sessionCount += 1;
  }

  const completedTodoIds = [];
  const seen = new Set();
  for (const item of finishedToday) {
    for (const todoId of Array.isArray(item.completedTodoIds) ? item.completedTodoIds : []) {
      const text = String(todoId);
      if (seen.has(text)) continue;
      seen.add(text);
      completedTodoIds.push(text);
    }
  }

  return {
    dateKey,
    totalSeconds: sumDuration(finishedToday),
    sessionCount: finishedToday.length,
    activeSessionCount: todayItems.length - finishedToday.length,
    completedTodoIds,
    completedTodoCount: completedTodoIds.length,
    byWorkspace: [...grouped.values()].map((bucket) => ({
      ...bucket,
      lastSession: lastFor(bucket.workspaceId, finishedToday)
    }))
  };
}

function lastFor(workspaceId, pool) {
  const target = normalizeWorkspaceId(workspaceId);
  return pool.find((item) => normalizeWorkspaceId(item.workspaceId) === target) || null;
}

/** 按 workspaceId 汇总全部历史时长（Workspace 概览用，运行时计算） */
function totalsByWorkspace(store) {
  const totals = new Map();
  for (const item of readSessions(store)) {
    if (isActive(item)) continue;
    const key = normalizeWorkspaceId(item.workspaceId);
    if (!key) continue;
    const seconds = Math.max(0, Math.round(Number(item.durationSeconds) || 0));
    totals.set(key, (totals.get(key) || 0) + seconds);
  }
  return totals;
}

/* ------------------------------------------------------------------ *
 * 有效工作时长校正（P1-01）
 *
 * 产品规则：用户可能忘记结束工作，或应用异常退出导致时长包含离线时段。
 * 本轮只校正"有效工作时长"，不开发计时区间编辑器，也不引入暂停状态机。
 *
 * 安全规则（全部在服务层强制，UI 只是第一道提示）：
 * - 只有已结束的会话可以校正（active 会话必须先正常结束）
 * - 时长必须是有限、非负、不超过 MAX_ADJUSTABLE_SECONDS 的整数
 * - 拒绝 NaN / Infinity / 负数 / 非数字字符串 / 数组 / 对象
 * - 校正接口只写 durationSeconds 与审计字段，
 *   绝不允许改 workspaceId、completedTodoIds、startedAt、endedAt、dateKey
 * ------------------------------------------------------------------ */

/** 单次工作的合理上限：7 天。超过几乎一定是误输入或跨设备时间错误 */
const MAX_ADJUSTABLE_SECONDS = 7 * 24 * 60 * 60;

/**
 * 校验用户输入的有效工作时长。
 * @returns {{ok:true, seconds:number} | {ok:false, error:string}}
 */
function validateDurationSeconds(value) {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { ok: false, error: '工作时长不能是 NaN' };
    if (!Number.isFinite(value)) return { ok: false, error: '工作时长必须是有限的数字' };
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return { ok: false, error: '请输入有效的工作时长' };
    if (!/^\d+$/.test(text)) {
      return { ok: false, error: '工作时长必须是非负整数（秒）' };
    }
  } else {
    return { ok: false, error: '工作时长必须是数字' };
  }

  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return { ok: false, error: '工作时长必须是有限的数字' };
  if (seconds < 0) return { ok: false, error: '工作时长不能为负数' };
  if (seconds > MAX_ADJUSTABLE_SECONDS) {
    return { ok: false, error: `工作时长不能超过 ${Math.round(MAX_ADJUSTABLE_SECONDS / 3600)} 小时` };
  }
  return { ok: true, seconds };
}

/**
 * 校正一个【已结束】会话的有效工作时长，并保留可追踪的校正记录。
 *
 * 审计字段（全部可选，老记录没有也能正常读取）：
 * - durationAdjustedAt：本次校正时间
 * - durationAdjustmentReason：用户填写的说明（可选）
 * - originalDurationSeconds：首次校正前的机器计算时长（只写一次）
 * - previousDurationSeconds：上一次被覆盖掉的时长（重复校正时可追踪）
 * - durationAdjustmentCount：累计校正次数
 * - durationAdjustedBy：固定为 'user'，方便将来区分系统自动校正
 *
 * startedAt / endedAt / workspaceId / completedTodoIds / dateKey 一律不动：
 * 校正只表达"这段时间里有效工作多久"，不改变归属和归属日期。
 */
function adjustSessionDuration(store, sessionId, seconds, options = {}) {
  const checked = validateDurationSeconds(seconds);
  if (!checked.ok) throw new Error(checked.error);

  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');

  const session = items[index];
  if (isActive(session)) {
    throw new Error('这次工作还没有结束，请先结束再校正时长');
  }

  const now = new Date();
  const iso = now.toISOString();
  const previous = Math.max(0, Math.round(Number(session.durationSeconds) || 0));
  const reason = options.reason === undefined || options.reason === null
    ? ''
    : String(options.reason).slice(0, 200);
  const count = Math.max(0, Math.round(Number(session.durationAdjustmentCount) || 0)) + 1;
  const original = Number.isFinite(Number(session.originalDurationSeconds))
    ? Math.max(0, Math.round(Number(session.originalDurationSeconds)))
    : previous;

  const next = {
    ...session,
    // 只允许改这一个业务字段 + 审计字段
    durationSeconds: checked.seconds,
    originalDurationSeconds: original,
    previousDurationSeconds: previous,
    durationAdjustmentCount: count,
    durationAdjustedAt: iso,
    durationAdjustmentReason: reason,
    durationAdjustedBy: 'user',
    updatedAt: iso
  };

  // 显式钉住不允许被校正接口改动的字段
  next.id = session.id;
  next.workspaceId = session.workspaceId;
  next.startedAt = session.startedAt;
  next.endedAt = session.endedAt;
  next.dateKey = session.dateKey;
  next.completedTodoIds = Array.isArray(session.completedTodoIds) ? session.completedTodoIds : [];

  items[index] = next;
  writeSessions(store, items);
  return next;
}

/** 一次写盘完成异常恢复的结束与时长校正；校验失败时保持原会话 active。 */
function endAndAdjustSessionDuration(store, sessionId, seconds, options = {}) {
  const checked = validateDurationSeconds(seconds);
  if (!checked.ok) throw new Error(checked.error);

  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');
  const session = items[index];
  if (!isActive(session)) throw new Error('这次工作已经结束，无需重复结束');

  const iso = new Date().toISOString();
  const originalDuration = elapsedSeconds(session.startedAt, iso);
  const reason = options.reason === undefined || options.reason === null
    ? '' : String(options.reason).slice(0, 200);
  const next = {
    ...session,
    endedAt: iso,
    durationSeconds: checked.seconds,
    originalDurationSeconds: originalDuration,
    previousDurationSeconds: originalDuration,
    durationAdjustmentCount: 1,
    durationAdjustedAt: iso,
    durationAdjustmentReason: reason,
    durationAdjustedBy: 'user',
    updatedAt: iso
  };
  items[index] = next;
  writeSessions(store, items);
  return next;
}

/** 会话是否发生过时长校正（老记录没有这些字段时为 false） */
function wasDurationAdjusted(session) {
  if (!session) return false;
  if (Number(session.durationAdjustmentCount) > 0) return true;
  return Boolean(session.durationAdjustedAt);
}

module.exports = {
  FILE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_ADJUSTABLE_SECONDS,
  isActive,
  readSessions,
  writeSessions,
  listSessions,
  getActiveSession,
  findSession,
  startSession,
  endSession,
  resumeSession,
  updateSession,
  deleteSession,
  lastFinishedSession,
  summarizeSessions,
  totalsByWorkspace,
  assertTodosInScope,
  validateDurationSeconds,
  adjustSessionDuration,
  endAndAdjustSessionDuration,
  wasDurationAdjusted
};
