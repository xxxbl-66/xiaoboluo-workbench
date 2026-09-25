const fs = require('node:fs');
const path = require('node:path');

const tables = require('../tables.cjs');
const migrations = require('../migrations.cjs');

/** 路径穿越与白名单校验统一由 tables.cjs 提供 */
const isSafeTableName = tables.isSafeTableName;

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */

function exportBackup(store) {
  const files = fs.readdirSync(store.dataDir).filter((name) => name.endsWith('.json'));
  const data = {};
  for (const name of files) {
    try {
      data[name] = JSON.parse(fs.readFileSync(path.join(store.dataDir, name), 'utf8'));
    } catch (_) {}
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(store.backupsDir, `backup-${stamp}.json`);
  fs.mkdirSync(store.backupsDir, { recursive: true });
  fs.writeFileSync(
    backupFile,
    JSON.stringify(
      { app: '四一四工作台', exportedAt: new Date().toISOString(), schemaVersion: migrations.CURRENT_SCHEMA_VERSION, data },
      null,
      2
    ),
    'utf8'
  );
  return { ok: true, filePath: backupFile, count: Object.keys(data).length };
}

/* ------------------------------------------------------------------ *
 * 恢复点与回滚
 * ------------------------------------------------------------------ */

/** 记录 data 目录下所有 .json 的原始字节 */
function snapshotDataDir(store) {
  const snapshot = new Map();
  for (const name of fs.readdirSync(store.dataDir)) {
    if (!name.endsWith('.json')) continue;
    snapshot.set(name, fs.readFileSync(path.join(store.dataDir, name), 'utf8'));
  }
  return snapshot;
}

/** 逐字节恢复快照，并撤销导入过程中新建的表 */
function restoreDataDir(store, snapshot) {
  for (const [name, text] of snapshot.entries()) {
    fs.writeFileSync(path.join(store.dataDir, name), text, 'utf8');
  }
  for (const name of fs.readdirSync(store.dataDir)) {
    if (!name.endsWith('.json')) continue;
    if (snapshot.has(name)) continue;
    try {
      fs.rmSync(path.join(store.dataDir, name), { force: true });
    } catch (_) {}
  }
}

/** 导入前把现有数据写成一个可人工恢复的备份文件 */
function createRecoveryPoint(store, snapshot) {
  const data = {};
  for (const [name, text] of snapshot.entries()) {
    try {
      data[name] = JSON.parse(text);
    } catch (_) {}
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(store.backupsDir, `pre-import-${stamp}.json`);
  fs.mkdirSync(store.backupsDir, { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify(
      {
        app: '四一四工作台',
        kind: 'pre-import-backup',
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

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

/**
 * 全量校验备份 payload。任何一项不合法都返回失败，调用方不得写入任何表。
 * @returns {{ok:true, entries:Array<{name:string, content:any}>, importedVersion:number}|{ok:false, error:string}}
 */
function validatePayload(data, declaredVersion) {
  const entries = [];
  const unknown = [];
  const wrongShape = [];

  for (const [name, content] of Object.entries(data)) {
    if (!isSafeTableName(name, null)) {
      unknown.push(name);
      continue;
    }
    if (!tables.matchesKind(name, content)) {
      wrongShape.push(`${name}（应为 ${tables.tableKind(name) === 'array' ? '数组' : '对象'}）`);
      continue;
    }
    entries.push({ name, content });
  }

  if (unknown.length) {
    return { ok: false, error: `备份中包含无法识别的数据文件：${unknown.join('、')}` };
  }
  if (wrongShape.length) {
    return { ok: false, error: `备份中以下数据文件结构不合法：${wrongShape.join('、')}` };
  }
  if (!entries.length) {
    return { ok: false, error: '备份内容为空，没有可导入的数据文件' };
  }

  const toVersion = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };

  // 版本来源优先级：data/meta.json > 备份文件顶层 schemaVersion > 0（视为旧版，需要迁移）
  const metaEntry = entries.find((entry) => entry.name === 'meta.json');
  const importedVersion = metaEntry
    ? toVersion(metaEntry.content && metaEntry.content.schemaVersion)
    : toVersion(declaredVersion);

  return { ok: true, entries, importedVersion };
}

/* ------------------------------------------------------------------ *
 * 导入
 * ------------------------------------------------------------------ */

/**
 * 导入备份。
 *
 * 顺序：
 * 1. 解析文件
 * 2. 【全量校验】白名单 + 每表根类型，任何一项非法 → 整体失败，不写任何表
 * 3. 记录恢复点（内存快照 + backups/ 下的人工恢复文件）
 * 4. 逐表写入；任一步失败 → 逐字节回滚到导入前
 * 5. 导入的是旧版本数据时，重新运行 migration 补齐字段
 */
function importBackup(store, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: '备份文件不存在' };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return { ok: false, error: '备份文件格式错误' };
  }

  const data = payload && payload.data ? payload.data : payload;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: '备份内容无效' };
  }

  const validated = validatePayload(data, payload && payload.schemaVersion);
  if (!validated.ok) return validated;

  // 拒绝"未来版本"的备份：写进去会让当前版本进入不支持状态
  if (validated.importedVersion > migrations.CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `备份由更新版本的四一四工作台创建（schemaVersion ${validated.importedVersion}），请使用更新版本打开`
    };
  }

  const snapshot = snapshotDataDir(store);
  let recoveryPoint;
  try {
    recoveryPoint = createRecoveryPoint(store, snapshot);
  } catch (error) {
    // 恢复点是破坏性导入的前置条件。这里不能降级为仅依赖内存快照：
    // 后续写入或回滚若遭遇同一 I/O 故障，会留下无法恢复的新旧表混合状态。
    return {
      ok: false,
      error: `无法创建导入前恢复点，已取消导入：${error.message || String(error)}`,
      recoveryPoint: null
    };
  }

  try {
    for (const entry of validated.entries) {
      if (entry.name === 'meta.json') continue;
      store.write(entry.name, entry.content);
    }

    // meta.json 单独处理：把版本压到导入内容的版本，好让迁移能重新跑一遍
    migrations.writeMeta(store, validated.importedVersion);

    const migrationResult = migrations.runMigrations(store);
    return {
      ok: true,
      count: validated.entries.length,
      importedTables: validated.entries.map((entry) => entry.name),
      recoveryPoint,
      importedVersion: validated.importedVersion,
      schemaVersion: migrationResult.to
    };
  } catch (error) {
    try {
      restoreDataDir(store, snapshot);
    } catch (restoreError) {
      return {
        ok: false,
        error: `导入失败且自动恢复未完成：${error.message}（恢复错误：${restoreError.message}）`,
        recoveryPoint
      };
    }
    return {
      ok: false,
      error: `导入失败，已恢复到导入前的数据：${error.message}`,
      recoveryPoint
    };
  }
}

module.exports = { exportBackup, importBackup, isSafeTableName, validatePayload };
