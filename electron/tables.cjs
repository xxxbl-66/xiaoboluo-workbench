/**
 * 数据表权威清单（单一事实来源）。
 *
 * 用途：
 * 1. 备份导入的白名单与根类型校验
 * 2. 迁移时的结构校验与安全修复默认值
 * 3. DataStore 读路径的结构守卫
 *
 * 这里的 kind 必须与各表真实的 store.read(name, default) 默认值一致：
 * 数组表默认是 []，对象表默认是 {} 形态的字面量。
 */

const path = require('node:path');
const { defaultGroups, defaultSettings } = require('./defaults.cjs');

const READER_DEFAULTS = {
  prefs: {
    fontSize: 18,
    lineHeight: 1.9,
    fontFamily: 'system',
    theme: 'light'
  },
  progress: {}
};

/** 每张表的根类型与"安全重建默认值" */
const TABLES = {
  'app-groups.json': { kind: 'array', defaults: () => defaultGroups() },
  'apps.json': { kind: 'array', defaults: () => [] },
  'book-categories.json': { kind: 'array', defaults: () => [] },
  'bookmarks.json': { kind: 'array', defaults: () => [] },
  'books.json': { kind: 'array', defaults: () => [] },
  'book-stores.json': { kind: 'array', defaults: () => [] },
  'calendar-events.json': { kind: 'array', defaults: () => [] },
  'checkins.json': { kind: 'array', defaults: () => [] },
  'daily-review.json': { kind: 'array', defaults: () => [] },
  'files.json': { kind: 'array', defaults: () => [] },
  'goals.json': { kind: 'array', defaults: () => [] },
  'images.json': { kind: 'array', defaults: () => [] },
  'notes.json': { kind: 'array', defaults: () => [] },
  'todos.json': { kind: 'array', defaults: () => [] },
  'workflows.json': { kind: 'array', defaults: () => [] },
  'workspaces.json': { kind: 'array', defaults: () => [] },
  'work-sessions.json': { kind: 'array', defaults: () => [] },
  'meta.json': { kind: 'object', defaults: () => ({ schemaVersion: 0, updatedAt: null }) },
  'reader.json': { kind: 'object', defaults: () => structuredClone(READER_DEFAULTS) },
  'settings.json': { kind: 'object', defaults: () => defaultSettings() }
};

/** Windows 保留设备名：即使带 .json 后缀也不允许 */
const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

function tableNames() {
  return Object.keys(TABLES);
}

function isKnownTable(name) {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}

function tableKind(name) {
  const spec = TABLES[name];
  return spec ? spec.kind : null;
}

/** 取某张表的安全默认值（用于结构损坏后重建） */
function defaultsFor(name) {
  const spec = TABLES[name];
  if (!spec) return undefined;
  return spec.defaults();
}

/** 值的根形态：array / object / primitive */
function shapeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value !== null && typeof value === 'object') return 'object';
  return 'primitive';
}

/** 结构是否符合该表的根类型 */
function matchesKind(name, value) {
  const kind = tableKind(name);
  if (!kind) return false;
  return shapeOf(value) === kind;
}

/**
 * 文件名是否是可安全写入 data 目录的已知表名。
 * 拒绝：未知表、路径分隔符、子目录、ADS（冒号）、尾点/尾空格、Windows 保留设备名。
 */
function isSafeTableName(name, dataDir) {
  if (typeof name !== 'string' || !name) return false;
  if (!isKnownTable(name)) return false;
  if (name !== path.basename(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.includes(':') || name.includes('\0')) return false;
  if (name.endsWith('.') || name.endsWith(' ')) return false;

  const stem = name.slice(0, name.length - '.json'.length).toUpperCase();
  if (WINDOWS_RESERVED.has(stem)) return false;

  if (dataDir) {
    const base = path.resolve(dataDir);
    const target = path.resolve(base, name);
    if (target === base) return false;
    if (!target.startsWith(base + path.sep)) return false;
  }
  return true;
}

module.exports = {
  READER_DEFAULTS,
  TABLES,
  tableNames,
  isKnownTable,
  tableKind,
  defaultsFor,
  shapeOf,
  matchesKind,
  isSafeTableName
};
