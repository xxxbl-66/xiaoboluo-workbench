const fs = require('node:fs');
const path = require('node:path');

const tables = require('./tables.cjs');

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
        app: '四一四工作台',
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
 * 结构校验与安全修复。
 *
 * 与 schema 版本无关，每次启动都执行。遇到根类型错误 / JSON 语法损坏的表时：
 * 1. 把原始文件改名为 `<name>.broken-<时间戳>`（与 DataStore 的自愈约定一致），
 *    绝不静默丢弃原始数据
 * 2. 写入该表的安全默认结构
 * 3. 记录到 repaired，交由上层向用户报告
 *
 * 这样后续的普通启动链（syncGoalRecurringTasks 等）永远不会拿到非数组的表。
 */
function ensureTableRoots(store) {
  const repaired = [];

  for (const name of tables.tableNames()) {
    const file = store.filePath(name);
    if (!fs.existsSync(file)) continue;

    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (error) {
      // 连读都读不了（权限/占用）时不能假装修好了，直接失败并且不写 schemaVersion
      throw new Error(`无法读取数据文件 ${name}：${error.message}`);
    }

    let broken = false;
    try {
      broken = !tables.matchesKind(name, JSON.parse(raw));
    } catch (_) {
      broken = true;
    }
    if (!broken) continue;

    const quarantine = `${file}.broken-${Date.now()}-${repaired.length}`;
    let preserved = false;
    try {
      fs.renameSync(file, quarantine);
      preserved = true;
    } catch (_) {
      // 改名失败时至少留一份原始内容副本，绝不直接覆盖
      try {
        fs.writeFileSync(`${quarantine}.copy`, raw, 'utf8');
        preserved = true;
      } catch (_) {}
    }
    if (!preserved) {
      throw new Error(`数据文件 ${name} 结构不合法，且无法保留原始副本，已停止启动`);
    }

    store.write(name, tables.defaultsFor(name));
    repaired.push({ name, backup: quarantine });
  }

  return repaired;
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
  const targetVersion = Number.isFinite(options.targetVersion)
    ? Math.floor(options.targetVersion)
    : CURRENT_SCHEMA_VERSION;

  // 先读版本，再做任何写入。
  // 数据由更新版本创建时，当前程序既不能迁移、也不能降级、更不能覆盖 meta，
  // 必须把整个数据目录原样留给更新版本处理。
  const from = readMeta(store).schemaVersion;
  if (from > targetVersion) {
    return {
      ok: false,
      reason: 'UNSUPPORTED_FUTURE_SCHEMA',
      from,
      to: from,
      current: targetVersion,
      applied: [],
      touched: [],
      repaired: [],
      backupPath: null,
      skipped: true,
      futureSchema: true
    };
  }

  // 结构校验与安全修复，保证后续任何读路径都不会拿到根类型错误的表。
  // 这一步只能抛错（不可恢复），绝不"跳过 + 标记成功"。
  const repaired = options.skipRepair ? [] : ensureTableRoots(store);

  const plan = Array.isArray(options.migrations) ? options.migrations : MIGRATIONS;
  if (from >= targetVersion) {
    return {
      ok: true,
      from,
      to: from,
      applied: [],
      touched: [],
      repaired,
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
    ok: true,
    from,
    to: targetVersion,
    applied,
    touched,
    repaired,
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
  ensureTableRoots,
  runMigrations,
  createPreMigrationBackup,
  migrateToV1
};
