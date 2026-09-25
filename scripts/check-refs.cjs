// 检查 main.cjs 中对各 service 模块的调用是否都真实存在（防止再次出现 writeNotes 这类漏导出）
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');

const modules = {
  appService: 'electron/services/apps.cjs',
  fileService: 'electron/services/files.cjs',
  noteService: 'electron/services/notes.cjs',
  launcherService: 'electron/services/launcher.cjs',
  backupService: 'electron/services/backup.cjs',
  workspaceService: 'electron/services/workspaces.cjs',
  sessionService: 'electron/services/sessions.cjs',
  overviewService: 'electron/services/overview.cjs',
  migrations: 'electron/migrations.cjs',
  electronDates: 'electron/dates.cjs'
};

const originalLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'electron') {
    return {
      nativeImage: { createFromPath: () => ({ isEmpty: () => true, resize: () => ({ toPNG: () => Buffer.alloc(0), toDataURL: () => '' }) }) },
      shell: {},
      app: {},
      Notification: class {}
    };
  }
  return originalLoad.apply(this, arguments);
};

let bad = 0;
for (const [alias, file] of Object.entries(modules)) {
  const mod = require(path.join(ROOT, file));
  // 前面不能是 word/.  / ' \，避免把 require('./migrations.cjs') 里的文件名当成调用
  const pattern = new RegExp(`(?<![\\w./'\\\\])${alias}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  const used = new Set();
  let match;
  while ((match = pattern.exec(src)) !== null) used.add(match[1]);
  const missing = [...used].filter((fn) => typeof mod[fn] !== 'function');
  console.log(`${alias.padEnd(18)} used=${String(used.size).padEnd(3)} ${missing.length ? `MISSING: ${missing.join(', ')}` : 'OK'}`);
  if (missing.length) bad += 1;
}

Module._load = originalLoad;

// 渲染层：检查 preload 暴露的通道名与 main.cjs 注册的通道名是否一致
const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.cjs'), 'utf8');
const registered = new Set([...src.matchAll(/safeHandle\('([^']+)'/g)].map((m) => m[1]));
const invoked = new Set([...preload.matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]));
const notRegistered = [...invoked].filter((channel) => !registered.has(channel));
const notExposed = [...registered].filter((channel) => !invoked.has(channel));
console.log(`\nIPC 通道：main 注册 ${registered.size} 个，preload 暴露 ${invoked.size} 个`);
console.log(`preload 调用了但 main 未注册：${notRegistered.length ? notRegistered.join(', ') : '无'}`);
console.log(`main 注册了但 preload 未暴露（内部能力，属预期）：${notExposed.length ? notExposed.join(', ') : '无'}`);
if (notRegistered.length) bad += 1;

console.log(bad ? '\n结果：存在问题' : '\n结果：全部解析成功');
process.exit(bad ? 1 : 0);
