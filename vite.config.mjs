import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(projectRoot, 'src/renderer'),
  base: './',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: path.resolve(projectRoot, 'dist/renderer'),
    emptyOutDir: true
  }
});
