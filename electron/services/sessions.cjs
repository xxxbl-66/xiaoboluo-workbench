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
 */
function endSession(store, sessionId, patch = {}) {
  const items = readSessions(store);
  const index = items.findIndex((item) => item.id === sessionId);
  if (index === -1) throw new Error('工作记录不存在');

  const session = items[index];
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

module.exports = {
  FILE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isActive,
  readSessions,
  writeSessions,
  listSessions,
  getActiveSession,
  findSession,
  startSession,
  endSession,
  updateSession,
  deleteSession,
  lastFinishedSession,
  summarizeSessions,
  totalsByWorkspace,
  assertTodosInScope
};
