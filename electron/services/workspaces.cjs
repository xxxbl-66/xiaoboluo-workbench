const { id } = require('../defaults.cjs');

const FILE = 'workspaces.json';

/** 归属关系使用单值外键：null / 缺失 等价于"未归类" */
function normalizeWorkspaceId(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function readWorkspaces(store) {
  const items = store.read(FILE, []);
  return Array.isArray(items) ? items.filter((item) => item && typeof item === 'object') : [];
}

function writeWorkspaces(store, items) {
  store.write(FILE, items);
}

function findWorkspace(store, workspaceId) {
  const target = normalizeWorkspaceId(workspaceId);
  if (!target) return null;
  return readWorkspaces(store).find((item) => item.id === target) || null;
}

function sortValue(item) {
  const value = Number(item.sort);
  return Number.isFinite(value) ? value : 0;
}

function sortWorkspaces(items) {
  return [...items].sort((left, right) => {
    const diff = sortValue(left) - sortValue(right);
    if (diff !== 0) return diff;
    return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
  });
}

/**
 * 列表：默认只返回未归档。
 * options.includeArchived === true 时包含归档项。
 */
function listWorkspaces(store, options = {}) {
  const includeArchived = Boolean(options && options.includeArchived);
  const items = readWorkspaces(store);
  const filtered = includeArchived ? items : items.filter((item) => item.archived !== true);
  return sortWorkspaces(filtered);
}

function sanitizeWorkflowIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    const text = normalizeWorkspaceId(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeName(value) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text;
}

function normalizeColor(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : '#3b82f6';
}

function createWorkspace(store, input = {}) {
  const name = normalizeName(input.name);
  if (!name) throw new Error('请填写工作空间名称');

  const workflowIds = sanitizeWorkflowIds(input.workflowIds);
  const resumeCandidate = normalizeWorkspaceId(input.resumeWorkflowId);
  const now = new Date().toISOString();

  const entry = {
    id: id(),
    name,
    description: String(input.description || ''),
    color: normalizeColor(input.color),
    sort: Date.now(),
    archived: false,
    workflowIds,
    resumeWorkflowId: workflowIds.includes(resumeCandidate) ? resumeCandidate : null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };

  const items = readWorkspaces(store);
  items.push(entry);
  writeWorkspaces(store, items);
  return entry;
}

/**
 * 更新：禁止修改 id / createdAt。
 * 允许 name / description / color / archived / workflowIds / resumeWorkflowId / sort / lastOpenedAt。
 */
function updateWorkspace(store, workspaceId, patch = {}) {
  const items = readWorkspaces(store);
  const index = items.findIndex((item) => item.id === workspaceId);
  if (index === -1) throw new Error('工作空间不存在');

  const current = items[index];
  const next = { ...current };

  if (patch.name !== undefined) {
    const name = normalizeName(patch.name);
    if (!name) throw new Error('请填写工作空间名称');
    next.name = name;
  }
  if (patch.description !== undefined) next.description = String(patch.description || '');
  if (patch.color !== undefined) next.color = normalizeColor(patch.color);
  if (patch.archived !== undefined) next.archived = patch.archived === true;
  if (patch.sort !== undefined && Number.isFinite(Number(patch.sort))) next.sort = Number(patch.sort);
  if (patch.lastOpenedAt !== undefined) {
    next.lastOpenedAt = patch.lastOpenedAt ? String(patch.lastOpenedAt) : null;
  }

  const workflowIds = patch.workflowIds === undefined ? next.workflowIds || [] : sanitizeWorkflowIds(patch.workflowIds);
  next.workflowIds = workflowIds;

  const resumeSource = patch.resumeWorkflowId === undefined ? next.resumeWorkflowId : patch.resumeWorkflowId;
  const resume = normalizeWorkspaceId(resumeSource);
  // 约束：resumeWorkflowId 必须属于 workflowIds
  next.resumeWorkflowId = resume && workflowIds.includes(resume) ? resume : null;

  next.id = current.id;
  next.createdAt = current.createdAt;
  next.updatedAt = new Date().toISOString();

  items[index] = next;
  writeWorkspaces(store, items);
  return next;
}

/** 归档 / 恢复。归档不删除任何关联数据。 */
function archiveWorkspace(store, workspaceId, archived = true) {
  return updateWorkspace(store, workspaceId, { archived: archived === true });
}

function reorderWorkspaces(store, orderedIds) {
  const items = readWorkspaces(store);
  const ids = Array.isArray(orderedIds) ? orderedIds.map((value) => String(value)) : [];
  const map = new Map(ids.map((value, index) => [value, index]));
  let changed = false;
  for (const item of items) {
    if (!map.has(item.id)) continue;
    const nextSort = map.get(item.id);
    if (item.sort !== nextSort) {
      item.sort = nextSort;
      changed = true;
    }
  }
  if (changed) writeWorkspaces(store, items);
  return listWorkspaces(store);
}

/** 进入工作空间时更新最近打开时间 */
function touchWorkspace(store, workspaceId) {
  const items = readWorkspaces(store);
  const index = items.findIndex((item) => item.id === workspaceId);
  if (index === -1) throw new Error('工作空间不存在');
  const now = new Date().toISOString();
  items[index] = { ...items[index], lastOpenedAt: now, updatedAt: now };
  writeWorkspaces(store, items);
  return items[index];
}

/**
 * 物理删除（内部能力，普通 UI 不暴露）。
 * 只解绑关联数据，不删除关联数据本身。
 */
function deleteWorkspace(store, workspaceId) {
  const target = normalizeWorkspaceId(workspaceId);
  if (!target) throw new Error('工作空间不存在');
  const items = readWorkspaces(store);
  if (!items.some((item) => item.id === target)) throw new Error('工作空间不存在');
  writeWorkspaces(store, items.filter((item) => item.id !== target));
  return { id: target };
}

module.exports = {
  FILE,
  normalizeWorkspaceId,
  readWorkspaces,
  writeWorkspaces,
  findWorkspace,
  listWorkspaces,
  sortWorkspaces,
  createWorkspace,
  updateWorkspace,
  archiveWorkspace,
  reorderWorkspaces,
  touchWorkspace,
  deleteWorkspace
};
