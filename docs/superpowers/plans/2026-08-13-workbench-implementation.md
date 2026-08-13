# 小菠萝的工作台 实现计划

## 文件结构
- `package.json`：脚本与依赖。
- `vite.config.mjs`：渲染层构建。
- `scripts/dev.mjs`：开发模式同时启动 Vite 与 Electron。
- `electron/main.cjs`：窗口、IPC 注册、应用生命周期。
- `electron/preload.cjs`：安全 API 桥。
- `electron/data-store.cjs`：JSON 原子读写与默认数据。
- `electron/services/*.cjs`：应用、文件、图标、缩略图、备份等能力。
- `src/renderer/`：Vue3 页面、组件、样式。

## 实施顺序
1. 项目配置与主进程骨架。
2. 数据存储服务。
3. 各业务 IPC。
4. Vue 页面与组件。
5. 样式与交互。
6. 安装依赖、构建验证。
7. 使用说明。
