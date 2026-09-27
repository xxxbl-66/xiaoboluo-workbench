# 四一四工作台

面向大学生学习、项目开发和多任务场景的 Windows 本地个人工作台。通过 Workspace 组织任务与资源，通过 Work Session 保存完成事项、备注与下一步，通过 Resume 和默认 Workflow 衔接下一次工作。

## 技术栈与环境

Electron 33、Vue 3、Vite 6；本地 JSON 文件持久化。Windows 10/11 x64，源码构建推荐 Node.js 22 LTS 与 npm 10。发布的 EXE 无需安装 Node.js 或 npm。依赖具体版本以 package-lock.json 为准。

## 源码运行

```powershell
npm ci
npm run dev
```

## 测试与构建

```powershell
npm test
node scripts/check-refs.cjs
npm run build
npm run dist -- --x64
```

build 生成渲染层；dist 生成 Windows x64 NSIS 安装版和便携版，输出到 dist-release/final-v0.1.2/。构建时需网络下载锁定依赖、Electron 和打包工具。未配置代码签名，Windows 可能提示发布者未知。

## 数据存储

默认使用 Windows 系统“文档”目录内的 小菠萝的工作台/，保留旧名称以兼容历史数据。各模块数据位于 data/ 中，备份位于 backups/ 中；设置中可选择其他数据目录。程序文件与用户数据分离。EXE 不支持开发用 WORKBENCH_GUI_TEST_ROOT 隔离变量；导入备份和破坏性验收应使用独立测试账户或 Windows Sandbox。便携版免安装，但用户数据并非随 EXE 存储。

本地核心流程无需服务器。网页收藏、URL 工作流和第三方网页入口需要对应网络服务；网页入口不属于自研模型或 Agent。

## 主要目录

| 目录 | 内容 |
| --- | --- |
| electron/ | 主进程、受控 IPC、数据存储与服务 |
| src/renderer/ | Vue 页面、组件与样式 |
| tests/ | 自动化回归测试与辅助程序 |
| scripts/ | 开发启动与源码引用检查 |
| build/ | Windows 应用图标 |
| docs/ | 设计和发布说明 |

## 使用

创建工作空间并关联待办和资源，开始工作后可运行工作流打开应用、文件、文件夹与网页。结束工作时记录完成事项、备注和下一步；下次从最近工作或工作空间恢复卡继续。恢复的是工作记录与资源入口，不包含应用内存或软件内部编辑状态。
