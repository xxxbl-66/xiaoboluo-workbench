const fs = require('node:fs');
const path = require('node:path');

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
  for (const [name, content] of Object.entries(data)) {
    if (!name.endsWith('.json')) continue;
    if (typeof content !== 'object' && !Array.isArray(content)) continue;
    store.write(name, content);
    count += 1;
  }
  return { ok: true, count };
}

module.exports = { exportBackup, importBackup };
