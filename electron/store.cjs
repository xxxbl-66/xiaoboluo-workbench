const fs = require('node:fs');
const path = require('node:path');

const tables = require('./tables.cjs');

class DataStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.dataDir = path.join(baseDir, 'data');
    this.appThumbsDir = path.join(baseDir, 'thumbs', 'apps');
    this.imageThumbsDir = path.join(baseDir, 'thumbs', 'images');
    this.booksDir = path.join(baseDir, 'books');
    this.backupsDir = path.join(baseDir, 'backups');
    this.logsDir = path.join(baseDir, 'logs');
    this.ensureDirs();
  }

  ensureDirs() {
    for (const dir of [
      this.baseDir,
      this.dataDir,
      this.appThumbsDir,
      this.imageThumbsDir,
      this.booksDir,
      this.backupsDir,
      this.logsDir
    ]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  filePath(name) {
    return path.join(this.dataDir, name);
  }

  /**
   * 自愈：把有问题的文件改名保留（不删除用户数据），并写回安全默认值。
   * 与 JSON 解析失败走同一条路径。
   */
  quarantine(file, name, defaults, suffix) {
    const broken = `${file}.broken-${Date.now()}${suffix || ''}`;
    try {
      fs.renameSync(file, broken);
    } catch (_) {
      // 忽略备份失败，继续返回默认值
    }
    this.write(name, defaults);
  }

  read(name, defaults) {
    const file = this.filePath(name);
    if (!fs.existsSync(file)) {
      this.write(name, defaults);
      return structuredClone(defaults);
    }

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      this.quarantine(file, name, defaults);
      return structuredClone(defaults);
    }

    // 结构守卫：根类型与约定的默认值不一致时，按同样的自愈流程处理。
    // 这是"正确的数据边界"——启动链与 IPC 读取都经过这里，
    // 因此不会有人拿到非数组的 todos/goals 再抛 filter is not a function。
    const expected = tables.shapeOf(defaults);
    if (expected !== 'primitive' && tables.shapeOf(parsed) !== expected) {
      this.quarantine(file, name, defaults, '-shape');
      return structuredClone(defaults);
    }

    return parsed;
  }

  write(name, data) {
    const file = this.filePath(name);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
}

module.exports = { DataStore };
