const fs = require('node:fs');
const path = require('node:path');

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

  read(name, defaults) {
    const file = this.filePath(name);
    if (!fs.existsSync(file)) {
      this.write(name, defaults);
      return structuredClone(defaults);
    }
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      const broken = `${file}.broken-${Date.now()}`;
      try {
        fs.renameSync(file, broken);
      } catch (_) {
        // 忽略备份失败，继续返回默认值
      }
      this.write(name, defaults);
      return structuredClone(defaults);
    }
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
