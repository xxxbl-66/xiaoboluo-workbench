# 小菠萝的工作台 设计文档

## 目标
使用 Electron + Vue3 构建 Windows 本地个人工作台，完全离线运行，数据保存在用户文档目录，支持快捷应用、文件浏览、待办目标、内嵌对话和设置。

## 技术栈
- Electron：主进程、preload 安全桥、原生系统能力。
- Vue3 + Vite：渲染层 UI。
- electron-builder：生成 Windows NSIS 安装包和便携版。
- 纯 JavaScript，无 UI 组件库、vuex、vue-router、axios。

## 数据目录
`C:\Users\<用户名>\Documents\小菠萝的工作台`

- `data/apps.json`
- `data/app-groups.json`
- `data/goals.json`
- `data/todos.json`
- `data/workflows.json`
- `data/files.json`
- `data/images.json`
- `data/notes.json`
- `data/settings.json`
- `thumbs/apps/`
- `thumbs/images/`
- `backups/`
- `logs/`

## 进程与安全
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webviewTag: true`（仅用于对话内嵌页面）
- preload 通过 `contextBridge` 暴露白名单 API。
- 渲染进程不直接访问 Node，所有路径写入由主进程完成。

## 页面
- 驾驶舱：快捷应用、桌面扫描、今日待办、工作流、本地建议。
- 文件：本地文件浏览 + 收藏 / 图片 / 便签。
- 待办：长期目标与每日任务。
- 对话：内嵌豆包 / DeepSeek / GPT 网页。
- 设置：通用设置、数据目录、备份、扩展功能开关。

## 离线原则
默认不发起网络请求。只有用户主动进入对话页并选择服务后，内嵌 webview 才加载对应网页。扩展功能开关默认关闭。
