import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configFile = path.join(projectRoot, 'vite.config.mjs');

const server = await createServer({ configFile, configLoader: 'native' });
await server.listen();

const devUrl = server.resolvedUrls.local[0];
if (!devUrl) {
  console.error('Vite 启动失败：未获取到本地地址');
  process.exit(1);
}

const electron = spawn(electronPath, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: devUrl
  }
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  electron.kill();
  server.close();
  process.exit(code);
}

electron.on('exit', (code) => shutdown(code ?? 0));
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
