const workspaceService = require('./workspaces.cjs');
const sessionService = require('./sessions.cjs');

/**
 * Workspace 概览：所有统计都在运行时计算，不写回 workspaces.json。
 * 这样可以避免"缓存的计数与真实数据不一致"。
 */

const LAST_SESSION_FIELDS = [
  'id',
  'workspaceId',
  'startedAt',
  'endedAt',
  'durationSeconds',
  'dateKey',
  'note',
  'nextStep',
  'completedTodoIds'
];

function pickLastSession(session) {
  if (!session) return null;
  const picked = {};
  for (const field of LAST_SESSION_FIELDS) {
    picked[field] = session[field] === undefined ? null : session[field];
  }
  return picked;
}

function countTodos(todos, workspaceId) {
  let pending = 0;
  let done = 0;
  for (const todo of todos) {
    if (!todo || typeof todo !== 'object') continue;
    if (workspaceService.normalizeWorkspaceId(todo.workspaceId) !== workspaceId) continue;
    if (todo.completed === true) done += 1;
    else pending += 1;
  }
  return { pendingTodoCount: pending, doneTodoCount: done, todoCount: pending + done };
}

function decorate(workspace, todos, totals, lastSession, activeSession) {
  const counts = countTodos(todos, workspace.id);
  const last = pickLastSession(lastSession);
  return {
    ...workspace,
    ...counts,
    totalSeconds: totals.get(workspace.id) || 0,
    lastSession: last,
    lastWorkedAt: last ? last.endedAt || last.startedAt : null,
    isWorking: Boolean(activeSession && activeSession.workspaceId === workspace.id)
  };
}

/**
 * @param {*} store DataStore
 * @param {Array} todos 当前全部待办（由调用方提供，避免重复读盘）
 * @param {{includeArchived?:boolean, limit?:number}} options
 */
function listWorkspaceOverview(store, todos, options = {}) {
  const opts = options || {};
  const workspaces = workspaceService.listWorkspaces(store, {
    includeArchived: Boolean(opts.includeArchived)
  });
  const totals = sessionService.totalsByWorkspace(store);
  const sessions = sessionService.listSessions(store, { limit: sessionService.MAX_LIMIT });
  const activeSession = sessions.find((item) => sessionService.isActive(item)) || null;

  const overview = workspaces.map((workspace) => {
    const lastSession = sessions.find((item) => (
      !sessionService.isActive(item)
      && workspaceService.normalizeWorkspaceId(item.workspaceId) === workspace.id
    )) || null;
    return decorate(workspace, todos, totals, lastSession, activeSession);
  });

  const limit = Number(opts.limit);
  if (Number.isFinite(limit) && limit > 0) return overview.slice(0, Math.floor(limit));
  return overview;
}

/** Dashboard"最近工作空间"：按 lastOpenedAt 排序，其次按最近工作时间为准 */
function recentWorkspaces(store, todos, limit = 3) {
  const overview = listWorkspaceOverview(store, todos);
  const sorted = [...overview].sort((left, right) => {
    const leftTime = new Date(left.lastOpenedAt || left.lastWorkedAt || left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.lastOpenedAt || right.lastWorkedAt || right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
  return sorted.slice(0, Math.max(0, Number(limit) || 0));
}

module.exports = { listWorkspaceOverview, recentWorkspaces, pickLastSession };
