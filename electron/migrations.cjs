const fs = require('node:fs');
const path = require('node:path');

/**
 * 轻量、幂等的全局数据迁移机制。
 *
 * 设计原则：
 * 1. 版本是"全局版本"，不为每个 JSON 单独维护版本号。
 * 2. 老用户没有 data/meta.json 时视为 version 0。
 * 3. 只有全部迁移步骤成功后才写入新的 schemaVersion。
 * 4. 迁移中途失败时抛出错误，由调用方明确处理（不静默吞掉）。
 * 5. 多次运行结果一致（幂等）。
 */

const META_FILE = 'meta.json';
const CURRENT_SCHEMA_VERSION = 1;

/** schema v1 引入 workspaceId 的数据表 */
const WORKSPACE_TABLES = [
  'todos.json',
  'goals.json',
  'files.json',
  'notes.json',
  'bookmarks.json',
  'apps.json'
];

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return undefined;
  }
}

function listExistingNames(store, names) {
  return names.filter((name) => fs.existsSync(store.filePath(name)));
}

/** 迁移前尽力创建一份安全备份（失败不阻断迁移，仅记录） */
function createPreMigrationBackup(store, fromVersion) {
  const data = {};
  for (const name of listExistingNames(store, WORKSPACE_TABLES)) {
    const parsed = readJsonFile(store.filePath(name));
    if (parsed !== undefined) data[name] = parsed;
  }
  if (!Object.keys(data).length) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(store.backupsDir, `pre-migration-v${fromVersion}-${stamp}.json`);
  fs.mkdirSync(store.backupsDir, { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify(
      {
        app: '小菠萝的工作台',
        kind: 'migration-backup',
        fromVersion,
        toVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        data
      },
      null,
      2
    ),
    'utf8'
  );
  return target;
}

function readMeta(store) {
  const file = store.filePath(META_FILE);
  const parsed = fs.existsSync(file) ? readJsonFile(file) : undefined;
  const raw = parsed && typeof parsed === 'object' ? Number(parsed.schemaVersion) : 0;
  const schemaVersion = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  return { schemaVersion, updatedAt: (parsed && parsed.updatedAt) || null };
}

function writeMeta(store, schemaVersion) {
  store.write(META_FILE, { schemaVersion, updatedAt: new Date().toISOString() });
}

/**
 * v0 → v1：给已存在的记录补齐 workspaceId: null。
 * - 缺失 workspaceId 的老记录补 null（等价于"未归类"）
 * - 已有 workspaceId（含显式 null）一律不覆盖
 * - 不存在的文件不创建
 * - 内容无变化时不写盘
 */
function migrateToV1(store) {
  const touched = [];
  for (const name of listExistingNames(store, WORKSPACE_TABLES)) {
    const parsed = readJsonFile(store.filePath(name));
    if (!Array.isArray(parsed)) continue;
    let changed = false;
    const next = parsed.map((record) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
      if (Object.prototype.hasOwnProperty.call(record, 'workspaceId')) return record;
      changed = true;
      return { ...record, workspaceId: null };
    });
    if (changed) {
      store.write(name, next);
      touched.push(name);
    }
  }
  return touched;
}

const MIGRATIONS = [{ version: 1, name: 'add-workspace-id', run: migrateToV1 }];

/**
 * 运行全部待执行迁移。
 * options.migrations 仅用于测试注入，正常调用无需传入。
 * @returns {{from:number,to:number,applied:string[],touched:string[],backupPath:string|null,skipped:boolean}}
 */
function runMigrations(store, options = {}) {
  const from = readMeta(store).schemaVersion;
  const targetVersion = Number.isFinite(options.targetVersion)
    ? Math.floor(options.targetVersion)
    : CURRENT_SCHEMA_VERSION;
  const plan = Array.isArray(options.migrations) ? options.migrations : MIGRATIONS;
  if (from >= targetVersion) {
    return {
      from,
      to: from,
      applied: [],
      touched: [],
      backupPath: null,
      skipped: true
    };
  }

  let backupPath = null;
  let backupError = null;
  if (!options.skipBackup) {
    try {
      backupPath = createPreMigrationBackup(store, from);
    } catch (error) {
      backupError = error.message || String(error);
    }
  }

  const applied = [];
  const touched = [];
  for (const migration of plan) {
    if (migration.version <= from) continue;
    // 失败时抛出，由调用方处理；schemaVersion 不会被更新。
    const result = migration.run(store);
    if (Array.isArray(result)) touched.push(...result);
    applied.push(migration.name);
  }

  writeMeta(store, targetVersion);

  return {
    from,
    to: targetVersion,
    applied,
    touched,
    backupPath,
    backupError,
    skipped: false
  };
}

module.exports = {
  META_FILE,
  CURRENT_SCHEMA_VERSION,
  WORKSPACE_TABLES,
  readMeta,
  writeMeta,
  runMigrations,
  createPreMigrationBackup,
  migrateToV1
};
