const fs = require('node:fs');
const path = require('node:path');

/**
 * 允许导入的数据表白名单。
 * 备份里的键名来自外部文件，必须限制成"数据目录下的已知 .json 文件名"，
 * 否则 ../ 之类的键会被 path.join 解析到数据目录之外。
 */
function isSafeTableName(name, dataDir) {
  if (typeof name !== 'string' || !name) return false;
  if (!name.endsWith('.json')) return false;
  // 只接受纯文件名：不能含路径分隔符，也不能是 . / ..
  if (name !== path.basename(name)) return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('\0')) return false;

  // 最终防线：解析后的绝对路径必须仍然位于 dataDir 之内
  const base = path.resolve(dataDir);
  const target = path.resolve(base, name);
  if (target === base) return false;
  return target.startsWith(base + path.sep);
}

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
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ app: '小菠萝的工作台', exportedAt: new Date().toISOString(), data }, null, 2),
    'utf8'
  );
  return { ok: true, filePath: backupFile, count: Object.keys(data).length };
}

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
  if (!data || typeof data !== 'object') {
    return { ok: false, error: '备份内容无效' };
  }

  let count = 0;
  const skipped = [];
  for (const [name, content] of Object.entries(data)) {
    if (typeof content !== 'object' || content === null) continue;
    // 路径穿越防护：不安全的键名直接跳过并记录，不写盘
    if (!isSafeTableName(name, store.dataDir)) {
      skipped.push(name);
      continue;
    }
    store.write(name, content);
    count += 1;
  }
  return { ok: true, count, skipped };
}

module.exports = { exportBackup, importBackup, isSafeTableName };
