# 小菠萝工作台现状审计与 Workspace 可行性分析

> 审计日期：2026-09-21
> 审计对象：`xiaoboluo-workbench` v0.1.2（工作目录 `C:\Users\86185\Desktop\工作台`）
> 审计方式：**纯只读审计**。未修改任何源码、未新增/删除/移动文件、未改 JSON、未改路由、未升级依赖、未 commit。
> 证据原则：所有结论均来自真实源码、`package.json`、`package-lock.json`、`node_modules` 实际安装版本，以及用户文档目录下真实 JSON 的**结构**（不读取/不泄露内容）。README 仅作参考，与源码冲突处均已标注。

---

## 1. 执行摘要

### 一句话结论
**现有项目非常适合增加 Workspace，属于"改动中等但风险可控"（B 级）**，因为它的数据层已经是一套统一、可扩展的"JSON 表"模型，新增 `workspaces.json` 并给现有记录加一个 `workspaceId` 字段即可，**不需要推翻任何现有结构**。

### 核心事实（均已在源码中核实）

| 维度 | 实际情况 |
| --- | --- |
| 技术栈 | Electron 33.4.11 + Vue 3.5.41 + Vite 6.4.3，**纯 JavaScript**，无 TypeScript 源码 |
| 运行时依赖 | **只有 `vue` 一个**（`package.json` `dependencies`）。无 vue-router、无 Pinia、无 UI 组件库、无 axios、无 dayjs、无 marked、无拖拽库、无图表库 |
| 路由 | **不存在**。`src/renderer/src/App.vue` 用 `ref('dashboard')` + `viewMap` 对象做视图切换，无 URL、无 history、无深链接 |
| 状态管理 | **不存在 Pinia/Vuex**。靠"每个组件自己 `invoke` IPC + 若干模块级单例 composable"实现 |
| 数据存储 | 每类数据一个 JSON 文件，位于 `Documents\小菠萝的工作台\data\`，共 **17 个 JSON 文件**，由 `electron/store.cjs` 的 `DataStore` 类统一读写 |
| IPC | **92 个 `ipcMain.handle` 通道**，全部经 `electron/main.cjs` 的 `safeHandle()` 集中注册，**集中度很高** |
| 安全基线 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`contextBridge` 白名单桥接 —— 基线正确 |
| 工作流真实能力 | **只有 3 种步骤**（`app` / `file` / `url`），顺序执行 + 固定 350ms 延迟。**无参数、无条件、无计时、无状态、无重试、无执行历史** |
| AI 模块 | **确认只是内嵌网页容器（webview）**，不调用任何 AI API、不保存 API Key、无 prompt、不读取用户数据 |
| 构建 | `npm run build` **成功**（59 modules，2.42s，exit 0） |
| 项目规模 | 47 个源码文件 / 12,476 行（其中 `styles.css` 3,224 行、`main.cjs` 1,263 行） |

### Workspace 接入结论速览（详细见第 10 章）
- **可行**，推荐 **方案 B：保留独立工作流库，Workspace 只做"绑定引用"**（与现有 `workflow.steps[].appId` 引用 apps 的模式完全一致）。
- **推荐用 `workspaceId`（单值），而非 `workspaceIds[]`，也不需要 relation 表**。理由：现有项目的所有关联都是"单值外键 + 主进程内做 join"（如 `todo.sourceGoalId`、`app.groupId`、`book.categoryId`），沿用同一模式改动最小、最不容易破坏现有数据。
- **最高优先级技术债不是架构，而是 4 个具体缺陷**（见第 17 章 P0/P1）：`backup:import` 路径穿越、`Notification` 实际不可用导致提醒静默失效、`NotedsPanel` 丢字、`getReviewRecord` 读操作写盘污染数据。

---

## 2. 当前项目目录与架构

### 2.1 真实目录树（已排除 `node_modules`、`dist`、`dist-release`、`.git`）

```text
工作台/  (xiaoboluo-workbench)
├─ package.json                      # 唯一依赖: vue；含 electron-builder 配置
├─ package-lock.json                 # lockfileVersion 3
├─ vite.config.mjs                   # root = src/renderer，outDir = dist/renderer
├─ 启动工作台.bat                     # 一键启动（缺依赖则装的兜底脚本）
├─ README.md
├─ build/
│  └─ icon.ico                       # 打包图标（145,635 B）
├─ scripts/
│  └─ dev.mjs                        # dev 编排：起 Vite → spawn electron
├─ electron/                         # ===== 主进程（8 文件 / 2,201 行）=====
│  ├─ main.cjs                       # 1,263 行：窗口、92 个 IPC、目标同步逻辑
│  ├─ preload.cjs                    # 162 行：contextBridge 白名单 API
│  ├─ store.cjs                      # 63 行：DataStore（JSON 读写 + 原子性）
│  ├─ defaults.cjs                   # 30 行：id() / defaultSettings / defaultGroups
│  └─ services/
│     ├─ apps.cjs                    # 304 行：快捷应用、图标读取、桌面扫描
│     ├─ files.cjs                   # 247 行：文件浏览、文件收藏、图片、便签
│     ├─ launcher.cjs                # 83 行：打开路径/网页、工作流执行引擎
│     └─ backup.cjs                  # 49 行：备份导出/导入
├─ src/renderer/                     # ===== 渲染进程（39 文件 / 10,275 行）=====
│  ├─ index.html                     # 13 行：含 CSP（webview-src 白名单）
│  └─ src/
│     ├─ main.js                     # 5 行：createApp(App).mount('#app')
│     ├─ App.vue                     # 83 行：外壳 + 导航 + 主题
│     ├─ assets/styles.css           # 3,224 行：全局样式 + CSS 变量主题
│     ├─ views/                      # 9 个页面（2,624 行）
│     ├─ components/                 # 20 个组件（3,957 行）
│     ├─ composables/                # 4 个（198 行）
│     └─ utils/                      # 2 个（171 行）
└─ docs/                             # 截图 9 张 + 设计文档 + CHANGELOG
   ├─ superpowers/specs/2026-08-13-workbench-design.md
   └─ superpowers/plans/2026-08-13-workbench-implementation.md
```

### 2.2 每个核心目录的职责

| 目录 | 职责 | 关键文件 |
| --- | --- | --- |
| `electron/` | 主进程。**唯一**有权读写磁盘、调用 `shell`、弹系统对话框的地方。渲染层不碰 Node | `main.cjs` |
| `electron/services/` | 按领域拆分的主进程业务逻辑，供 `main.cjs` 的 IPC 调用 | `apps.cjs`、`files.cjs`、`launcher.cjs`、`backup.cjs` |
| `src/renderer/src/views/` | 一级页面（对应左侧菜单项），一个页面一个文件 | 9 个 `*View.vue` |
| `src/renderer/src/components/` | 可复用 UI 组件（面板、弹窗、图标、阅读器） | `TodoPanel.vue` 等 |
| `src/renderer/src/composables/` | 跨组件共享的模块级响应式单例 | `useTimer.js`、`useTodosStore.js`、`toast.js`、`useWorkbench.js` |
| `src/renderer/src/utils/` | 纯函数工具 | `lunar.js`、`quadrant.js` |
| `src/renderer/src/assets/` | 全局样式 + 主题 CSS 变量 | `styles.css` |
| `scripts/` | 开发期编排 | `dev.mjs` |
| `docs/` | 设计文档与截图（**含一份前瞻性设计文档，见 2.3**） | `superpowers/specs/...` |

### 2.3 重要发现：项目自带的设计文档已经否定了多套方案

`docs/superpowers/specs/2026-08-13-workbench-design.md` 第 10 行明确写着：

> 纯 JavaScript，无 UI 组件库、vuex、vue-router、axios。

第 30–35 行明确记录了安全基线（`contextIsolation`/`nodeIntegration`/`sandbox`/`webviewTag`）。
**这说明"无 router、无状态库"是刻意决策，不是遗漏。** 因此 Workspace 接入时**不应顺手引入 vue-router**（会与项目既定风格冲突，且属于大规模重构，违反本次约束）。

### 2.4 一个"看起来像 Workspace"的措辞陷阱

所有 9 个页面的 `view-kicker` 都写着 `WORKSPACE / XXX`（如 `src/renderer/src/views/TodosView.vue:5` 的 `WORKSPACE / TASKS`、`DashboardView.vue:5` 的 `WORKSPACE / DASHBOARD`）。
**这只是装饰性英文小标题，与"工作空间 Workspace"概念无关**，源码中不存在任何 workspace 实体、类型或字段。命名新模块时建议避免与之混淆。

---

## 3. 技术栈

### 3.1 声明版本 vs 实际安装版本

| 项目 | `package.json` 声明 | 实际安装 | 证据 |
| --- | --- | --- | --- |
| Electron | `^33.2.1` | **33.4.11** | `node_modules/electron/package.json` |
| Vue | `^3.5.13` | **3.5.41** | `node_modules/vue/package.json` |
| Vite | `^6.0.7` | **6.4.3** | `node_modules/vite/package.json` |
| @vitejs/plugin-vue | `^5.2.1` | 5.2.4 | `node_modules/@vitejs/plugin-vue/package.json` |
| electron-builder | `^25.1.8` | 25.1.8 | `node_modules/electron-builder/package.json` |
| @esbuild/win32-x64 | `^0.25.12` | 已安装 | devDependencies |
| Node | README 称 18+（推荐 20+） | 本机 **v22.19.0** | `node -v` |
| npm | 未声明 | 10.9.3 | `npm -v` |

### 3.2 用户询问的每一项技术，逐个如实回答

| 询问项 | 真实情况 | 依据 |
| --- | --- | --- |
| Electron 版本 | 33.4.11 | 实测 |
| Vue 版本 | 3.5.41（Composition API + `<script setup>`） | 实测 + 所有 `.vue` 文件 |
| Vite 版本 | 6.4.3 | 实测 |
| Node 版本要求 | 无 `engines` 字段；README 说 18+/20+；`启动工作台.bat` 只检查 `where node` | `package.json` 无 `engines` |
| TypeScript / JavaScript | **纯 JavaScript**。`node_modules/typescript@5.9.3` 存在，但**是 electron-builder 的传递依赖**，项目无 `tsconfig.json`、无 `.ts` 源文件 | `package-lock.json` 中 `node_modules/typescript` 非直接依赖 |
| UI 组件库 | **无**。全部手写，仅用 `styles.css` 的 CSS 变量 + scoped style | 实测无 element-plus/naive-ui/ant-design-vue |
| 状态管理 | **无 Pinia/Vuex**。模式为：①每组件自己 `await workbench.xxx.list()`；②需要跨组件共享时用模块级 `ref` 单例（`useTodosStore.js`、`useTimer.js`、`toast.js`） | `src/renderer/src/composables/` |
| 路由 | **无路由库**。`App.vue` 的 `activeView` ref + `viewMap` 对象映射 | `App.vue:38,51-63` |
| 图标库 | **无第三方库**。自绘 SVG 组件 `LineIcon.vue`（name → path 映射） | `components/LineIcon.vue` |
| Markdown 解析 | **无库**。`MarkdownRenderer.vue` 手写 117 行解析器（转义 → 逐行状态机 → `v-html`） | `components/MarkdownRenderer.vue` |
| 数据可视化 | **无库**。仅用内联 SVG 手写环形进度（`stroke-dasharray`） | `TodayTodos.vue:8-22`、`DashboardWelcome.vue:10-23` |
| 日期库 | **无库**。全部用原生 `Date` + `padStart` 手写 `todayKey()` / `dateKey()` | `main.cjs:126-131`、`CalendarView.vue:193-198` |
| 拖拽库 | **无库**。使用原生 HTML5 `draggable="true"` + `dragstart/dragover/drop/dragend` | `AppLauncher.vue:313-345`、`Sidebar.vue:139-166` |
| 数据存储 | 自研 `DataStore` 类 + JSON 文件，**无 SQLite/IndexedDB/localStorage** | `electron/store.cjs` |
| IPC 通信 | `ipcMain.handle` / `ipcRenderer.invoke`（Promise 式），配 `safeHandle` 统一错误包装；仅 1 个反向事件 `books:changed` | `main.cjs:48-57`、`preload.cjs:12-18` |
| 打包工具 | **electron-builder 25.1.8**（非 Forge），target 为 `nsis` + `portable` | `package.json` `build` 字段 |
| 测试框架 | **完全没有**。无 vitest/jest/playwright/@vue/test-utils | 实测全部不存在 |
| Lint / Formatter | **完全没有**。无 eslint/prettier 配置与依赖 | 实测全部不存在 |
| 其他重要依赖 | Vue 之外**零运行时依赖**。开发期仅 Vite/plugin-vue/electron/electron-builder/esbuild | `package.json` |

### 3.3 这些依赖实际用在哪些功能里

- **Vue 3**：全部 9 个 view + 20 个 component；`reactive` 用于 toast（`toast.js:3`）、`computed` 用于派生状态、`Teleport` 用于 `Modal.vue:2` 和 `BookReader.vue`。
- **Vite**：`vite.config.mjs` 中 `isCustomElement: tag === 'webview'` —— **这是让 `<webview>` 标签能被 Vue 编译的关键配置**，ChatView 与 BookshelfView 依赖它。
- **Electron 原生能力**（无第三方库，全部用内置 API）：
  - `shell.openPath` → 快捷应用启动（`launcher.cjs:24`）、文件打开（`:33`）、书籍外部打开
  - `shell.showItemInFolder` → 文件"在文件夹中显示"（`launcher.cjs:38`）
  - `shell.openExternal` → 打开网页（`launcher.cjs:43`）
  - `app.getFileIcon` → **exe/lnk 图标提取**（`apps.cjs:98,203,258`）
  - `nativeImage` → 头像/封面/铃声缩略图与 base64（`main.cjs:603,1075`、`files.cjs:158`）
  - `dialog.showOpenDialog` → 全部 7 个文件选择器（`main.cjs:560-656`）
  - `session.fromPartition('persist:bookshelf')` → 书架持久会话 + 下载拦截（`main.cjs:1234-1251`）
  - `app.setLoginItemSettings` → 开机自启（`main.cjs:59-67`）
  - `execFileSync('powershell.exe', ...)` → **解析 .lnk 快捷方式真实目标**（`apps.cjs:54-58`）

---

## 4. Electron 架构

### 4.1 四个入口位置

| 项 | 文件 | 说明 |
| --- | --- | --- |
| main 入口 | `electron/main.cjs`（1,263 行） | `package.json` `"main": "electron/main.cjs"` |
| preload | `electron/preload.cjs`（162 行） | `main.cjs:1178` `preload: path.join(__dirname, 'preload.cjs')` |
| renderer | `src/renderer/index.html` → `src/main.js` → `App.vue` | Vite `root = src/renderer` |
| 构建产物 | `dist/renderer/index.html` | `main.cjs:1211` `loadFile(...)` |

### 4.2 安全配置（逐项核实）

`main.cjs:1177-1184`：

```js
webPreferences: {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,   // ✅ 已开启
  nodeIntegration: false,   // ✅ 已关闭
  sandbox: true,            // ✅ 已开启
  webviewTag: true,         // ⚠️ 唯一"放宽"项，见下
  webSecurity: true         // ✅ 已开启
}
```

- **contextIsolation：开启**
- **nodeIntegration：关闭**
- **是否使用 contextBridge：是** —— `preload.cjs:162` `contextBridge.exposeInMainWorld('workbench', api)`
- **webviewTag: true**：因为 ChatView / BookshelfView 需要 `<webview>`。项目对此有补偿性防御：
  - `main.cjs:1187-1200` `will-attach-webview` 强制把 webview 的 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`、`webSecurity=true`，并按 `allowedWebviewHosts()` 做主机名白名单，不匹配则 `event.preventDefault()`
  - `main.cjs:1219-1226` 对所有 webview 设置 `setWindowOpenHandler` → 一律 `deny` 并转 `shell.openExternal`
- **CSP**：`src/renderer/index.html:6` 有 `default-src 'self'`、`script-src 'self'`（无 `unsafe-inline`）、`webview-src` 白名单。**CSP 质量超出一般个人项目水平。**

### 4.3 renderer 可以调用哪些 Electron API

**只有 preload 白名单里的 92 个封装方法，无法直接 require('electron') 或 fs。**
白名单结构（`preload.cjs:20-160`）：

| 命名空间 | 方法 |
| --- | --- |
| `app` | `info` |
| `settings` | `get` `update` `clearData` |
| `system` | `selectApp` `selectFile` `selectImage` `selectAvatar` `selectAudio` `selectBook` `selectDirectory` `openPath` `openDataDir` `changeDataDir` `openLogsDir` `openExternal` |
| `apps` | `list` `launch` `add` `scanDesktop` `scanCandidates` `addBatch` `update` `remove` `reorder` |
| `groups` | `list` `create` `update` `remove` |
| `goals` | `list` `create` `update` `remove` `checkin` |
| `todos` | `list` `create` `update` `remove` `reorder` |
| `files` | `drives` `browse` `open` `reveal` + `favorites.*` + `images.*` + `notes.*` |
| `workflows` | `list` `create` `update` `remove` `reorder` `run` |
| `checkins` | `get` `toggle` |
| `bookmarks` | `list` `create` `update` `remove` |
| `calendar` | `list` `create` `update` `remove` |
| `review` | `list` `get` `update` |
| `books` | `list` `add` `update` `selectCover` `remove` `open` `read` + `categories.*` + `stores.*` + `onChanged` |
| `backup` | `export` `import` |
| `reader` | `get` `update` |

### 4.4 IPC channel 清单与是否集中管理

- **通道总数：92 个 `ipcMain.handle`**（用 `grep "safeHandle\('"` 精确统计），全部在 `main.cjs` 的 `registerIpc()`（`:531-1167`）中注册。
- **反向通道：1 个** —— `main.cjs:1244` `mainWindow.webContents.send('books:changed', book)`，`preload.cjs:146-150` 用 `onChanged` 暴露并**返回取消订阅函数**。
- **是否集中管理：是，集中度很高。** 所有通道统一走 `main.cjs:48-57` 的 `safeHandle()`，把结果包成 `{ok:true,data}` / `{ok:false,error}`，再由 `preload.cjs:12-18` 的 `invoke()` 统一抛错。
  **这是一个非常好的设计**：新增 Workspace 通道时只要照抄这个模式，就能自动获得一致的错误处理。

### 4.5 打开 exe / 文件 / 文件夹 / 网页 / 选择器 / 图标 / 数据目录 / 自启 / 窗口 —— 逐个溯源

| 问题 | 实现 | 文件:函数 |
| --- | --- | --- |
| **打开本地 exe** | `shell.openPath(appEntry.path)`，成功后累加 `lastLaunched` / `launchCount` 并回写 `apps.json` | `launcher.cjs:20-30` `launchApp()` |
| **打开文件/文件夹** | 同一函数 `shell.openPath(filePath)`（Windows 下由系统关联决定打开方式）；"在文件夹中显示"用 `shell.showItemInFolder` | `launcher.cjs:32-40` `openPath()` / `revealPath()` |
| **打开网页** | `shell.openExternal(url)` —— 注意**未 await、无协议校验** | `launcher.cjs:42-45` `openExternal()` |
| **文件选择器** | 7 个独立 `dialog.showOpenDialog`：select-app（exe/lnk/bat/cmd）、select-file、select-image、select-avatar、select-audio、select-book、select-directory | `main.cjs:560/573/582/594/608/637/649` |
| **图标读取** | `app.getFileIcon(iconSource, {size:'large'})` → `toPNG()` → 落盘到 `thumbs/apps/{appId}.png`，读取时转 base64 供 `<img>` | `apps.cjs:97-107` `makeAppEntry()`、`:28-37` `iconToDataUrl()`、`:192-217` `ensureIcons()` |
| **.lnk 解析** | 用 PowerShell + `WScript.Shell.CreateShortcut().TargetPath` 批量解析，结果按小写路径建 Map。为避免中文/引号问题，把 JSON 转 base64 后以 `-EncodedCommand` 传入 | `apps.cjs:39-73` `resolveLnkTargets()` |
| **本地数据目录** | `app.getPath('documents') + '\小菠萝的工作台'`；若 `config.json` 里有 `dataRoot` 则用它 | `main.cjs:14-34` `configRoot()` / `configuredDataRoot()` / `dataRoot()` |
| **开机自启动** | `app.setLoginItemSettings({openAtLogin, path: process.execPath})`；未打包时补 `args:[app.getAppPath()]` | `main.cjs:59-67` `applyLaunchAtStartup()` |
| **窗口管理** | **只有 1 个 `mainWindow`**（1360×860，min 1000×660）；`closed` 时置 null；`activate` 时重建；`window-all-closed` 非 macOS 直接退出 | `main.cjs:1169-1217` `createWindow()`、`:1256-1263` |

### 4.6 是否存在多个 BrowserWindow
**不存在。** 全项目只有 `main.cjs:1170` 一处 `new BrowserWindow`。`BrowserWindow.getAllWindows()` 仅在 `:1257` 用于判断是否需要重建窗口。

### 4.7 AI 网页内嵌方式（用户明确询问）
**使用 `<webview>` 标签**，不是 iframe / BrowserView / 新 BrowserWindow / 仅 openExternal。
证据：`src/renderer/src/views/ChatView.vue:40-52` 与 `src/renderer/src/views/BookshelfView.vue:125-132`。
详细分析见第 9 章。

### 4.8 安全风险（Electron 层）

| 级别 | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| **P1** | `system:open-path` / `files:open` 接受渲染层任意路径且无校验 | `main.cjs:658,874` → `launcher.cjs:32` | 目前无实际可利用点（因为无 XSS，见第 17 章），但一旦将来引入 `v-html` 渲染不可信内容，这就是现成的本机任意文件/程序执行链。建议未来加扩展名白名单 |
| **P1** | `shell.openExternal` 未校验协议、未 await | `launcher.cjs:42-45`、`main.cjs:1202-1205,1222` | 若 URL 为 `file:` / 自定义协议，可能触发本机程序。当前入口受限（ChatView 的 URL 来自内置配置，workflow 的 `url` 由用户手动填写），风险中等 |
| **P2** | `webview` 的 `allowpopups` 显式开启 | `ChatView.vue:46`、`BookshelfView.vue:131` | 已由 `setWindowOpenHandler → deny` 兜底，当前不是漏洞，但属于"不必要的能力暴露" |
| **P2** | `allowedWebviewHosts()` 每次都重新读 `book-stores.json` | `main.cjs:398-410` | 用户添加的书城域名会立即进入白名单，属于设计意图；但白名单以"主机名后缀"匹配（`endsWith('.'+host)`），需注意子域接管风险 |
| **P2** | `sandbox: true` 与 `webviewTag: true` 同时在主窗口开启 | `main.cjs:1181-1182` | 这是 Electron 中较敏感的组合，项目已用 `will-attach-webview` 加固，可接受 |
| P3 | CSP 中 `webview-src` 缺少 `https://chat.qwen.ai`，但 `defaults.cjs:24` 与 `main.cjs:399` 都允许 qwen | `index.html:6` vs `defaults.cjs:24` | 行为不一致；实测 `allowedWebviewHosts` 是实际闸门，故 qwen 仍能加载，但 CSP 声明与实际能力不符 |

---

## 5. 前端页面架构

### 5.1 导航结构（真实机制，非推测）

```text
App.vue
 ├─ <Sidebar :active="activeView" @navigate="activeView = $event" />   ← 左侧菜单
 └─ <component :is="currentView" :settings="settings"
        @navigate="activeView = $event"
        @settings-updated="handleSettingsUpdated" />                    ← 动态视图
```

- **没有 URL，没有 history，没有深链接，没有浏览器后退。** 全部状态是 `App.vue:38` 的 `const activeView = ref('dashboard')`。
- 视图映射表：`App.vue:51-61` 的 `viewMap`；`App.vue:63` `currentView = computed(() => viewMap[activeView.value] || DashboardView)`。
- **失活即卸载**：`<component :is>` 切换会真实卸载旧组件（触发 `onBeforeUnmount`）。这对 Workspace 的"计时器要跨页面存活"是**关键约束**（见第 12 章）。

### 5.2 路由定义
**不存在路由定义文件**，因为项目没有 vue-router。所谓"路由"就是 `viewMap` 的 9 个 key。

### 5.3 左侧菜单实现

`src/renderer/src/components/Sidebar.vue`：

- 菜单项硬编码在 `Sidebar.vue:85-95` 的 `baseNavItems`（9 项，`id/icon/label`）。
- **支持拖拽排序**：`draggable="true"`（`:29`），`startDrag`/`dropOn`（`:139-166`）计算出新顺序后调 `settings.update({navOrder: ids})` 持久化到 `settings.json`。
- 排序渲染逻辑在 `orderedNavItems`（`:97-110`）：按 `navOrder` 索引排序，**不在 order 里的项排到 999**（即新增菜单项若未写入 navOrder，会自动落到最后，不会消失）。
- **新增菜单项的改动点就是这里**（一处数组 + 一处 viewMap）。
- 侧边栏还内嵌了打卡卡片（`:14-20`）与用户头像（`:4-12`）。

### 5.4 主要页面清单

| 页面 | 文件 | 主要职责 | 主要数据来源 |
| --- | --- | --- | --- |
| 驾驶舱 | `views/DashboardView.vue` | 欢迎卡 + 快捷应用 + 今日待办 + 可增删小组件 + 工作流面板 | `settings.get`、`todos.list`、`checkins.get`、`books.list`、`apps.*`、`workflows.*` |
| 待办 | `views/TodosView.vue` | **仅是一个 tab 容器**（`activeTab`），真正内容在 TodoPanel / GoalPanel | — |
| 待办主体 | `components/TodoPanel.vue` | 新建/编辑/删除/完成/四象限/截止/提醒/筛选 | `todos.*` |
| 长期目标 | `components/GoalPanel.vue` | 目标 CRUD、周期任务、打卡进度 | `goals.*` |
| 日历 | `views/CalendarView.vue` | 月视图、日程 CRUD、待办截止日、农历/节日 | `calendar.*`、`todos.list`、`utils/lunar.js` |
| 今日复盘 | `views/ReviewView.vue` | 待办完成度、阅读/专注分钟、三问、历史 | `todos.list`、`review.get/list/update` |
| 收藏夹 | `views/BookmarksView.vue` | 文章/链接/视频/推文收藏 CRUD | `bookmarks.*` |
| 我的书架 | `views/BookshelfView.vue` | 本地书库、分类、封面、在线书城 | `books.*`、`reader.*` |
| 书架阅读器 | `components/BookReader.vue` | 章节解析、字号/字体/主题、阅读进度 | `reader.get/update`、`books.read` |
| 文件 | `views/FilesView.vue` | **4 个 tab 容器**：文件浏览/收藏/图片/便签 | — |
| 对话 | `views/ChatView.vue` | 4 个 AI 网页入口 | `settings.get`（chatProviders） |
| 设置 | `views/SettingsView.vue` | 用户/主题/自启/数据目录/备份/铃声/清空 | `settings.*`、`app.info`、`backup.*` |

### 5.5 公共组件与复用情况

**真正被复用的公共组件（4 个）：**

| 组件 | 被引用次数 | 引用者 |
| --- | --- | --- |
| `Modal.vue` | 7 | TodoPanel、AppLauncher、GoalPanel、WorkflowPanel、CalendarView、BookmarksView、BookshelfView、ImagesPanel |
| `LineIcon.vue` | 13 | 几乎所有页面与组件 |
| `MarkdownRenderer.vue` | 1 | NotesPanel |
| `ToastHost.vue` | 1（App.vue 挂载） | 全局提示 |

**⚠️ 死代码（2 个组件从未被任何文件引用）：**

| 组件 | 行数 | 核实方式 | 说明 |
| --- | --- | --- | --- |
| `components/RightDock.vue` | 3,630 B | 全仓库 grep 仅命中自身与 `styles.css` | 右侧停靠栏（含自己的计时器 `setInterval` 与防抖保存），已废弃 |
| `components/SuggestionPanel.vue` | 2,166 B | 全仓库 grep 仅命中自身 | "本地建议"面板，`defineEmits(['go-todos'])` 已定义但无任何父组件监听 |

> 设计文档 `docs/.../specs/2026-08-13-workbench-design.md:38` 提到驾驶舱包含"本地建议"，但**源码中该面板未被挂载**。属于"README/设计文档有，实际未接线"。

### 5.6 组件是否过于耦合 / 是否有巨型组件

**耦合情况：良好偏中等。**
- 组件**不通过 props 层层传递数据**，而是各自 `import { workbench }` 直接调 IPC。好处是简单直接；代价是**没有单一数据源**（见 5.7 的一致性问题）。
- 父组件通过 `defineEmits` 向上通知导航（`Sidebar` 的 `navigate`、`TodayTodos` 的 `go-todos`）。

**巨型组件排行（按行数）：**

| 文件 | 行数 | 其中 `<style>` 占比 |
| --- | --- | --- |
| `views/BookshelfView.vue` | 720 | 约 270 行样式 |
| `components/TodoPanel.vue` | 646 | 约 340 行样式 |
| `components/BookReader.vue` | 563 | 约 290 行样式 |
| `views/CalendarView.vue` | 459 | 约 110 行样式 |
| `electron/main.cjs` | 1,263 | —（**最大的结构性问题，见 5.8**） |

**结论：单文件最坏 720 行，且大半是 scoped CSS，逻辑部分并不臃肿。** 真正的巨型文件是 `electron/main.cjs`（1,263 行，含 92 个 IPC handler + 目标周期同步算法 + 书籍解析算法）。

### 5.7 是否存在重复代码（已核实的 3 处）

1. **`todos` 状态双份**：`TodoPanel.vue:133` 自己维护 `const todos = ref([])`，而 `TodayTodos.vue:56` 与 `DashboardWelcome.vue:49` 用 `useTodosStore()` 的模块级单例。两者不互通 —— 在待办页勾选完成，回到驾驶舱时 `useTodosStore` 的缓存可能是旧的（依赖 `onMounted` 重新 `loadTodos()` 兜底）。
2. **四象限定义双份**：`utils/quadrant.js:1-6` 有 `QUADRANTS`，`TodoPanel.vue:142-147` 又内联了一份 `quadrants`（含 `rank`），`CalendarView.vue` 则用 `quadrant.js` 的版本。`TodoPanel` 未复用工具模块。
3. **`maxTasks = 10`** 在 `TodoPanel.vue:139` 定义并显示为 `{{pendingCount}} / {{maxTasks}}`，**但没有任何地方做限制**，超过 10 条时会显示如 `12 / 10`。

### 5.8 新增一个一级功能页面：困难还是容易？

**非常容易 —— 这是本项目最适合扩展的一点。** 只需 3 处改动：

1. 新建 `src/renderer/src/views/XxxView.vue`
2. `App.vue:27-35` 加一行 `import`，`App.vue:51-61` 的 `viewMap` 加一个 key
3. `Sidebar.vue:85-95` 的 `baseNavItems` 加一个 `{id, icon, label}`（图标名需在 `LineIcon.vue` 里已存在，否则回退）

**无路由配置、无权限、无懒加载、无面包屑需要处理。**

### 5.9 如果新增 Workspace 页面，接入点精确定位

| 位置 | 具体改动 |
| --- | --- |
| `src/renderer/src/App.vue:27-35` | 新增 `import WorkspaceView from './views/WorkspaceView.vue';` |
| `src/renderer/src/App.vue:51-61` | `viewMap` 中加 `workspace: WorkspaceView,` |
| `src/renderer/src/components/Sidebar.vue:85-95` | `baseNavItems` 中加 `{ id: 'workspace', icon: 'workspace', label: '工作空间' }` |
| `src/renderer/src/components/LineIcon.vue` | 需要新增一个 `workspace` 图标 path（否则图标缺失，但不会报错） |
| `src/renderer/src/views/DashboardView.vue:11-46` | （可选）在驾驶舱挂一个"最近工作空间"卡片 |
| `src/renderer/src/App.vue:11-16` | ⚠️ 注意：`<component :is>` 传了 `:settings` 和两个事件，WorkspaceView 可直接声明 `defineProps({settings})` 复用 |

**注意没有地方需要动 `main.cjs` 的路由相关代码，因为不存在路由。**

---

## 6. 当前数据存储设计

### 6.1 数据到底保存在哪里（真实代码依据）

`electron/main.cjs:14-34`：

```js
function configRoot() {
  return path.join(app.getPath('documents'), '小菠萝的工作台');   // :15
}
function configFile() { return path.join(configRoot(), 'config.json'); }  // :19
function configuredDataRoot() {   // :22-30  读 config.json 的 dataRoot
  ...
}
function dataRoot() { return configuredDataRoot() || configRoot(); }  // :32-34
```

**结论：**
- **默认位置**：`C:\Users\<用户名>\Documents\小菠萝的工作台\`（**`app.getPath('documents')`，不是 `userData`**）
- **可迁移**：用户可通过 `settings:change-data-dir`（`main.cjs:662-688`）把数据目录搬到别处，新路径写入 `Documents\小菠萝的工作台\config.json` 的 `dataRoot` 字段，然后 `app.relaunch()` 重启
- **已实测确认**：本机 `C:\Users\86185\Documents\小菠萝的工作台\` 真实存在，结构如下

```text
小菠萝的工作台/
├─ config.json                 # 仅当用户改过数据目录时才存在
├─ data/                       # 17 个 JSON（业务数据）
│  ├─ app-groups.json    apps.json         book-categories.json
│  ├─ book-stores.json   bookmarks.json    books.json
│  ├─ calendar-events.json  checkins.json  daily-review.json
│  ├─ files.json         goals.json        images.json
│  ├─ notes.json         reader.json       settings.json
│  ├─ todos.json         workflows.json
├─ thumbs/apps/                # 快捷应用图标 PNG（已实测 63 个）
├─ thumbs/images/              # 图片缩略图 PNG
├─ books/                      # 从在线书城下载的书籍文件
├─ backups/                    # backup:export 的产物
└─ logs/                       # DataStore 已建目录，但全项目无任何写入代码
```

**⚠️ 注意：`logs/` 目录被 `store.cjs:12,24` 创建、被 `main.cjs:660` 暴露为"打开日志目录"，但没有任何日志写入实现 —— 是空目录。**

### 6.2 当前到底有多少类数据（从代码 + 真实文件双重确认）

**核心业务数据 17 类**，全部经 `DataStore.read/write` 读写，文件名硬编码在各处：

| # | 文件 | 读取位置（函数） | 真实条数（本机） |
| --- | --- | --- | --- |
| 1 | `todos.json` | `main.cjs:77` `readTodos()` | 0 |
| 2 | `goals.json` | `main.cjs:69` `readGoals()` | 0 |
| 3 | `workflows.json` | `launcher.cjs:4` `readWorkflows()` | 1 |
| 4 | `apps.json` | `apps.cjs:7` `readApps()` | **63** |
| 5 | `app-groups.json` | `apps.cjs:15` `readGroups()` | 6 |
| 6 | `files.json` | `files.cjs:75` `readFavorites()` | 2 |
| 7 | `images.json` | `files.cjs:118` `readImages()` | 0 |
| 8 | `notes.json` | `files.cjs:191` `readNotes()` | 0 |
| 9 | `bookmarks.json` | `main.cjs:153` `readBookmarks()` | 2 |
| 10 | `calendar-events.json` | `main.cjs:161` `readCalendarEvents()` | 0 |
| 11 | `daily-review.json` | `main.cjs:315` `readReviews()` | 12 |
| 12 | `checkins.json` | `main.cjs:133` `readCheckins()` | 11 |
| 13 | `books.json` | `main.cjs:339` `readBooks()` | 2 |
| 14 | `book-categories.json` | `main.cjs:347` `readBookCategories()` | 0 |
| 15 | `book-stores.json` | `main.cjs:360` `readBookStores()` | 2 |
| 16 | `settings.json` | `main.cjs:538` | 1（对象） |
| 17 | `reader.json` | `main.cjs:441` `readReaderState()` | 1（对象） |

**另有 2 类非 JSON 数据**：`thumbs/apps/*.png`（63 个）、`thumbs/images/*.png`。

### 6.3 每种数据的 Schema（从真实 JSON 提取字段名，不含任何用户内容）

> 以下字段名 100% 来自真实文件与源码，未泄露任何实际值。

#### Todo（`todos.json`，数组）
```js
{
  id,                  // string, UUID v4 —— main.cjs:819
  title,               // string
  priority,            // 'high'|'medium'|'low'，main.cjs:817 默认 'medium'
  importance,          // 'high'|'low' —— main.cjs:822（缺失时由 priority 推导）
  urgency,             // 'high'|'low' —— main.cjs:823
  dueDate,             // 'YYYY-MM-DD' | null
  reminderAt,          // datetime-local 字符串 | null
  reminderFired,       // boolean，初始 false
  completed,           // boolean
  sort,                // number，Date.now() 或 reorder 写入的序号
  createdAt, updatedAt,// ISO 8601
  // —— 以下仅长期目标自动生成的任务才有 ——
  generated,           // true —— main.cjs:268
  sourceGoalId,        // goal.id   —— main.cjs:269
  sourceDate           // 'YYYY-MM-DD' —— main.cjs:270
}
```
**四象限不是存储字段，而是由 `importance` × `urgency` 实时计算**（`utils/quadrant.js:8-15` `getQuadrant()`）。

#### Goal（`goals.json`，数组）
```js
{
  id, title, description, note,
  progress,            // number，注意：创建时写 0，但 list 时被覆盖计算
  period,              // string，默认 'month'（UI 未使用）
  targetDate,          // 'YYYY-MM-DD' | null
  recurrence: { type, days: [] },  // type: 'none'|'daily'|'weekly'
  recurrenceTask,      // string，生成的待办标题
  completedDates: [],  // ['YYYY-MM-DD', ...] 打卡日期集合
  createdAt, updatedAt
}
```
list 时由 `goalsWithProgress()`（`main.cjs:213-215`）**附加计算字段**：`checkinCount`、`scheduledCount`、`progress`。

#### Workflow（`workflows.json`，数组）—— 用户重点关注
```js
{
  id,                  // UUID v4
  name,                // string
  steps: [             // 数组，元素结构固定为 5 个字段
    {
      id,              // 前端生成：`step-${Date.now()}-${++stepSeed}` —— WorkflowPanel.vue:78
      type,            // 'app' | 'file' | 'url'   ← 只有这三种！
      appId,           // type='app' 时使用，引用 apps.json 的 id
      path,            // type='file' 时使用，绝对路径字符串
      url              // type='url' 时使用
    }
  ],
  sort, createdAt, updatedAt
}
```
> **真实数据验证**：本机 `workflows.json` 有 1 条工作流，4 个 step，全部 `type='app'`，每个 step 都带齐 `id/type/appId/path/url` 五个字段（`path` 和 `url` 为空串）。**证实了"三个字段并存、按 type 取用"的设计。**

#### App（`apps.json`，数组）
```js
{
  id,            // UUID v4
  name,          // 用户可改
  path,          // 绝对路径（exe/lnk/bat/cmd）
  groupId,       // 引用 app-groups.json 的 id，默认 'default'
  iconFile,      // 'thumbs/apps/{id}.png' 的文件名（不是完整路径）
  sort,          // number，拖拽排序序号
  createdAt,
  lastLaunched,  // ISO | null —— launcher.cjs:26 启动成功时写入 ⭐
  launchCount,   // number   —— launcher.cjs:27 每次 +1        ⭐
  iconRepaired   // boolean，.lnk 图标修复标记（apps.cjs:213）
}
```
**⭐ 重要发现：`lastLaunched` 和 `launchCount` 已经被真实维护（本机 apps.json 63 条记录均含这两个字段），但没有任何 UI 使用它们。** 这是 Workspace 的"最近使用/继续工作"功能的**现成基础设施**。

#### FileFavorite（`files.json`，数组）
```js
{ id, path, name, type, createdAt }   // type: 'file' | 'folder'（files.cjs:104）
```

#### ImageEntry（`images.json`，数组）
```js
{ id, path, name, thumbFile, createdAt }
// thumbFile = `${id}.png`，位于 thumbs/images/（files.cjs:163）
// IPC list 时被 hydrateImage() 附加 thumbnailDataUrl（base64）
```

#### Note（`notes.json`，数组）
```js
{ id, title, content, pinned, createdAt, updatedAt }
// 注意：files.cjs:199-212 的 addNote 不写入 type 字段，
// 但 main.cjs:92 创建的"快速便签"额外有 type: 'quick'
// → 便签存在两种"形态"，靠 type==='quick' 区分
```

#### Bookmark（`bookmarks.json`，数组）
```js
{ id, type, url, title, note, createdAt, updatedAt }
// type 默认 'article'（main.cjs:963）；UI 侧类型待第 7 章确认
```

#### CalendarEvent（`calendar-events.json`，数组）
```js
{ id, date, title, note, createdAt, updatedAt,
  // 长期目标生成时额外有：
  generated, sourceGoalId, sourceDate
}
```

#### DailyReview（`daily-review.json`，数组）
```js
{
  date,            // 'YYYY-MM-DD'（唯一键，无 id！）
  readingMinutes,  // number
  focusMinutes,    // number
  answers: { whatDid, whatLearned, whatImprove },
  updatedAt
}
```
**⚠️ 这是唯一以业务日期而非 id 作为主键的数据表**（`main.cjs:1042` 用 `findIndex(item => item.date === date)`）。

#### Checkin（`checkins.json`，**字符串数组**）
```js
["YYYY-MM-DD", "YYYY-MM-DD", ...]   // 不是对象数组！
```
已实测确认：真实文件是 `["2026-08-13", "2026-08-14", ...]`。连续天数由 `computeStreak()`（`main.cjs:141-151`）计算。

#### Book（`books.json`，数组）
```js
{
  id, title, path, ext,
  categoryId,      // string | null
  favorite,        // boolean
  coverDataUrl,    // ⚠️ base64 data URL（main.cjs:1077 存 360px PNG）→ 导致文件膨胀
  addedAt, updatedAt
}
```
**⚠️ 性能风险**：本机 `books.json` 已达 **59,479 B**（相对其他文件大 100 倍以上），因为封面以 base64 内联。`books:list` 每次都要整体 `JSON.parse` 并全量传给渲染层。

#### BookCategory（`book-categories.json`）
```js
{ id, name, createdAt }
```

#### BookStore（`book-stores.json`）
```js
{ id, name, url, builtin, createdAt? }
// builtin=true 的两条为硬编码默认（main.cjs:355-358）
// readBookStores() 每次读都会把默认项合并回去并回写（main.cjs:360-373）
```

#### ReaderState（`reader.json`，**对象**）
```js
{
  prefs: { fontSize, lineHeight, fontFamily, theme },
  progress: {
    "<bookId>": { chapter: number, scroll: number }
  }
}
```
**⭐ 这是全项目唯一的"以 id 为键的字典（Map-like）"结构**，非常适合作为 Workspace 关联数据的参考范式。

#### Settings（`settings.json`，**对象**）
```js
{
  theme,                    // 'light' | 'dark'
  user: { name, avatarDataUrl },
  navOrder: [],             // 菜单顺序 id 数组
  launchAtStartup,          // boolean
  timerRingtone: { type, id, name?, dataUrl? },
  extensions: { cloudBackup },        // ⚠️ 见下
  chatProviders: { doubao, deepseek, qwen, gpt }, // {enabled,url,label}
  dashboardWidgets,         // string[]（DashboardView.vue:74,83 读写，未在 defaults 中声明）
  // ⚠️ 真实文件里还有 defaults 里没有的：
  weatherLocation: { name, latitude, longitude }
}
```

### 6.3.1 README 与真实数据的 2 处不一致（重要）

| README 声明 | 真实情况 | 证据 |
| --- | --- | --- |
| "天气、备份等可选联网能力默认关闭" | **源码中完全没有天气功能**。`settings.json` 里残留 `weatherLocation`、`extensions.weather: true`，但全仓库 grep `weather` **0 命中**（除 README 与数据文件本身） | grep 实测 |
| "移动端数据管理等"（用户描述）/ README"备份" | `SettingsView.vue` 只有：用户、主题、开机自启、数据目录、导出/导入备份、计时器铃声、删除数据、关于。**没有 `extensions` 开关 UI，没有"移动端数据管理"** | `SettingsView.vue` 全文 330 行 |

> `defaults.cjs:18-20` 定义了 `extensions: { cloudBackup: false }`，但**没有任何 UI 或逻辑读取它** —— 属于预留的空壳。

### 6.4 ID 机制

**结论：统一使用 `crypto.randomUUID()`（标准 UUID v4），无冲突风险。**

依据：`electron/defaults.cjs:1-5`

```js
const crypto = require('node:crypto');
function id() { return crypto.randomUUID(); }
```

- 所有主进程创建的实体（todo/goal/app/book/note/bookmark/event/book-store/category/group/workflow）都调用 `id()`。
- 真实数据验证：apps.json 的 id、book id、workflow id 全部是标准 UUID 格式（如 `0c4c76a3-4b5d-437f-af74-ecc7c303125e`）。
- **唯一例外（3 处，均无实际冲突风险）：**
  1. **Workflow step id**：由**前端**生成 `step-${Date.now()}-${++stepSeed}`（`WorkflowPanel.vue:78`）。这是字符串拼接而非 UUID，但 `stepSeed` 是模块级自增 + 时间戳，同一会话内不会重复。
  2. **分组默认 id**：硬编码字符串 `'default'`（`defaults.cjs:8`），业务上唯一。
  3. **DailyReview 主键**：用 `date` 字符串而非 id。
- **无自增 id、无时间戳 id（实体层面）、无随机数 id。**

### 6.5 数据访问方式：A / B / C 判定

**答案：A —— 数据层比较清晰（集中度意外地高，这是本项目的隐性优势）。**

依据（三层结构，职责分明）：

```text
第 1 层：唯一存储原语
  electron/store.cjs  →  class DataStore
    · filePath(name)      :30   拼 data/ 下文件名
    · read(name, defaults):34   读 + JSON.parse，损坏时改名备份并重建
    · write(name, data)   :54   写临时文件 + rename（原子替换）

第 2 层：领域服务（只调 store.read/write，不直接碰 fs 业务文件）
  electron/services/apps.cjs      →  readApps / writeApps / readGroups / ...
  electron/services/files.cjs     →  readFavorites / readImages / readNotes / ...
  electron/services/launcher.cjs  →  readWorkflows / writeWorkflows / runWorkflow
  electron/services/backup.cjs    →  exportBackup / importBackup
  electron/main.cjs               →  readTodos / readGoals / readBookmarks / ...（11 组）

第 3 层：渲染层
  组件 → workbench.<域>.<方法>() → preload 白名单 → ipcMain.handle → 服务层 → DataStore
```

**渲染层绝对不直接读 JSON**：没有任何 `fs` / `path` 出现在 `src/renderer` 中（grep 已确认）。这是很好的隔离。

**扣分项（为什么不是"完美清晰"）：**
1. **`main.cjs` 承担了过多领域逻辑**：11 组实体的 read/write 帮手函数（`readTodos`/`writeTodos`/`readGoals`/... 共 22 个函数）全部内联在 `main.cjs:69-377`，而非像 apps/files 那样收进 `services/`。**main.cjs 有 1,263 行，其中约 300 行是可外提的数据访问代码。**
2. **同一份数据存在多个写入者**：例如 `apps.json` 同时被 `main.cjs`（apps:update/delete/reorder）和 `apps.cjs`（addApp/scanDesktop/addBatch/ensureIcons）读写；`notes.json` 同时被 `files.cjs` 和 `main.cjs`（快速便签）读写。
3. **没有 repository 抽象层**：`store.read('todos.json', [])` 这样的字符串字面量散落在 30+ 处，拼错文件名不会被任何机制发现（只会静默创建空文件）。

### 6.6 数据写入安全性（逐条核实）

| 检查项 | 结论 | 依据 |
| --- | --- | --- |
| 是否直接覆盖 JSON | **否，采用"临时文件 + rename"** | `store.cjs:56-59`：`tmp = file.tmp-${pid}` → `writeFileSync(tmp)` → `renameSync(tmp, file)` |
| 是否有临时文件 | **有** | `store.cjs:56` |
| 是否原子写入 | **基本是**。`fs.renameSync` 在同分区上是原子的，因此**不会出现"写一半的 JSON"**。⚠️ 但：① 没有 `fsync`，断电时可能丢最后一次写入；② 未处理 `rename` 的 EPERM（Windows 上若文件被杀软/索引器占用，rename 可能抛错） | `store.cjs:59` |
| 写坏 JSON 怎么处理 | **有自愈**：`read()` 解析失败 → 把坏文件改名为 `xxx.json.broken-{timestamp}` → 写回默认值 → 返回默认值 | `store.cjs:42-51` ⭐ 设计良好 |
| 是否有备份 | **有**，但仅手动。`backup:export` 把 `data/` 下所有 `.json` 打包成一个文件写入 `backups/backup-{时间戳}.json` | `backup.cjs:4-21` |
| 是否有版本号 | **否**。JSON 里没有 `version` / `schemaVersion` 字段，备份文件里有 `app` 和 `exportedAt` 但没有数据版本 | `backup.cjs:17` |
| 是否有 schema migration | **完全没有**。全项目 grep 无 migrate/upgrade/schemaVersion 逻辑 | — |
| 数据格式升级怎么办 | **当前无机制**。只能靠代码里的"读时兜底"（如 `todo.importance \|\| (todo.priority==='low'?'low':'high')`，`quadrant.js:9-10`）。这是**加 Workspace 时最需要注意的地方**（见 8.2） |
| 多处同时保存是否可能冲突 | **几乎不会**。`ipcMain.handle` 的回调虽为 async，但每个 handler 内部全是**同步** `readFileSync/writeFileSync`，Node 单线程下不会交错，等效于串行化。⚠️ 唯一隐患：`TodoPanel.vue:271` 用 `Promise.all(completed.map(...remove))` 并发发起 N 个 `todos:delete`，虽然最终因串行而结果正确，但**N 次全量读写**效率低，且若中途某次失败会留下"部分删除" | `TodoPanel.vue:265-273` |

**⭐ P0 风险（必须记录，不得修复）：`backup:import` 存在路径穿越漏洞**

`backup.cjs:40-45`：
```js
for (const [name, content] of Object.entries(data)) {
  if (!name.endsWith('.json')) continue;
  if (typeof content !== 'object' && !Array.isArray(content)) continue;
  store.write(name, content);   // ← name 来自备份文件，未做路径净化
  count += 1;
}
```
`store.write(name)` → `path.join(this.dataDir, name)`（`store.cjs:31`）。
若备份文件的 `data` 对象包含键 `..\\..\\..\\evil.json`（以 `.json` 结尾，绕过检查），`path.join` 会解析到**数据目录之外**，实现任意位置写入 `.json` 文件。
- **后果**：用一个精心构造的"备份文件"可向用户磁盘任意目录写 JSON 文件。
- **利用前提**：需要用户主动"导入备份"并选择攻击者的文件 → 属于"需要用户交互的中危"问题，但对一个主打"数据自主"的应用仍是明显缺陷。
- **建议方向**（未来）：`path.basename(name)` 净化 + 校验 `path.resolve(result).startsWith(dataDir)`。**本次不修。**

---

## 7. 各模块真实实现情况

分类标准：**【已完整实现】/【部分实现】/【只是页面/UI】/【README 有但源码未发现】/【存在明显 Bug 风险】**

| # | 模块 | 判定 | 依据与说明 |
| --- | --- | --- | --- |
| 1 | **Dashboard** | 【已完整实现】 | `DashboardView.vue` 组合 6 个子组件；小组件增删持久化到 `settings.dashboardWidgets`（`:71-96`） |
| 2 | **快捷应用** | 【已完整实现】 | 添加单文件（`AppLauncher.vue:165-172`）、扫描桌面/文件夹并多选批量添加（`:219-278`）、编辑名称与分组（`:185-204`）、删除、**拖拽排序**（`:313-345`）、分组 CRUD、图标自动读取（`apps.cjs:97-107`）、**.lnk 真实目标解析**（`apps.cjs:39-73`）、图标自愈重取（`ensureIcons`）、`lastLaunched`/`launchCount` 埋点 |
| 3 | **Todo** | 【已完整实现】 | CRUD、完成切换、清除已完成、截止时间、提醒时间、仅看未完成筛选 |
| 4 | **四象限** | 【已完整实现】 | `importance`×`urgency` → 4 象限实时计算（`quadrant.js:8-15`），排序 `sortTodosByQuadrant`（`:17-27`），表单内实时预览（`TodoPanel.vue:102-104`） |
| 5 | **长期目标** | 【已完整实现】 | 目标 CRUD、`daily/weekly` 周期、打卡、进度自动计算（`main.cjs:204-215`）、**自动同步到待办**（`:228-274`）、**自动同步到日历**（`:276-312`）、每小时定时同步（`:1232`）、双向联动（勾选待办→回写打卡，`:845-847`） |
| 6 | **日历** | 【部分实现，且有错误数据】 | 月视图、日程 CRUD、待办截止日叠加、农历都真实可用。**但：① "节气"完全不存在**（见 7.1）；② **法定节假日硬编码表 `holidayMap` 的 2026 年春节日期全部错误**（把 2025 年的日期当 2026 年，见 B12）；③ 单日条目上限 3 条且无溢出提示（B6）；④ 翻月后"添加日程"会建到旧日期上（B20） |
| 7 | **收藏夹** | 【已完整实现】 | `BookmarksView.vue` 108-… 类型/URL/标题/备注 CRUD |
| 8 | **今日复盘** | 【部分实现】 | 待办完成度、阅读/专注分钟、三问、防抖保存、历史列表都真实。**但存在 P1 数据污染问题**（见下） |
| 9 | **文件收藏** | 【已完整实现】 | 收藏文件/文件夹、去重（`files.cjs:93`）、点击调系统打开、在文件夹中显示、驱动器枚举（`files.cjs:6-16` 遍历 A:-Z:） |
| 10 | **图片** | 【已完整实现】 | 添加时生成 360px 缩略图存 `thumbs/images/`（`files.cjs:157-168`）、列表时转 base64 供预览、删除时同步清理缩略图（`:175-189`） |
| 11 | **Markdown 便签** | 【已完整实现】 | 编辑/预览双模式、500ms 防抖保存、自研 Markdown 解析器（标题/列表/引用/代码块/行内代码/粗斜体/链接）。⚠️ 有一个丢字 bug（见下） |
| 12 | **我的书架** | 【已完整实现】（偏重） | 本地书籍添加、分类、封面、收藏、**章节自动解析**（`main.cjs:479-507`）、**4 种编码识别**（UTF-8/BOM/UTF-16LE/BE/**GB18030**，`:453-477`）、30MB 上限、在线阅读器（字号 14–30、行高 1.5–2.6、6 种字体、4 种配色）、阅读进度按书记忆、内置在线书城 webview + **下载自动入库**（`:1234-1251` + `books:changed` 事件） |
| 13 | **AI 网页入口** | 【已完整实现】（作为网页容器） | 见第 9 章专项 |
| 14 | **工作流** | 【部分实现，能力远低于直觉】 | 见第 8 章专项 |
| 15 | **设置** | 【部分实现】 | 用户/主题/自启/数据目录迁移/备份/铃声/清空数据均真实。**缺失**：`extensions` 开关 UI、天气、移动端数据管理。⚠️ `chatProviders` 的启用开关**存了但没生效**（见下） |
| 16 | **备份恢复** | 【已完整实现】（有 P0 缺陷） | 导出：遍历 `data/*.json` 合并为一个文件 → 写 `backups/`（`backup.cjs:4-21`）。导入：文件选择器 → 解析 → 逐文件写回（`:23-47`）。⚠️ **导入是"合并/覆盖"而非"替换"，且不校验、不清空旧数据**；UI 提示"重启应用后生效"是对的（`SettingsView.vue:223`） |
| 17 | **数据导入导出** | 【已完整实现】（同上） | 即备份的 export/import。**没有单项模块（如只导出待办）的导出功能** |
| 18 | **开机启动** | 【已完整实现】 | `app.setLoginItemSettings`（`main.cjs:59-67`），切换开关即时生效（`main.cjs:553-555`）；启动时按已存设置再次应用（`:1230`） |
| 19 | **主题** | 【已完整实现】 | `settings.theme` → `App.vue:65-68` `applyTheme()` 写 `document.documentElement.dataset.theme`；`styles.css` 用 `:root[data-theme='dark']` 覆盖 CSS 变量 |
| 20 | **拖拽排序** | 【已完整实现】 | 原生 HTML5 DnD 两处：快捷应用卡片（`AppLauncher.vue:313-345` → `apps:reorder`）、侧边菜单（`Sidebar.vue:139-166` → `settings.navOrder`）。主进程 `reorder` 用 `sort = 数组下标` 持久化。⚠️ 工作流的 `workflows:reorder` 通道**已实现但前端无任何拖拽 UI** |

### 7.1 判定为"README 有但源码未发现"

| README 声明 | 真实情况 |
| --- | --- |
| 日历含"**节气**"展示 | **源码中零实现**。`grep 节气\|立春\|冬至\|solarTerm` → 0 命中。`lunar.js` 只做农历转换 + 节日判断，**没有节气算法也没有节气表** |
| "天气、备份等可选联网能力默认关闭" | **天气功能完全不存在**，仅 `settings.json` 残留字段 |
| "本地建议"（设计文档提及） | `SuggestionPanel.vue` 存在但**从未被挂载** = 死代码 |
| 设置含"移动端数据管理" | **不存在**，`SettingsView.vue` 无此区块 |
| README 快速开始列出 `Xiaoboluo-Workbench-0.1.2-setup.exe` | 真实产物名是 `小菠萝的工作台-0.1.2-安装包.exe`（`package.json` `nsis.artifactName` + `dist-release/v0.1.2/` 实测）。**README 的下载链接文件名与实际产物不一致** |

### 7.2 判定为"存在明显 Bug 风险"（详见第 17 章）

| ID | 模块 | 问题 | 位置 |
| --- | --- | --- | --- |
| B1 | 待办提醒 | **`new Notification(...)` 在 Electron 中不会工作** —— 主进程未设置 `app.setAppUserModelId()`，且 Electron 的 Web Notification 需要主进程支持。`TodoPanel.vue:277` 被 `try/catch` 包住，失败后走 `toast()` 兜底，但 `try/catch` **捕获不到"静默不显示"**，因为构造 `Notification` 本身不抛错。**结果：提醒功能实际不可靠**，且 `reminderFired` 已被置 true（`:290`）→ **提醒只触发一次，用户可能完全没看到，之后永久不再提醒** | `TodoPanel.vue:275-293` |
| B2 | 便签 | **切换便签会丢掉最后 500ms 的输入**。`scheduleSave()`（`:75-78`）延迟 500ms 保存，但 `selectNote()`（`:63-67`）直接覆盖 `selected`，且 **NotesPanel 没有 `onBeforeUnmount`**（对比 `ReviewView.vue:176-181` 有 flush，`NotesPanel.vue` 没有） | `NotesPanel.vue:63-88` |
| B3 | 今日复盘 | **读操作写盘污染数据**：`getReviewRecord(date)`（`main.cjs:323-338`）在记录不存在时**会创建并写入**一条空记录。`ReviewView.vue:130` 的 `loadData()` 会调用 `review.get`，因此**只要打开一次复盘页就产生一条空记录**。本机 `daily-review.json` 已有 12 条（2026-08-13 起），其中相当部分是空壳 | `main.cjs:331-336` + `ReviewView.vue:127-136` |
| B4 | 设置/对话 | **AI 服务的 `enabled` 开关被持久化但完全不生效**：`ChatView.vue:78-81` 用 `{ enabled: true, ...(configured.doubao || {}) }` —— 正确读取了配置；但本机 `settings.json` 中 `gpt.enabled = false`，页面上 GPT 仍然可点。原因是 `enabled` 虽然被读到，但 `qwen`/`gpt` 分支做了**字段挑选式解构**（只取 `label` 和 `url`，**丢弃了 `enabled`**），而 doubao/deepseek 分支虽然展开了 `...configured.x`，却没有 UI 可以关闭它们 | `ChatView.vue:73-83` |
| B5 | 待办计数 | `maxTasks = 10` 硬编码且无实际限制，待办超 10 条时显示 `12 / 10` 这类误导性文案 | `TodoPanel.vue:139, 15` |
| B6 | 日历 | 单日最多渲染 3 条日程 + 3 条待办（`.slice(0,3)`），**超出部分静默消失且无"+N"提示** | `CalendarView.vue:242, 246` |
| B7 | 日历 | `holidayMap` **只硬编码了 2026 年**的法定节假日（`:129-160`）。切到 2025 或 2027 年，法定节假日全部消失（农历节日仍正常，因由 `lunar.js` 计算） | `CalendarView.vue:129-160` |
| B8 | 快捷应用 | `iconToDataUrl()` 对相对路径做了 `path.join(app.getPath('documents'), '..', filePath)` 这种可疑处理（`apps.cjs:31`）—— 把文件路径拼到"文档的上级目录"下，逻辑上不正确。实际调用时传的是绝对路径（`apps.cjs:116`），所以**暂时不会触发**，属潜在陷阱 | `apps.cjs:28-37` |
| B9 | 工作流 | `openExternal()` 未 await 且**永远返回 `{ok:true}`**，导致工作流中 `type='url'` 的步骤**永远不可能报告失败** | `launcher.cjs:42-45` + `:63` |
| B10 | 工作流 | `runWorkflow` 遇第一个失败步骤即 `return`，但**已执行的步骤不会回滚**，且**失败前的部分执行结果被丢弃**（`results` 不返回给 UI —— `main.cjs:928-930` 抛错时只带 message） | `launcher.cjs:68-72` + `main.cjs:926-932` |
| B11 | 书架阅读器 | **阅读滚动位置永远无法恢复（写了但从来不生效）**：`load()` 中 `loading` 直到 `finally`（`:247`）才置 false，而 `await nextTick()`（`:239`）发生时模板仍走 `<main v-if="loading">`（`:16`），`ref="contentEl"` 所在的 `<main v-else>`（`:33`）尚未渲染 → `contentEl.value` 为 null → `:241` 的 `contentEl.scrollTop = saved.scroll` **从不执行**。`reader.json` 里的 `scroll` 是死数据 | `BookReader.vue:239-247` |
| B12 | 日历 | **`holidayMap` 的 2026 年春节日期全部错误**：`:131-138` 把 `2026-01-28` 当除夕、`2026-01-29~02-04` 当春节。用**该应用自己的 lunar.js** 计算，2026-01-28 实为农历腊月初十，真正的除夕是 **2026-02-16**、春节是 **2026-02-17**；而 `01-28=除夕 / 01-29=春节` 恰好是 **2025 年**的日期。后果：2026 年日历上"除夕"出现两次、"春节"出现 8 天 | `CalendarView.vue:129-160` |
| B13 | 便签 | **"快速便签"会被当成普通便签列出且可被删除，导致静默数据丢失**：`files:notes:list`（`main.cjs:882`）直接返回 `readNotes(store)`，**未过滤 `type === 'quick'`**；而删除它（`NotesPanel.vue:90-96` → `files:notes:delete` → `files.cjs:227-231`）会清空内容，下次 `getQuickNote` 以 `content:''` 重建 | `main.cjs:882` + `NotesPanel.vue:56-96` |
| B14 | 文件浏览 | **无权限目录导致整条失败链静默**：`files.cjs:46` 的 `fs.readdirSync(current)` **不在 try 内**（同函数的 `statSync` 在 try 内，`:48-59`），进入 `C:\System Volume Information` 之类目录会抛 EPERM → `safeHandle` 包成 `ok:false` → preload `throw` → `FileBrowser.browse`（`:105-113` 只有 try/finally，**无 catch**）拒绝 → 三个调用点（`:37` 的 dblclick、`goToPath:115`、`jumpToSegment:120`）全无 catch → **界面不显示任何错误** | `files.cjs:46` + `FileBrowser.vue:105-123` |
| B15 | 收藏/文件 | **路径去重大小写语义两层不一致**：主进程 `addFavorite` 用**大小写敏感**的 `item.path === normalized`（`files.cjs:93`），而渲染层 `FileBrowser.isFavorite`（`:131`）与 `toggleFavorite`（`:142`）用 `toLowerCase()` → Windows 上同一路径不同大小写会产生**两条收藏记录**；★ 对两条都点亮，取消收藏只删第一条 → **星标与数据不一致** | `files.cjs:93` vs `FileBrowser.vue:66-68,131,142` |
| B16 | 死组件 | **`Modal.vue` 从不 emit `update:modelValue`**（只 `defineEmits(['close'])`，`:27`），因此 8 个文件里 **11 处 `v-model="showXxxModal"` 实为单向绑定**，真正关弹窗靠各调用点的 `@close`。API 误导性强（唯一正确用法是 `ImagesPanel.vue:28` 的 `:model-value`） | `Modal.vue:21-27` |
| B17 | 便签 | **卸载后写盘 + null 解引用两条路径**：① `saveTimer = setTimeout(saveSelected, 500)`（`NotesPanel.vue:77`）在切 tab 卸载组件后仍会执行（无 `onBeforeUnmount`），且 `saveSelected` 无 try/catch → 真 unhandled rejection；② `updateNote` 在 id 不存在时 `return null`（`files.cjs:214-217`），preload 把 null 当正常数据返回 → `NotesPanel.vue:86` 的 `note.id` 抛 `TypeError` | `NotesPanel.vue:77,86` + `files.cjs:214-217` |
| B18 | 快速便签 | 同类缺陷：`QuickNoteWidget.vue:31-37` 的 `setTimeout(async …)` 回调**无 catch**（真 unhandled rejection）；`:45` 的卸载 flush 有 `if (quickContent.value)` 守卫 → **清空便签后 450ms 内离开，清空不落盘**（旧内容保留） | `QuickNoteWidget.vue:31-45` |
| B19 | 日历 | **长期目标派生的日程被删除后会"复活"**：`CalendarView.removeEvent`（`:316-318`）→ `main.cjs` 的 `calendar:delete`（`:1011-1015`）**不调用** `syncGoalRecurringTasks()`；而任何一次同步（由 `todos:update` `:848`、`goals:*` `:782/804/810` 触发）都会把缺失的生成日程重新插入（`:288-309`） | `CalendarView.vue:316-318` + `main.cjs:288-309,1011-1015` |
| B20 | 日历 | **选中日与显示月不同步**：`changeMonth`（`:269-271`）只改 `currentMonth` 不改 `selectedDate`，而"添加日程"用 `selectedKey` 作默认日期（`:282-286`）→ 翻月后点「添加日程」，日程被建到**不可见的旧日期**上 | `CalendarView.vue:269-286` |
| B21 | 书架 | **书城下载同名文件静默覆盖且书架不新增条目**：`will-download` 直接用远端文件名 `setSavePath(path.join(store.booksDir, filename))`（`main.cjs:1237-1238`），无去重/重命名；而 `addBookFromPath` 按 `path` 命中即返回**旧条目**（`:412-415`）→ 第二次下载同名书 = 磁盘旧书被覆盖 + 书架无变化 + 只发一次 `books:changed` | `main.cjs:412-415,1237-1246` |
| B22 | 书架 | **删除书籍不清理阅读进度**：`books:remove`（`main.cjs:1079-1083`）只改 `books.json`，`reader.json` 的 `progress[bookId]` 永久残留；重新添加同一文件会生成新 UUID（`:412-429`）→ 旧进度成孤儿、阅读位置丢失 | `main.cjs:1079-1083` |

---

## 8. 工作流模块专项分析（用户重点）

### 8.1 数据流全景

```text
WorkflowPanel.vue（编辑/展示/触发）
   ↓ workbench.workflows.list() / create / update / remove / run
preload.cjs:98-105
   ↓ IPC
main.cjs:889-932（workflows:* 六个 handler）
   ↓
launcher.cjs:readWorkflows / writeWorkflows   →  data/workflows.json
launcher.cjs:runWorkflow                       →  执行引擎（51-73 行，仅 23 行！）
```

### 8.2 工作流数据结构

见 6.3 的 Workflow 段。要点：
- 顶层：`{id, name, steps[], sort, createdAt, updatedAt}`
- 步骤：`{id, type, appId, path, url}`，**三个目标字段并存，按 `type` 取用其中一个**
- `type` 枚举**仅 3 个值**：`app` | `file` | `url`（UI 的 `<select>` 只有这 3 个 option，`WorkflowPanel.vue:37-41`）

### 8.3 用户逐项询问的能力矩阵（**全部基于 `launcher.cjs:51-73` 的 23 行实现**）

| 能力 | 是否支持 | 源码依据 |
| --- | --- | --- |
| **能不能启动 exe** | ✅ 支持 | `launcher.cjs:58-59` `type==='app'` → `launchApp(store, step.appId)` → `shell.openPath(appEntry.path)`。**注意是"打开路径"而非"exec 传参"** |
| **能不能打开文件** | ✅ 支持 | `launcher.cjs:60-61` `type==='file'` → `openPath(step.path)` → `shell.openPath` |
| **能不能打开文件夹** | ✅ **间接支持** | 没有独立类型，但 `shell.openPath` 对目录同样有效，用户把 `type` 选为"打开文件"并填目录路径即可。**UI 上没有任何提示这是可行的** |
| **能不能打开网页** | ✅ 支持（但不可靠） | `launcher.cjs:62-63` `type==='url'` → `openExternal(step.url)` → `shell.openExternal`。⚠️ 见 B9：不 await，永远报成功 |
| **是否支持顺序执行** | ✅ 支持 | `launcher.cjs:57` `for (const step of workflow.steps || [])` 严格顺序 |
| **是否支持延迟** | ⚠️ 仅固定延迟 | `launcher.cjs:65` `await delay(350)` —— **每步固定 350ms，用户不可配置** |
| **是否支持参数** | ❌ **不支持** | step 结构只有 `id/type/appId/path/url` 五个字段，无 `args`；`shell.openPath` 本身也不接受参数。**无法实现"用 VS Code 打开某个文件夹"这类带参启动**（除非把路径写死在 exe 快捷方式里） |
| **是否支持条件** | ❌ **不支持** | 无 `if`/`condition`/`when` 字段，无分支逻辑 |
| **是否支持任务操作** | ❌ **不支持** | 引擎里没有 todos/goals 相关分支。**不能"运行工作流时自动完成任务"** |
| **是否支持计时** | ❌ **不支持** | 引擎与 `useTimer.js` 无任何交集。工作流不会启动/停止计时器 |
| **是否有执行状态** | ❌ **不支持** | 无 `status`/`lastRunAt`/`runCount` 字段写入 `workflows.json`。**相比之下快捷应用有 `lastLaunched`/`launchCount`，工作流一个都没有** |
| **是否有异常处理** | ⚠️ 极简 | `launcher.cjs:68-71` 收集所有 result，找到第一个 `ok===false` 就整体返回 `{ok:false, error, results}`。**无重试、无跳过、无"忽略错误继续"** |
| **是否有执行历史** | ❌ **完全没有** | 无 `workflow-runs.json` 之类文件。执行完什么痕迹都不留（成功时连日志都没有） |

### 8.4 工作流模块的额外结论

1. **前端不显示执行结果**：`WorkflowPanel.vue:155-162` `runWorkflow()` 成功只弹 `已运行「名字」`，失败弹错误。**中间的 `results` 数组被浪费**（`main.cjs:931` 明明返回了它）。
2. **file 步骤没有文件选择器**：`WorkflowPanel.vue:48` 是纯文本 `<input v-model="step.path" placeholder="文件路径">`，**用户必须手打绝对路径**。这是明显的易用性缺陷（项目里已有 `system.selectFile` 可用却没用）。
3. **url 步骤没有格式校验**：同样是纯文本输入（`:49`）。
4. **`workflows:reorder` 通道已实现但 UI 未使用**（无 `draggable`）。
5. **`runWorkflow` 是全项目唯一的"多步自动化"代码，仅 23 行。** 这既是限制，也是机会：**Workspace 的"一键继续工作"可以复用这个引擎，只需扩展 step 类型。**

### 8.5 工作流真实能力一句话总结

> **当前工作流 = "一键按固定顺序打开若干个应用 / 文件 / 网页，每步间隔 350ms"。**
> 它是一个**启动器编排器**，不是自动化引擎。没有参数、条件、分支、计时、任务操作、状态记录和执行历史。

---

## 9. AI 模块专项分析

### 9.1 实现方式

**确认：是 `<webview>` 内嵌网页，共 4 个服务入口。**

`src/renderer/src/views/ChatView.vue:40-52`：

```html
<webview
  ref="webviewRef"
  class="chat-webview"
  :src="activeProvider.url"
  :partition="`persist:xiaoboluo-chat-${activeProvider.key}`"
  allowpopups
  @dom-ready="onReady"
  @did-start-loading="loading = true"
  @did-stop-loading="loading = false"
  @did-navigate="onNavigate"
  @did-fail-load="onFail"
></webview>
```

- **每个服务独立持久化分区**（`persist:xiaoboluo-chat-doubao` 等）→ 登录态互不干扰，且可持久保存
- 默认服务与 URL 在 `defaults.cjs:21-26`：豆包 `https://www.doubao.com/chat/`、DeepSeek `https://chat.deepseek.com/`、千问 `https://chat.qwen.ai/`、GPT `https://chatgpt.com/`
- 提供后退/刷新/在浏览器打开的工具栏（`ChatView.vue:12-16`）

### 9.2 用户逐项确认（全部核实）

| 询问项 | 结论 | 证据 |
| --- | --- | --- |
| **是否调用任何 AI API** | ❌ **完全没有** | 全项目 grep 无 `fetch`/`axios`/`XMLHttpRequest`/`openai`/`apiKey` 等 |
| **是否保存 API Key** | ❌ **没有** | `settings.json` 的 `chatProviders` 只有 `{enabled, url, label}` 三个字段；全项目无 key/token/secret 字段 |
| **是否存在后端模型** | ❌ **没有** | 无服务器代码、无 `net`/`http` 请求逻辑 |
| **是否存在 prompt** | ❌ **没有** | 无 prompt 模板、无 system message、无对话历史结构 |
| **是否读取用户本地数据** | ❌ **不读取** | ChatView 只从 `settings.chatProviders` 取 URL，**不传任何待办/文件/便签数据给网页**。webview 与主进程业务数据完全隔离 |
| **是否只是浏览器网页容器** | ✅ **是的** | 本质是一个带 4 个书签的受限浏览器标签页 |

### 9.3 准确命名建议

**不应称为"AI 助手"或"AI 对话"。** 更准确的命名（按推荐度排序）：

1. **「AI 服务快捷入口」** ← 最推荐，准确且对用户友好
2. **「内嵌 AI 网页」**
3. **「AI 网页门户」**

**不建议**：`AI 助手`（暗示自主性/会读数据/会执行任务，与事实完全不符）、`AI 对话`（暗示与工作台内建对话，实际是第三方网页）。

> README `:45` 的表述其实**是准确的**："内置豆包、DeepSeek、千问、GPT 网页入口，在工作台窗口内打开"。**参赛材料中不应把它描述为 AI 能力点**，否则评审现场演示会暴露它只是一个 webview。
>
> ⚠️ 另外注意 README `:161` 已明确："对话与在线书城使用内嵌浏览器打开用户主动访问的网页，由对应网站负责网络连接。" 与 README `:25` 的"完全离线：应用本体不主动联网"需要一起理解 —— 表述本身没问题，但"完全离线"这个措辞在评审语境下容易被追问。

---

## 10. Workspace 接入可行性

### 10.1 判定：**B —— 可以实现，改动中等**

**判定为 B（而非 A）的核心理由：** 数据层和页面接入极简单（A 级），但存在 3 个必须处理的"非平凡"问题：

1. **导航层没有路由**，因此"打开 Workspace"无法通过 URL 表达 → 需要引入一个**全局选中态**（新增 composable 单例），并让 `App.vue` 的 `activeView` 能携带参数。这是唯一需要"碰核心文件"的地方。
2. **跨页面状态会随组件卸载丢失**（第 5.1 节）→ 计时器这类状态必须放在模块级 composable 或主进程，"继续工作"流程才能跨页面存活。
3. **数据格式没有版本号和迁移机制**（第 6.6 节）→ 给 8 类现有数据加 `workspaceId` 时，必须写"向后兼容的读时兜底"，不能依赖迁移脚本。

**判定不为 C/D 的依据：**
- `DataStore` 是一个通用的 `read(name, defaults)/write(name, data)` KV 原语，**新增一个 `workspaces.json` 的成本几乎为零**（照抄 `readTodos/writeTodos` 两行即可）。
- 92 个 IPC 全走 `safeHandle` 统一模式，**新增通道是机械操作**。
- 新增一级页面只需改 3 个文件（第 5.9 节）。
- **现有实体全部已有 `id`（UUID）+ `createdAt/updatedAt`，且 `apps.json` 甚至已经有 `lastLaunched`/`launchCount`。**

### 10.2 最小侵入方案评估（用户提出的 `workspaceId` 方案）

**结论：用户提出的方案完全适合本项目，且是三种方案中最优的。**

**为什么适合 —— 现有代码已经在用这套模式：**

| 现有关系 | 实现方式 | 位置 |
| --- | --- | --- |
| 应用 → 分组 | `app.groupId`（单值外键） | `apps.cjs:89` |
| 书籍 → 分类 | `book.categoryId`（单值外键，可 null） | `main.cjs:421` |
| 待办 → 目标（自动生成） | `todo.sourceGoalId` + `todo.sourceDate` | `main.cjs:269-270` |
| 日程 → 目标（自动生成） | `event.sourceGoalId` + `event.sourceDate` | `main.cjs:304-305` |
| 阅读进度 → 书籍 | `reader.progress[bookId]`（**字典键**） | `main.cjs:445` |

**这 5 个先例说明：本项目一贯使用"在子记录上放一个单值外键，关联查询在主进程内用 `filter/find` 完成"，从不使用关联表。**

### 10.3 三种方案对比（用户要求重点判断）

| 方案 | 与现有风格一致性 | 改动量 | 能否表达"一条记录属于多个 Workspace" | 破坏现有数据风险 | 评价 |
| --- | --- | --- | --- | --- | --- |
| **`workspaceId: "xxx"`** | ⭐⭐⭐⭐⭐ 完全一致（同 `groupId`/`categoryId`/`sourceGoalId`） | **最小**：每类数据只加 1 个字段，关联查询用 `.filter(x => x.workspaceId === id)` | ❌ 不能（一记录一 Workspace） | **最低**：字段缺失 = `undefined`，所有现有查询不受影响 | ✅ **推荐** |
| `workspaceIds: []` | ⭐⭐ 不一致（项目里没有任何数组型外键） | 中等：字段是数组，所有过滤要改成 `.includes()`，UI 要提供多选 | ✅ 能 | 中等：需处理 `undefined` vs `[]` 两种"空" | 暂不推荐 |
| relation table / relation JSON（如 `workspace-relations.json`） | ⭐ **完全不一致**（项目零先例） | **最大**：新增第 18 个 JSON、新增 CRUD IPC、所有查询要"先查关系再查实体" | ✅ 能 | 中等：新增文件不影响旧数据，但**每个消费方都要改查询逻辑** | ❌ 不推荐 |

**为什么不需要"一条记录属于多个 Workspace"：**
- 与项目现有语义一致（一个 app 只属于一个分组、一本书只属于一个分类）。
- 真正的"多归属"需求（比如"同一个文件既用于比赛又用于课程"）在个人工作台场景下是**低频**的，而且**可以用更符合直觉的方式解决**：在另一个 Workspace 里再添加一次该文件引用（`files.json` 本来就允许重复路径吗？—— 不允许，`addFavorite` 会按 `path` 去重，`files.cjs:93`）。所以如果将来真的需要多归属，**再升级为 `workspaceIds[]` 的代价也不高**（把 `x.workspaceId === id` 改成 `[].concat(x.workspaceIds||x.workspaceId).includes(id)` 即可平滑兼容）。
- **先做单值，保留升级路径** —— 这是与"最小改动"原则最契合的选择。

### 10.4 需要重点注意的 3 个陷阱（如果未来实现）

1. **`files.json` 的路径去重会与 Workspace 冲突**：`addFavorite` 用 `items.some(item => item.path === normalized)` 去重（`files.cjs:93`）。若用户想把同一文件夹挂到两个 Workspace，会被拒绝。**建议未来把去重键改为 `path + workspaceId` 组合**，或允许同一路径在不同 Workspace 下各有一条记录。这是**唯一一个"加 workspaceId 会改变现有行为"的地方**。
2. **`todos.json` 有"自动生成"的待办**（`generated: true` + `sourceGoalId`）。这些记录的 `workspaceId` 应该从**目标**继承还是留空？需要产品决策（见第 24 章 Q）。同步逻辑 `syncGoalRecurringTasks()`（`main.cjs:228-313`）会在重建时覆盖字段，**如果不同步维护 `workspaceId`，它会被清掉**。
3. **备份兼容性**：旧备份文件导入后所有记录都没有 `workspaceId`。读取端必须把"无 workspaceId"视为"未归类"，**不能视为某个默认 Workspace**，否则用户导入旧备份后所有数据会突然出现在一个工作空间里。

---

## 11. Workspace 推荐数据模型

### 11.1 设计原则（从现有 JSON 风格反推）

| 现有风格 | 提取出的设计约束 |
| --- | --- |
| 所有实体都有 `id`（UUID v4）+ `createdAt` + `updatedAt` | Workspace 必须有这三个字段 |
| 时间统一用 `new Date().toISOString()` | 用 ISO 8601 字符串 |
| 排序字段统一叫 `sort`，值为 `Date.now()` 或数组下标 | 用 `sort`（number） |
| 逻辑删除不存在，删除即真删；但**有 `favorite`/`pinned` 这类布尔标记** | 优先用 `archived` 布尔标记而非真删 |
| 目录/分类用 `name` + 可选 `description` | 用 `name` + `description` |

### 11.2 推荐最小 Schema（`data/workspaces.json`，数组）

```js
{
  id: "uuid-v4",              // ✅ 必须 — 与全部现有实体一致
  name: "程序设计大赛",         // ✅ 必须 — 显示名
  description: "",            // ✅ 需要 — 现有 goal 有 description，成本极低
  color: "#3b82f6",           // ✅ 需要 — 视觉区分多 Workspace，纯前端字符串
  icon: "code",               // ⚠️ 可选 — 复用 LineIcon 的 name；不做也行
  sort: 1786707832384,        // ✅ 必须 — 与 apps/workflows/goals 一致的排序机制
  archived: false,            // ✅ 需要 — 替代"删除"，保护关联数据不被误删
  createdAt: "ISO 8601",      // ✅ 必须
  updatedAt: "ISO 8601",      // ✅ 必须
  lastOpenedAt: null          // ✅ 需要 — "最近使用"必需；已有 apps.lastLaunched 先例
}
```

### 11.3 逐字段判断"是否真正需要"（用户要求不要过度设计）

| 字段 | 判定 | 理由 |
| --- | --- | --- |
| `id` | **必须** | 所有关联的锚点；UUID 生成器 `id()` 已现成 |
| `name` | **必须** | 唯一的人类可读标识 |
| `description` | **需要** | `Goal` 已有 `description`，成本 0；用于"这个 Workspace 是干什么的" |
| `color` | **需要** | Workspace 列表/卡片/侧边标记的视觉区分，无需额外依赖（CSS 变量即可） |
| `icon` | **可选，建议 P2** | 需要同步扩充 `LineIcon.vue` 的图标表，否则会缺图标。**MVP 可用 `color` 首字母代替** |
| `sort` | **必须** | 否则列表顺序不稳定；且项目已有成熟的 `reorder` 模式可照抄 |
| `archived` | **需要** | **关键设计决策**：不要真删 Workspace，因为 Todo/文件/便签都挂在它上面。归档后从主列表隐藏，数据保留 |
| `createdAt` | **必须** | 与全项目一致（且 `daily-review` 例外提醒我们：**不要用业务字段当主键**） |
| `updatedAt` | **必须** | 与全项目一致 |
| `lastOpenedAt` | **需要** | "继续上次工作"和 Dashboard"最近 Workspace"的核心排序依据。**已有 `apps.lastLaunched` 完全同构的先例** |

### 11.4 明确**不要**加的字段（避免过度设计）

| 字段 | 为什么不要 |
| --- | --- |
| `workspaceIds` / 成员列表 | 见 10.3，关系反向存在子记录上 |
| `stats` / `totalMinutes` / `todoCount` 等聚合字段 | **会立刻产生一致性地狱**（每次改 Todo 都要回写 Workspace）。项目已有先例：`goal.progress` 就是"存了也不用、list 时重算"（`main.cjs:209, 758`）。**正确做法是在读取时动态计算** |
| `settings` / `config` 嵌套对象 | 无需求，且与"扁平 JSON"风格不符 |
| `tags: []` | Worspace 本身已经是最高层分类，再加标签是双重视角，MVP 不需要 |
| `deletedAt` / 软删除时间戳 | `archived: false` 已足够，项目无任何软删除先例 |
| `version` / `schemaVersion` | 单独加在 Workspace 上没意义；如果要加应该加在**全局**（见第 17 章建议） |
| `order`（与 `sort` 并存） | 与现有 `sort` 命名冲突，只用 `sort` |

### 11.5 存储位置与访问方式（照抄现有模式）

```js
// main.cjs 内新增（照抄 :69-75 的 readGoals/writeGoals 模式）
function readWorkspaces() { return store.read('workspaces.json', []); }
function writeWorkspaces(items) { store.write('workspaces.json', items); }
```

IPC 通道（照抄 `groups:*` 的 4 个 handler 模式，`main.cjs:726-749`）：
`workspaces:list` / `workspaces:create` / `workspaces:update` / `workspaces:delete`（+ 可选 `workspaces:reorder` / `workspaces:touch` 更新 `lastOpenedAt`）

---

## 12. Work Session 推荐数据模型

### 12.1 四个问题的回答

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| **1. 当前架构能否支持"开始工作/结束工作"** | ✅ **能**。`DataStore` + `safeHandle` 模式可无缝承载新表；"开始工作"本质是"写一条 session + 触发已有打开动作" | 第 6.5、10.1 节 |
| **2. 是否已有计时能力可以复用** | ⚠️ **有，但不能直接复用**。`useTimer.js`（161 行）是**模块级单例**（`:3-9` 顶层 `ref`），且提供 `start/pause/reset/stopAlarm`，**跨页面不丢失**，这点很好。**但它只存"剩余秒数"，不记录"开始时间/结束时间"，也没有持久化**（刷新即归零）。且它同时承担"倒计时"和"秒表"两种模式，语义上是番茄钟而非工时计。**建议：复用它的 UI 与铃声能力，但工时计时必须新建独立的 composable**，不要改造 `useTimer.js`（会破坏番茄钟功能） | `composables/useTimer.js` |
| **3. 是否已有工作记录数据** | ❌ **完全没有**。全项目无 session/记录/日志类数据。最接近的是 `daily-review.json` 的 `focusMinutes`（**但是用户手填的整数，不是自动统计**，`ReviewView.vue:23`） | 第 6.2 节 |
| **4. 是否需要新建 Session 数据** | ✅ **需要新建**。**不能复用 `daily-review.json`**：它以 `date` 为主键（一天只能有一条），而 Session 是一天多条；且把 Session 塞进 review 会破坏 `review:get` 的 `find(item => item.date === date)` 逻辑（`main.cjs:325`） | `main.cjs:1042` |

### 12.2 推荐最小 Session Schema（`data/work-sessions.json`，数组）

```js
{
  id: "uuid-v4",                    // ✅ 必须
  workspaceId: "uuid | null",       // ✅ 必须 — 关联 Workspace；允许 null（未归类工作）
  startedAt: "ISO 8601",            // ✅ 必须 — "开始工作"时刻（含时分秒，必须 ISO 而非日期！）
  endedAt: "ISO 8601 | null",       // ✅ 必须 — 结束时刻；null = 进行中（用于崩溃恢复）
  durationSeconds: 7980,            // ✅ 必须 — 结束时写入的快照值（避免每次统计都做减法）
  dateKey: "2026-09-21",            // ✅ 需要 — 本地日期键，用于"今日汇总"快速筛选（与 checkins/calendar 的键风格一致）
  note: "",                         // ✅ 需要 — 本次备注（"结束工作"时填）
  completedTodoIds: ["uuid", ...],  // ✅ 需要 — 本次完成的待办 id 数组
  nextStep: "",                     // ✅ 需要 — 下一步计划（快照核心，"继续工作"直接读它）
  // —— 以下为可选增强 ——
  createdTodoIds: [],               // P2 — 本次新建的待办
  openedResources: [],              // P2 — 本次打开过的文件/网址（用于"恢复现场"）
  interrupted: false,               // P2 — 异常结束（应用被强杀）标记
  createdAt: "ISO 8601",
  updatedAt: "ISO 8601"
}
```

### 12.3 关键设计决策说明

1. **为什么存 `durationSeconds` 而不是只存起止时间？**
   因为"今日汇总"要频繁计算。虽然理论上可算，但存快照值可避免 DST/时区/系统时钟调整导致的偏差，也让"未结束的 session"（`endedAt = null`）语义更清晰。这与项目"存 `reminderFired` 布尔标记"的风格一致（宁可存冗余状态，避免重复计算）。

2. **为什么需要 `endedAt: null` 表示"进行中"？**
   **这是关键的可靠性设计**：如果用户点了"开始工作"然后应用崩溃/被强杀，下次启动时读到 `endedAt === null` 的记录，就能提示"上次有一段未结束的工作（开始于 X 点），是否补录？"。**没有这个字段，"工作现场快照"在异常场景下会丢失。**

3. **为什么 `completedTodoIds` 存 id 数组而不是把 `todo.sessionId` 写回 Todo？**
   - 避免**双向写入**（改一个 session 要遍历改 todos）。
   - Todo 可能被删除，存 id 是"弱引用"，查不到就忽略，不会导致数据不一致。
   - 与 `goal.completedDates` 存日期数组的风格一致（`main.cjs:224`）。
   - **但注意**：快照展示时需要 `todos.list()` 做一次 join，成本可接受（个人数据量级）。

4. **`dateKey` 存在的意义**：与 `checkins.json`（日期字符串数组）、`calendar-events.json` 的 `date`、`todos.dueDate` 保持同一套日期键格式，未来"今日复盘联动"和"日历显示工作时长"可以直接用字符串比较，无需 Date 解析。

---

## 13. 工作现场快照设计建议

### 13.1 六个问题的回答

| 问题 | 结论 |
| --- | --- |
| **1. 是否可实现** | ✅ **完全可以，且不需要 AI**。所有需要的信息都能用"已有数据 + 一次 filter"得到 |
| **2. 当前有哪些数据可以复用** | 见下表 13.2 |
| **3. 还缺什么数据** | 只有 3 项：① Session 本身（第 12 章）② `nextStep` 字符串 ③ `workspaceId` 关联。其余**全部已有** |
| **4. Snapshot 应独立保存还是从 Session 动态计算** | **推荐：混合方案 —— 只持久化"人写的"和"必须冻结的"，其余动态计算**（见 13.3） |
| **5. 哪一种更适合当前项目** | **混合方案**。纯独立保存会产生一致性问题（与项目"`goal.progress` 存了不用"的教训一致）；纯动态计算会丢失"当时看到的是什么"这一核心价值 |
| **6. 推荐数据模型** | 见 13.4 |

### 13.2 现有可复用数据清单（"上次做到哪里"所需的信息全部已有来源）

| 快照要展示的信息 | 现有数据来源 | 是否已存在 |
| --- | --- | --- |
| **工作时间** | 新建 `work-sessions.json` 的 `startedAt`/`endedAt`/`durationSeconds` | ❌ 需新建 |
| **本次完成事项** | `work-sessions.completedTodoIds` ← join `todos.json`（`completed === true`） | ⚠️ 关系需新建，**Todo 实体已有** |
| **剩余事项** | `todos.json` 中 `workspaceId === X && !completed`（**纯查询，无需存储**） | ✅ **完全已有** |
| **备注** | `work-sessions.note` | ❌ 需新建 |
| **下一步** | `work-sessions.nextStep` | ❌ 需新建 |
| **工作空间** | 新建 `workspaces.json` + `workspaceId` | ❌ 需新建 |
| **相关资源** | `files.json`（`workspaceId` 过滤）+ `bookmarks.json`（`workspaceId` 过滤）+ `apps.json`（`workspaceId` 过滤） | ✅ **实体全有**，仅缺 `workspaceId` |
| **相关便签** | `notes.json`（`workspaceId` 过滤） | ✅ **实体已有** |
| **相关文档/网址** | `bookmarks.json` 的 `url` 字段可直接 `shell.openExternal` | ✅ **已有** |
| **未结束会话检测** | `work-sessions` 中 `endedAt === null` | ❌ 需新建 |

**结论：需要新增的数据只有 1 张表 + 1 个字段。其余全是"给现有表加一列"。**

### 13.3 混合方案的具体划分（核心建议）

| 内容 | 处理方式 | 理由 |
| --- | --- | --- |
| `startedAt` / `endedAt` / `durationSeconds` / `note` / `nextStep` / `completedTodoIds` / `workspaceId` | **持久化到 `work-sessions.json`** | 这些是"当时的事实"，事后无法重建 |
| **剩余事项列表** | **动态计算**：`todos.filter(t => t.workspaceId === sid && !t.completed)` | 如果冻结成快照，用户第二天完成了一项，快照还会说"没完成"，**自相矛盾** |
| **相关资源列表** | **动态计算**：按 `workspaceId` 过滤 files/bookmarks/notes | 同上；且用户随时可能新增资源 |
| **工作空间名称/颜色** | **动态 join** `workspaces.json` | 用户改了 Workspace 名字，历史快照应显示新名字 |
| **未完成事项的"当时数量"** | **可选冻结**：如果想让快照显示"当时还剩 5 项，现在还剩 2 项"的对比，可加 `pendingTodoIdsAtEnd: []` | P2，非 MVP 必需 |

**一句话原则：持久化"人的输入"和"时间事实"，动态计算"实体清单"。**

### 13.4 推荐数据模型（在 Session 之上极小的增量）

**方案：不新建 Snapshot 表，而是在 `work-sessions.json` 上补足字段。**

理由：
- Snapshot 与 Session 是 **1:1** 关系（一次工作结束 = 一份现场）。
- 项目**没有任何 1:1 拆表的先例**（`reader.json` 的 prefs 与 progress 是同一对象内的两个键）。
- 多一张表 = 多一组 IPC + 多一份 id 关联 + 多一个可能不一致的地方。

因此第 12 章的 Session Schema **本身就是 Snapshot Schema**。若必须独立命名，可把 `work-sessions.json` 的记录视为"session 即 snapshot"。

**"继续上次工作"的读取逻辑（纯程序，无 AI）：**

```text
1. 取 workspaces 中 lastOpenedAt 最新的 1 个（或用户点击的那个）→ workspaceId
2. 取 work-sessions 中 workspaceId 匹配、endedAt != null、按 endedAt 倒序的第 1 条 → lastSession
3. 读取列表（各一次 IPC，动态计算）：
   - pendingTodos  = todos.filter(t => t.workspaceId === id && !t.completed)
   - doneTodos     = todos.filter(t => lastSession.completedTodoIds.includes(t.id))
   - resources     = files.filter(f => f.workspaceId === id)
   - links         = bookmarks.filter(b => b.workspaceId === id)
   - notes         = notes.filter(n => n.workspaceId === id)
   - apps          = apps.filter(a => a.workspaceId === id)
   - workflows     = workspace.workflowIds.map(id => workflows.find(w => w.id === id))
4. 展示卡片：
   「上次做到哪里」= lastSession.endedAt 的相对时间 + lastSession.note
   「还有什么没完成」= pendingTodos（按四象限排序，复用 utils/quadrant.js）
   「下一步是什么」= lastSession.nextStep
5. 提供按钮：
   【继续上次工作】→ 新建 session(startedAt=now, endedAt=null)
                     → 顺序执行 workspace.workflowIds 里的工作流（复用 launcher.runWorkflow）
                     → 启动工时计时
```

**注意第 5 步的关键约束**：因为 `App.vue` 的 `<component :is>` 会卸载组件（第 5.1 节），**计时状态必须放在模块级 composable（照抄 `useTimer.js` 的顶层 `ref` 模式）或写进主进程**，否则用户切到"待办"页再回来，计时就没了。

---

## 14. 工作流与 Workspace 的最佳关系

### 14.1 方案对比与推荐

| 维度 | 方案 A：工作流直接属于 Workspace | **方案 B：独立工作流库 + Workspace 绑定引用** ⭐ | 方案 C：混合（工作流可标记归属） |
| --- | --- | --- | --- |
| 数据模型 | `workspace.workflows[]` 内嵌完整 step 数组 | `workflows.json` 保持不动，`workspace.workflowIds: []` | `workflow.workspaceId` 单值外键 |
| **改动量** | **大**：要改 `launcher.readWorkflows`、`runWorkflow`、WorkflowPanel 的编辑保存路径，且现有 `workflows.json` 数据要迁移 | **极小**：`workflows.json` 完全不动，只在 `workspaces.json` 加一个 `workflowIds` 数组字段 | 小 |
| **是否破坏现有用户数据** | ⚠️ **高风险**：本机已有 1 个工作流（4 步），迁移时若把 `workspaces.json` 建成新的唯一来源，旧数据需要搬运，一旦出错就丢了 | ✅ **零风险**：`workflows.json` 原样保留，新字段只增不改 | ✅ 低风险（key 缺失 = 未绑定） |
| **可维护性（长期）** | 差：多个 Workspace 想共用"每日收尾"流程时必须复制粘贴，改一处要改 N 处 | ✅ **最好**：工作流是"可复用资产"，Workspace 只是消费者。**改工作流，所有绑定它的 Workspace 一起生效** | 中：一个工作流只能属于一个 Workspace，共用仍需复制 |
| **与项目现有风格一致性** | 低（项目无任何"内嵌完整子对象数组"的先例） | ⭐⭐⭐⭐⭐ **高** —— 与 `workflow.steps[].appId` 引用 `apps.json`、`todo.sourceGoalId` 引用 goals **完全同构** | 高（同 `groupId` 模式） |
| **能否支持"一个工作流被多个 Workspace 使用"** | ❌ | ✅ **天然支持** | ❌ |
| **UI 改动** | 要在 Workspace 内做一个完整的工作流编辑器（等于把 WorkflowPanel 复制一份） | ✅ WorkflowPanel **一行都不用改**；Workspace 只需一个"选择已有工作流"的多选列表 | 要在 WorkflowPanel 加一个"归属 Workspace"下拉 |

### 14.2 结论：**推荐方案 B，明确不推荐方案 A**

**推荐 B 的 4 个决定性理由：**

1. **用户自己举的例子正好证明了 B 更合理。** 用户设想的"工作流库：Java 学习 / 比赛开发 / 写实验报告 / 每日收尾"+"Workspace 程序设计大赛 绑定：比赛开发、每日收尾" —— **注意"每日收尾"同时被多个 Workspace 绑定是常态**。方案 A 下这个需求无法优雅实现。

2. **方案 B 的改动量真的是"零"级别。** `launcher.cjs` 的 `runWorkflow(store, workflowId)` 签名已经接受 `workflowId`（`:51`），IPC 通道 `workflows:run` 也已存在（`main.cjs:926`）。**Workspace 想运行绑定的工作流，直接调用现有的 `workbench.workflows.run(id)` 即可，主进程一行都不用改。**

3. **零数据迁移风险。** 现有 `workflows.json`（含真实用户数据）不被触碰。这符合"不破坏现有用户数据"的硬要求。

4. **未来可平滑升级到 C。** 如果将来确实需要"一个工作流只属于一个 Workspace"，再加 `workflow.workspaceId` 即可，与 `workflowIds` 并不冲突（前者是"默认归属"，后者是"显式绑定"）。

### 14.3 具体数据结构建议

```js
// workspaces.json 中
{
  id, name, description, color, sort, archived, createdAt, updatedAt, lastOpenedAt,
  workflowIds: ["workflow-uuid-1", "workflow-uuid-2"],   // ⭐ 引用，不内嵌
  autoRunWorkflowIds: ["workflow-uuid-1"]                // P2：可选，区分"打开时自动运行"与"仅列出"
}
```

**关于"绑定工作流后是否自动运行"**：建议用独立字段（`autoRunWorkflowIds`）而非布尔标记，因为一个 Workspace 可能绑定 5 个流程但只在"开始工作"时自动跑其中 1 个（"比赛开发"），其余按需手动点。**MVP 阶段可以只做 `workflowIds`，自动运行留到 P2。**

### 14.4 需要警惕的一点

`runWorkflow` 是**顺序阻塞执行 + 每步 350ms 延迟**（`launcher.cjs:57-66`），且**失败即中断**（`:68-72`）。如果 Workspace 绑定 3 个工作流串行运行，最坏情况会阻塞数秒且中途失败。
**建议**：MVP 阶段"继续工作"只自动运行**一个**指定的工作流，其余在界面上以按钮形式列出让用户手动触发。这既规避了失败中断问题，也让演示更可控（参赛演示时不会因为一个 exe 路径失效导致整个流程挂掉）。

---

## 15. 一键继续工作可行性

### 15.1 逐项判断（用户列的 7 个动作）

| # | 动作 | 能否实现 | 可直接复用什么 | 需要新增什么 |
| --- | --- | --- | --- | --- |
| 1 | **打开 Workspace** | ✅ 能 | `App.vue` 的 `activeView` + 一个模块级 `activeWorkspaceId` 单例 | 新增 composable 保存"当前 Workspace" |
| 2 | **显示上次未完成 Todo** | ✅ 能 | `todos.list()` + `utils/quadrant.js` 的 `sortTodosByQuadrant()` | 仅需 `workspaceId` 过滤 |
| 3 | **打开项目文件夹** | ✅ 能 | `shell.openPath`（`launcher.cjs:32`）已在用；`files.json` 已存文件夹路径 | 无需新增 Electron 能力 |
| 4 | **打开 VS Code** | ✅ 能（若已录入） | `apps.launch(appId)` → `shell.openPath(exePath)`（`launcher.cjs:20-30`） | 需用户先把 VS Code 加入快捷应用 |
| 5 | **打开 GitHub 页面** | ✅ 能 | `shell.openExternal`（`launcher.cjs:42`） | 无 |
| 6 | **打开项目相关文档** | ✅ 能 | 同 #3 / #5，取决于文档是本地文件还是网址 | 无 |
| 7 | **开始计时** | ✅ 能 | `useTimer.js` 的 UI/铃声能力 + 新建工时计时 composable | 见第 12.1 节 |

**总体判定：7 项全部可实现，且全部有现成能力可用。这个功能的"技术可行性"非常高。**

### 15.2 关键结论：用**现有工作流引擎**驱动，不要新写执行器

用户设想的 3/4/5/6 四个动作（开文件夹、开 VS Code、开 GitHub、开文档）**正好对应现有工作流的 3 种 step 类型**：
- 开 VS Code → `type: 'app'`（`appId` 指向已录入的 VS Code）
- 开文件夹 → `type: 'file'`（`path` 指向项目目录）
- 开 GitHub / 文档 → `type: 'url'`

**因此"一键继续工作"= 新建 Session + 启动计时 + 调用一次 `workbench.workflows.run(boundWorkflowId)` + 切换到 Workspace 视图。主进程需要改动的代码量约为零。**

唯一的缺口是 **`type: 'app'` 无法传参数**（第 8.3 节）。所以**"用 VS Code 打开某个具体文件夹"做不到**（需要 `code.exe <folder>` 形式的带参启动）。三种应对方式：
- **最简单（推荐 MVP）**：让工作流分别"打开 VS Code"和"打开项目文件夹"，用户视角上效果接近（VS Code 打开后用户在最近项目里选）。**零改动。**
- **中等**：允许 `type: 'file'` 指向一个 `.lnk` 快捷方式，快捷方式里已带参数（Windows 快捷方式支持参数）。**也是零代码改动**，只需在文档里说明。
- **较大（不建议 MVP）**：给 step 加 `args: []` 字段并改用 `child_process.spawn` 启动。这会引入**安全面（任意程序 + 任意参数执行）**，且需要替换 `shell.openPath`，属于新功能而非复用。

### 15.3 Windows 下的具体风险清单（用户特别要求）

| 风险 | 现有代码是否已处理 | 说明与建议 |
| --- | --- | --- |
| **exe 路径失效**（软件被卸载/移动） | ⚠️ **部分**。`launchApp` 会 `shell.openPath` 并检查返回的 error 字符串（`launcher.cjs:24-25`），失败时返回 `{ok:false, error}` → UI 弹 toast | 但没有"启动前预检 `fs.existsSync(path)`"的机制。**建议**：`apps:list` 时可附带 `exists: boolean`，让 Workspace 页面提前把失效应用灰显。这是**改动很小但体验提升明显**的一项 |
| **文件被移动** | ⚠️ 同上，`shell.openPath` 会报错 | 同上建议 |
| **浏览器启动** | ✅ 已处理。用 `shell.openExternal(url)` 交给系统默认浏览器，**不自己启动浏览器进程**，因此不存在"找不到 Chrome"的问题 | 无需处理 |
| **`shell.openPath`** | ✅ 已使用（`launcher.cjs:33`）。这是**最安全**的打开方式：不经过 shell 解释，无命令注入风险 | 继续用它 |
| **`shell.openExternal`** | ⚠️ 已使用但**未校验协议、未 await**（`launcher.cjs:42-45`），且**永远返回成功**（B9） | 未来应加协议白名单（只允许 http/https）—— 这也是修 B9 的顺带收益 |
| **`spawn` / `exec`** | ✅ **项目代码中完全没有使用**（唯一的子进程调用是 `apps.cjs:54` 的 `execFileSync('powershell.exe', [...])` 用于解析 .lnk，且**参数以数组传递 + base64 编码，无注入风险**） | **强烈建议保持不使用**。一旦为"带参启动"引入 `spawn`，安全面会显著扩大 |
| **路径包含中文或空格** | ✅ **已正确处理**。因为全程使用 `shell.openPath`/`shell.openExternal`（接受字符串路径，不经命令行解析），**中文和空格天然安全**。而且项目**真实数据中就有中文路径**（本机 `Documents\小菠萝的工作台\`），已在实际使用中验证 | 无需处理 |
| **应用被卸载** | ⚠️ 同"exe 路径失效" | 见上 |
| **启动失败** | ⚠️ 有错误返回但**没有预检、没有重试、没有视觉状态** | 建议同上 |
| **权限问题** | ⚠️ **未处理**。`shell.openPath` 对需要管理员权限的程序（如某些安装目录下的 exe）会失败并返回错误；`shell.openPath` 也**无法以管理员身份启动**。若用户录入的 exe 需要 UAC 提权，会静默失败（只弹一个 toast） | 属**已知限制**，建议在 UI 上给出提示文案而非尝试绕过（绕过需要 `runas` 或提权，会引入安全风险） |
| **路径过长（>260 字符）** | ⚠️ **未处理**。Node 的 `fs` 在 Windows 上默认受 MAX_PATH 限制；虽现代 Node 已支持长路径，但依赖系统 `LongPathsEnabled` 注册表设置。项目中有 `browseDirectory`（`files.cjs:27`）遍历深目录，**深层目录可能报错**（但被 `try/catch` 吞掉，条目静默消失） | 低概率，记录备查 |
| **工作流执行中断** | ⚠️ `runWorkflow` 失败即 `return`（`launcher.cjs:68-72`），已启动的应用**不会也无法回滚**（这是操作系统的性质，不是 bug） | 建议 UI 上明确提示"工作流失败时已启动的程序不会被关闭" |

### 15.4 "继续上次工作"可靠性总结

**判定：能可靠实现，但可靠性取决于 3 个防御措施是否做：**
1. **Session 必须支持 `endedAt: null`**（防崩溃丢失现场）—— 见 12.2。
2. **启动前预检资源存在性**（`fs.existsSync`），把失效项灰显，而不是等 `shell.openPath` 报错。
3. **"继续工作"不要自动串行运行多个工作流**（第 14.4 节），避免一个失效项中断整个流程。

---

## 16. 今日复盘联动方案

### 16.1 当前复盘功能适不适合接入？

**判定：适合接入，但必须先解决一个既有缺陷。**

**适合的理由：**
- `ReviewView.vue` 的顶部已经有 3 个 metric 卡片（待办完成度、阅读时长、专注时长，`:11-25`），**结构上就是为"加更多指标"设计的** —— 加第 4 张卡是纯增量。
- 数据字段 `focusMinutes` **已经存在**（`main.cjs:326`），语义与"工作时长"高度接近，**可以直接复用或并列**。
- 复盘已有"按天查/按天存"的完整机制（`review:get(date)` / `review:update(date, patch)`）。

**必须注意的缺陷（B3，第 7.2 节）：**
`getReviewRecord`（`main.cjs:323-338`）**在读取时创建并写入空记录**。这意味着：
- 一旦接入"今日工作汇总"，用户每次打开复盘页都会因为 `review.get` 而写盘。
- 本机 `daily-review.json` 已有 12 条记录，其中包含这种自动产生的空壳（历史列表里会显示"这一天没有留下文字记录"，`ReviewView.vue:68`）。

**建议（未来，不是现在）**：把"自动创建"从 `get` 移到 `update`，`get` 只返回内存中的默认对象。这是**很小但正确性收益很大**的改动。

### 16.2 最小改法（用户要求的"最小改动"方案）

**唯一需要改的文件：`src/renderer/src/views/ReviewView.vue`（约 +30 行）**

```text
第 1 处：模板，在 :11-25 的 <section class="review-metrics"> 内
         追加一张 metric-card（或新增一个"今日工作"区块）
         目标形态：
           今日工作
           工作空间 A  2h13m
           工作空间 B  1h08m
           完成 6 个任务

第 2 处：脚本，在 loadData()（:127-136）的 Promise.all 中追加 2 个 IPC：
           workbench.workspaces.list()
           workbench.sessions.listByDate(dateKey)     ← 新增通道
         或复用已有的 list + 前端过滤（更省事：sessions.list() 后 filter dateKey）

第 3 处：新增一个 computed：
           workSessionsGrouped = computed(() => 按 workspaceId 分组 + 累加 durationSeconds)
         工作空间名称通过 workspaces 列表 join 得到
```

**主进程改动：**
- 若采用"前端过滤"方案：**只需新增 `sessions:list` 一个通道**（照抄 `todos:list` 一行）。
- 若采用"按日期查"方案：新增 `sessions:list-by-date`。

**不需要改的地方（这点很重要）：**
- ❌ 不需要改 `daily-review.json` 的结构（**只在展示层加入，不往复盘记录里塞字段**）
- ❌ 不需要改 `review:update` 的签名
- ❌ 不需要动历史列表 `historyRecords`（`:98`）的逻辑

**为什么不把工作时长写进 `daily-review.json`？**
因为那会造成**双重数据源**：`work-sessions.json` 是事实来源，`daily-review.json` 是它的缓存。一旦用户手动修改了 session（比如补录），复盘里的缓存就错了。**展示时实时 join 是唯一无一致性风险的做法。** 这也与第 13.3 节"动态计算实体清单"的原则一致。

### 16.3 与"今日待办完成度"的关系

`ReviewView.vue:95-97` 现在的 `todoPercent` 统计的是**全部**待办（`todos.list()` 全量），**不区分日期**。接入 Workspace 后建议顺便明确：是"全部待办完成度"还是"今日到期待办完成度"。**当前实现是前者，但文案"待办完成度"容易被理解为后者。** 属 P3 文案/语义问题。

---

## 17. 当前代码质量与风险

> 本节只列问题，**不做任何修复**。分级：P0（数据丢失/严重崩溃/安全）、P1（明显结构问题或较严重 Bug）、P2（一般质量）、P3（优化建议）。

### P0 — 可能导致数据丢失 / 严重安全

#### P0-1 `backup:import` 路径穿越 → 任意位置写入文件
- **文件/位置**：`electron/services/backup.cjs:40-45`（`importBackup` 的 `store.write(name, content)`）；配合 `electron/store.cjs:30-32`（`filePath` 用 `path.join(this.dataDir, name)`）
- **问题**：`name` 直接来自备份文件的 JSON 键，仅校验 `endsWith('.json')`，未做路径净化。`..\..\x.json` 可通过检查并被 `path.join` 解析到数据目录之外。
- **可能后果**：恶意"备份文件"可向用户磁盘任意目录写入 `.json` 文件；结合其他机制可造成更严重后果。
- **未来建议**：`const safe = path.basename(name)`，并断言 `path.resolve(target).startsWith(path.resolve(dataDir) + path.sep)`；同时校验导入文件的来源与结构（白名单已知文件名）。

#### P0-2 数据无版本号、无迁移机制（长期风险）
- **文件/位置**：全局 —— `electron/store.cjs`（无 version 概念）、`electron/services/backup.cjs:17`（备份仅含 `app`/`exportedAt`）
- **问题**：JSON 无 `schemaVersion` 字段，代码无任何 migration 逻辑。当前靠"读时兜底"（如 `utils/quadrant.js:9-10` 从 `priority` 推导 `importance`）勉强兼容。
- **可能后果**：一旦将来改变字段语义（例如给 Todo 加 `workspaceId` 并修改去重/过滤逻辑），**用户升级后可能出现静默的数据不可见或行为错乱，且无法回滚**（因为 `DataStore.read` 的损坏自愈只会把"解析失败"的文件改名，对"解析成功但语义变了"完全无能为力）。
- **未来建议**：加一个全局 `meta.json` 存 `schemaVersion`，并在 `DataStore` 读路径上接入一个极简的 `migrate(name, data, fromVersion)`。**这是加 Workspace 前最值得投入的一项基建。**

### P1 — 明显结构问题或较严重 Bug

#### P1-1 待办提醒实际不可用，且失败后永久不再提醒
- **文件/位置**：`src/renderer/src/components/TodoPanel.vue:275-293`（`notifyTodo` / `checkReminders`）
- **问题**：`new Notification(...)` 在 Electron 渲染进程中不会工作（主进程未调用 `app.setAppUserModelId()`，Windows 上通知不会显示）。构造函数**不抛异常**，所以 `catch` 分支（`:279-281` 的 toast 兜底）**永远不会执行**。与此同时 `:290` 已把 `reminderFired` 置为 `true`。
- **可能后果**：**用户错过提醒且永远不会再收到该条提醒**（因为 `:287` 的 `if (... || todo.reminderFired) continue` 会跳过）。这是一个"静默的、不可恢复的功能失效"。
- **未来建议**：要么在主进程实现通知（`app.setAppUserModelId` + 主进程 `Notification`），要么**在确认通知成功显示前不要写入 `reminderFired`**，改为"应用启动时检查所有过期未提醒的待办并汇总提示"。

#### P1-2 便签切换/关闭会丢失最后 500ms 的输入
- **文件/位置**：`src/renderer/src/components/NotesPanel.vue:63-67`（`selectNote`）、`:75-78`（`scheduleSave`）；**缺失** `onBeforeUnmount`
- **问题**：`scheduleSave` 有 500ms 防抖，但 `selectNote` 直接 `selected.value = note` 覆盖当前编辑对象，**未 flush 待保存的 timer**；组件卸载时也没有 flush（对比 `ReviewView.vue:176-181` 有做）。
- **可能后果**：用户打字后立刻切换便签/切换 tab → 最后 0.5 秒的输入**永久丢失**。
- **未来建议**：在 `selectNote` 开头和 `onBeforeUnmount` 里调用一次 `saveSelected()`（`ReviewView` 已有可直接照抄的范式）。

#### P1-3 打开复盘页会写盘，污染 daily-review 数据
- **文件/位置**：`electron/main.cjs:323-338`（`getReviewRecord` 在 `:331-336` 创建并 `writeReviews`）；触发点 `src/renderer/src/views/ReviewView.vue:130`
- **问题**：读操作有副作用。
- **可能后果**：`daily-review.json` 被大量空记录填充（**本机实测已 12 条**）；历史列表出现"这一天没有留下文字记录"的噪声条目（`ReviewView.vue:68`）；未来若在复盘页展示"今日工作汇总"，每次打开都触发写盘。
- **未来建议**：`get` 只返回默认对象不落盘，落盘交给 `update`。

#### P1-4 `electron/main.cjs` 单文件 1,263 行，职责过多
- **文件/位置**：`electron/main.cjs`
- **问题**：混合了三类职责 —— ① 窗口与应用生命周期（`:1169-1263`）② 92 个 IPC 注册（`:531-1167`）③ **11 组实体的数据访问 + 领域算法**（`:69-529`，含 `syncGoalRecurringTasks` 约 85 行、`parseBookChapters` 约 29 行、`decodeBookBuffer` 约 25 行）。
- **可能后果**：新增 Workspace 的 IPC 会让这个文件继续膨胀；`main.cjs` 成为所有改动都要碰的冲突热点；领域算法（如书籍章节解析）无法被单独测试。
- **未来建议**：把 `readXxx/writeXxx` 提取到 `electron/services/`（与 `apps.cjs`/`files.cjs` 对齐）；书籍解析提取到 `services/books.cjs`。**属重构，本次不做。**

#### P1-5 `chatProviders.enabled` 被持久化但不生效
- **文件/位置**：`src/renderer/src/views/ChatView.vue:73-83`
- **问题**：`qwen` 与 `gpt` 分支做了**字段挑选式**构造（`enabled: true, url: qwen.url || ...`），只取 `label`/`url`，**显式丢弃 `enabled`**。实测本机 `settings.json` 中 `gpt.enabled = false`，但页面上 GPT 依然可点击。
- **可能后果**：用户（或早期版本）配置的服务开关完全无效，属于"设置项撒谎"。
- **未来建议**：统一用展开语法 `{ key, label, enabled: true, url: default, ...configured[key] }` 让配置覆盖默认值；或在设置页移除该配置项以免误导。

#### P1-6 webview 只拦首次 attach，弹窗一律 `shell.openExternal` 且无协议过滤（本次审计风险最高的一条链路）
- **文件/位置**：`electron/main.cjs:1187-1200`（`will-attach-webview`）、`:1219-1226`（`web-contents-created` → `setWindowOpenHandler`）、`electron/services/launcher.cjs:42-45`（`openExternal`）；触发侧 `BookshelfView.vue:131` 与 `ChatView.vue:46` 的 `allowpopups`
- **问题链**：① `will-attach-webview` **只校验首次 attach 时的 `params.src`**，全仓库**没有任何** `will-navigate` / `will-redirect` / `did-start-navigation` / `setPermissionRequestHandler` 监听（已 grep 确认）→ webview 内部可继续导航到任意站点或任意协议；② `allowpopups` 已开启，而 `web-contents-created` 把页面发起的 `window.open(url)` 直接交给 `shell.openExternal(url)`，该函数**不校验协议、不 await、恒返回 `{ok:true}`**。
- **可能后果**：书城页面（或其广告位、被劫持的第三方脚本）可以拉起本机程序（自定义协议）或打开本地文件。对一个"数据自主、离线可信"的定位而言，这是最实质的一条风险。
- **放大因素**：书城白名单来自用户自填 URL（`allowedWebviewHosts()`，`main.cjs:398-410`），且内置书城站点内容不受本项目控制。
- **未来建议**：① 只允许 `http:`/`https:` 通过 `openExternal`（在 `launcher.cjs:42` 加协议白名单，这是**一处改动同时修掉 B9 与 P1-7**）；② 监听 `will-navigate` 对 webview 内的后续导航同样做主机白名单校验；③ 评估是否可以关闭 `allowpopups`。

#### P1-7 全局无任何测试、无 lint、无类型检查
- **文件/位置**：项目根（无 `vitest.config`、无 `.eslintrc`、无 `tsconfig.json`；`package.json` 无 `test`/`lint` 脚本）
- **问题**：47 个源码文件、12,476 行代码，**零自动化验证**。
- **可能后果**：加 Workspace 时，任何回归（尤其是数据层改动）都只能靠手工点。对参赛项目而言，这也是"工程规范性"维度的失分点。
- **未来建议**：至少为 `utils/quadrant.js`、`utils/lunar.js`、`store.cjs`、`launcher.runWorkflow` 这几个**纯函数/无 UI 依赖**的模块补少量单元测试（它们最容易测且最有价值）。

### P2 — 一般代码质量问题

| ID | 位置 | 问题 | 可能后果 |
| --- | --- | --- | --- |
| P2-1 | `launcher.cjs:42-45` | `openExternal` 未 `await` 且**恒返回 `{ok:true}`** | 工作流 url 步骤永远报成功（B9）；用户不知道网页其实没打开 |
| P2-2 | `launcher.cjs:68-72` + `main.cjs:926-932` | 工作流失败时 `results` 被丢弃 | 用户无法知道"哪一步失败了、前面成功了哪些" |
| P2-3 | `WorkflowPanel.vue:48` | file 步骤用纯文本输入路径，**未使用已有的 `system.selectFile`** | 易用性差，用户易输错路径 |
| P2-4 | `main.cjs:540` | `settings:clear-data` 用 `fs.rmSync(store.dataDir, {recursive:true, force:true})` **只删 data/ 目录**，不删 thumbs/books/backups | 用户以为"删除全部本地数据"，实际残留 63 个图标、缩略图、已下载书籍。**与 `SettingsView.vue:95` 的文案"清空待办、目标、收藏、便签、日历、书架索引等数据"部分不符**（书架索引删了，但下载的书还在） |
| P2-5 | `apps.cjs:31` | `iconToDataUrl` 对相对路径拼 `documents/..`，逻辑可疑 | 当前调用方都传绝对路径故未触发；是潜在陷阱 |
| P2-6 | `TodoPanel.vue:271` | `Promise.all` 并发发出 N 个 `todos:delete`，每个都全量读+写 todos.json | N 倍 IO；中途失败会留下"部分删除"状态，且无回滚 |
| P2-7 | `TodoPanel.vue:139,15` | `maxTasks = 10` 无实际限制，显示 `12 / 10` | 误导性 UI |
| P2-8 | `CalendarView.vue:242,246` | `.slice(0,3)` 静默截断当日条目 | 用户看不到第 4 条及以后的日程/待办，且无任何提示 |
| P2-9 | `CalendarView.vue:129-160` | 法定节假日硬编码仅 2026 年 | 换年份后法定节假日消失（农历节日不受影响） |
| P2-10 | `main.cjs:660` / `store.cjs:12` | `logs/` 目录被创建并被设置页暴露，但**全项目无任何写入代码** | 用户点击"打开日志目录"看到一个空文件夹；属误导性功能 |
| P2-11 | `defaults.cjs:18-20` | `extensions.cloudBackup` 定义了但无 UI、无逻辑 | 死配置 |
| P2-12 | 真实 `settings.json` 含 `weatherLocation` / `extensions.weather`，源码零引用 | 遗留死数据（README 也提到天气） | 与 README 不一致；评审时若被追问需能解释 |
| P2-13 | `App.vue:11-16` 给 `<component :is>` 传 `@navigate`，但 `DashboardWelcome.vue` **未定义 emits** | 死监听器 | 无功能影响，但属代码噪声 |
| P2-14 | `RightDock.vue`（3,630 B）与 `SuggestionPanel.vue`（2,166 B）**从未被引用** | 死组件，共约 260 行 | 增加维护与阅读成本；`RightDock` 内还含 `setInterval` 逻辑 |
| P2-15 | `TodoPanel.vue:142-147` 重复定义了 `utils/quadrant.js:1-6` 的象限表 | 重复代码，两份可能漂移 | 修改象限语义时容易漏改一处 |
| P2-16 | `TodoPanel.vue:133` 的 `todos` 与 `useTodosStore.js:4` 的 `todos` 是两份状态 | 无单一数据源 | 跨页面可能短暂显示旧数据 |
| P2-17 | `NotesPanel.vue` 无 `onBeforeUnmount`（对比 `ReviewView.vue:176` 有） | 见 P1-2 | — |
| P2-18 | `Sidebar.vue` 自己 `ref` 了一份 `settings`（`:68`）并用 `watch` 同步 props（`:72-83`），同时 `loadSidebar()`（`:118-128`）又独立请求一次 `settings.get()` | 与 props 重复获取 | 冗余 IPC + 两份状态的同步风险 |
| P2-19 | `main.cjs:1187-1200` `allowedWebviewHosts()` **每次 `will-attach-webview` 都读一次 `book-stores.json`** | 每次挂载 webview 都同步读盘 | 性能影响微小，但属不必要的 IO |
| P2-20 | `books.json` 封面以 base64 内联（`main.cjs:1077` 存 360px PNG），本机文件已 59 KB。而**图片缩略图却走了文件缓存 + 按需 base64**（`files.cjs:139-145`） | **两种策略不一致** | 书架条目多时 `books:list` 会明显变慢并占用大量内存（所有封面 base64 常驻前端） |
| P2-21 | `main.cjs:515` `readBookFile` 用 `fs.statSync` + `fs.readFileSync` **全量同步读整本书**（上限 30MB） | 主进程阻塞 | 打开大书时 UI 会卡顿；30MB 同步读 + GB18030 解码 + 正则章节解析全在 IPC 主线程 |
| P2-22 | `main.cjs:481` 章节解析正则 `/^[ \t]*(第[...]+[卷部篇章回节集话]|...)[^\n]*$/gm` 对全文执行 | 对大文件是 O(n) 正则扫描 | 与 P2-21 叠加；无缓存机制，每次打开都重新解析 |
| P2-23 | `lunar.js:122` `m===12 && (d===29 \|\| d===30)` 判除夕 | **121/201 个农历年的腊月是 30 天**，这些年份里腊月廿九与三十**两天都被标成"除夕"**（已实测：1901-02-17 与 1901-02-18、1903-01-27 与 1903-01-28）。2026 年腊月仅 29 天故不触发 | 日历出现双"除夕" |
| P2-24 | `lunar.js:59-95` + `:101` 的 1900 年初基准问题 | **1900-01-01~01-30 输出 `农历正月undefined`**（`offset` 为负 → `DAY_NAMES[-1]`）。已实测：`getLunarInfo(1900-01-01)` 返回 `{"lunarText":"农历正月undefined","festival":"元旦"}` | 极端年份显示乱码；可翻月抵达 |
| P2-25 | `lunar.js:130-132` | `<1900` 或 `>2100` **静默返回空字符串**，界面无任何范围提示 | 用户看到空白副标题，不知为何 |
| P2-26 | `main.cjs:481` 章节正则缩进类只有 `[ \t]`，**不含全角空格 U+3000** | 中文 TXT 电子书**大量使用全角空格缩进章节标题**（已用等价正则实测：`　　第一章 起点` 不命中，` 第一章 起点` 命中） | 这类书退化为"单章 = 全文"，进而触发 P2-21/22 的整本单节点渲染 |
| P2-27 | `CalendarView.vue:44-45` 在 42 个单元格的模板里**调用普通函数**（非 computed）`eventsByDate`/`todosByDate` | 每次重渲染执行 42×2 次，各自对全量 `todos` 做 filter+sort（`:231,246`），`eventsByDate` 还对 `events` 再 filter（`:237-242`）→ **单次重渲染约 84 次排序**；勾选一个待办即触发整表重算 | 待办/日程变多后日历明显卡顿 |
| P2-28 | `CalendarView.vue:174-184` 与 `:230-243`、`:170-172` 与 `:245-247` | "抑制目标生成项"逻辑与"按日筛选待办"逻辑**各写了两遍** | 修改一处易漏另一处 |
| P2-29 | `CalendarView.vue:113` **未导入 `onBeforeUnmount`**，`:260-267` 的 `loadData` 无取消/无 mounted 标记 | 配合 `App.vue:11-16` 的 `<component :is>`（**无 `<KeepAlive>`**）→ 切视图会真卸载，迟到的 resolve 会写已销毁实例的 ref。当前无害，但一旦新增轮询/订阅就会泄漏 | 未来加"工作记录实时刷新"时的隐患 |
| P2-30 | `BookshelfView.vue:293-295` | `refreshBooks()` **全仓库无任何调用点**（真正刷新靠 `:441` 的 `onChanged` 回调） | 死代码 |
| P2-31 | `BookshelfView.vue:236-237,242-243,252-253` | 三处 `catch (_) {}` 把 IPC 失败**伪装成"书架还是空的"**；而 `removeStore`（`:280-286`）与 `removeBook`（`:409-412`）**完全无 try/catch** | 错误被静默；失败时界面状态与磁盘不一致 |
| P2-32 | `main.cjs:642` 选书过滤器给 `pdf/epub/mobi/azw3/docx`，但 `:511` 内置阅读器**只支持纯文本** | 用户被引导选中永远打不开的格式（只能"用系统打开"）；反而 `.md/.log/.json` 需选"所有文件"才能加入 | 易用性误导 |
| P2-33 | `book-stores.json` 的自动下载无格式/大小校验（`main.cjs:1235-1251`） | `.zip`/`.html` 也会被当作书籍入库，打开时在阅读器报"不支持" | 书架混入无效条目 |
| P2-34 | `SettingsView.vue:95` 文案"清空待办、目标、收藏、便签、日历、书架索引等数据"，但 `clear-data`（`main.cjs:539-543`）**只删 `data/` 目录** | `thumbs/`（63 个图标）、`thumbs/images/`、`books/`（已下载书籍）、`backups/` 全部残留 | 用户以为"数据已清空"，实则残留大量文件 |
| P2-35 | `Modal.vue:3` 遮罩用 `@mousedown.self`；无 ESC 关闭、无 focus trap、无 `role="dialog"`/`aria-modal`、无 body 滚动锁定；`width` prop 实际用作 `maxWidth`（`:4`） | 与 prop 命名不符；无障碍缺失；拖拽选择时易误关 | 体验与可访问性 |
| P2-36 | `ToastHost.vue` 无 `role="status"`/`aria-live`；`toast.js:6-13` 无条数上限、无去重、无关闭按钮 | 连续操作会堆叠大量 toast；屏幕阅读器无感知 | 无障碍 |
| P2-37 | `LineIcon.vue:57` 回退 `iconPaths[props.name] \|\| iconPaths.circle` | 对 `constructor`/`toString` 等**原型属性名**会返回 `Object.prototype` 上的函数而非 circle，"回退保证"在这些名字上不成立 | 潜在渲染异常（当前所有调用点都是代码常量，未触发） |
| P2-38 | `FavoritesPanel.vue:46-49` | 路径已存在时主进程静默返回原列表（`files.cjs:93-95`），但前端仍 `toast('已收藏')` | 误导性反馈 |
| P2-39 | `launcher.cjs:37-40` `revealPath` | 无论 `shell.showItemInFolder` 成败**恒返回 `{ok:true}`** | 失败不可感知（与 B9 同类问题） |
| P2-40 | `ImagesPanel.vue:59` | 过滤 `item.id !== entry.id` 是**死代码**：主进程 `addImage`（`files.cjs:147-173`）每次都新建 id、**不按 path 去重**，故永远过滤不掉任何东西 → 同一张图可重复收藏；而 `addFavorite` 是按 path 去重的，**两者语义不一致** | 重复条目；行为不一致 |
| P2-41 | `ImagesPanel.vue:71-73` 删除**无二次确认**（对比 `NotesPanel.vue:92` 有）；`FavoritesPanel.vue:74-76` 同样无确认 | 误删 | 数据丢失风险（低） |
| P2-42 | `ImagesPanel.vue:28-36` 标题"图片预览"实际展示的是 **360px 缩略图**（`files.cjs:158-166`），原图只能交给系统程序 | 名不副实；无内置大图查看 | 体验 |
| P2-43 | `main.cjs:879` + `files.cjs:130-137` | `files:images:list` **每次列图片都把每个缩略图读盘并转 base64**（同步 IO + 大 IPC 负载） | 图片多时明显变慢 |
| P2-44 | `BookmarksView.vue:143-148` `formatTime` 只输出 `M/D HH:mm`，**无年份** | 跨年收藏无法区分 | 体验 |
| P2-45 | `BookmarksView.vue:158-160` `isWebUrl` 只认 `http(s)://` 或 `www.` | 裸域名（`example.com`）被当成标题而非链接 | 体验 |
| P2-46 | `BookmarksView.vue:235-240` `clearItems` 用 `Promise.all` 逐条删除 | N 条即 N 次全量重写 `bookmarks.json`（与 P2-6 同类） | N 倍 IO |
| P2-47 | `BookReader.vue:296-300` `onBeforeUnmount` 只清 `prefsTimer` **不 flush**（`closeReader` `:274-280` 只 flush progress） | 改字号/主题后 350ms 内关闭阅读器 → 偏好不落盘（与 P1-2 同类缺陷） | 设置丢失 |
| P2-48 | `BookReader.vue:282-290` `onKeydown` **不判断事件焦点** | 焦点在设置抽屉的 `<input type="range">` 上按 ←/→ 会同时切章并挪滑杆；Esc 无视任何输入焦点直接关闭阅读器 | 操作冲突 |
| P2-49 | `BookReader.vue` 模板 `:80` `prefs.lineHeight.toFixed(1)` **无类型保护**；而 `reader:update`（`main.cjs:1148-1156`）不校验 `prefs`，且 `backup:import` 可原样写入任意 `reader.json` | `lineHeight` 非数字时**渲染期 TypeError，整个阅读器崩溃**（触发路径是备份导入或手改文件，正常 UI 流程不产生） | 崩溃风险 |
| P2-50 | `BookReader.vue:265-272` `openExternal` 的 catch 是空注释「忽略系统打开失败」 | 打开失败无任何反馈（此处明明可用 toast） | 体验 |
| P2-51 | 书架封面 base64 内联（`main.cjs:1061-1063,1077`）与图片缩略图走文件缓存（`files.cjs:139-145`）**两种策略不一致** | 本机 `books.json` 已 59 KB；`books:list` 每次全量返回所有封面（`DashboardWelcome.vue:73` 也调） | 书架条目多时列表明显变慢 |
| P2-52 | `files.cjs:46-59` `browseDirectory` 用 `readdirSync` + **每个条目一次同步 `statSync`**，全部在主进程执行，**返回无条数上限**；`FileBrowser.vue:31-50` 全量 `v-for` 无虚拟化；`files.cjs:6-16` 对 A:-Z: 逐个同步 `existsSync` | 大目录/网络盘期间主进程阻塞；有未就绪可移动盘符时盘符枚举可能明显变慢 | 卡顿 |
| P2-53 | `CalendarView.vue:299-314` `saveEvent` 无 `submitting` 状态、保存按钮（`:106`）不禁用 | 快速双击创建两条相同日程（`calendar:create` 无幂等键） | 重复数据 |
| P2-54 | `CalendarView.vue:7` 文案"聚合日程、待办截止日和**休息日**"，但实现只有周末着色（`:221`）+ 2026 放假表 | **没有休息日/调休数据源** —— 文案承诺大于实现 | 与 README "节气"同类问题 |
| P2-55 | `styles.css:415/2458/2471/2305/2835/2896/2900/2974` 的 `.right-dock*`、`:692-710` 的 `.suggestion-*`、`:2047-2076` 的 `.calendar-cell-top/.calendar-rest-label/.calendar-holiday-label` | **孤儿 CSS**（对应组件已死或用例已删），其中 `.right-dock` 同一选择器有两份定义，还包含组件里根本不存在的 `.right-dock.dock-expanded` | 增加维护成本；发布包里带着无用样式 |
| P2-56 | `CalendarView.vue:394-403` 与 `styles.css:2083-2086/2106-2109` 同名重复 | scoped 选择器带 `[data-v-*]` 特异性更高 → **实际生效的是组件内蓝色，`styles.css` 的绿色版本已被静默覆盖失效** | 改了全局样式却没效果，易困惑 |
| P2-57 | `useWorkbench.js:8` 在**模块求值期**执行 `export const workbench = getApi()`，`window.workbench` 缺失时 `getApi()`（`:2-5`）直接抛错 | **整个渲染层无法启动** → 无法在纯浏览器/Vite 下单独调试任何视图 | 开发体验；也意味着将来不能做 Web 版 |
| P2-58 | `App.vue:11-16` 给每个视图透传 `:settings` 与 `@navigate`/`@settings-updated`，但 `CalendarView.vue` 等**未声明 `defineProps`/`defineEmits`** | `settings` 会以字符串形式落到根 `div` 属性上；两个 `onXxx` 挂成永不触发的原生监听；`DashboardWelcome.vue` 也未定义 emits 却接收 `@navigate` | 代码噪声；`settings` 在日历里从未被读取 |

### P3 — 优化建议

| ID | 建议 |
| --- | --- |
| P3-1 | `utils/quadrant.js` 与 `utils/lunar.js` 是最适合补单元测试的两个模块（纯函数、无副作用、逻辑密度高） |
| P3-2 | `Main.cjs` 中 `syncGoalRecurringTasks` 每小时跑一次（`main.cjs:1232`）且用 `JSON.stringify` 全量比较来决定是否写盘（`:311-312`），数据量大时会有明显开销；可改为基于 `updatedAt` 的增量判断 |
| P3-3 | `store.write` 未做 `fsync`，断电可能丢最后一次写入；可在关键路径（如 `backup:import` 之后）加显式落盘 |
| P3-4 | `docs/` 已有完整的 superpowers 设计文档，建议把本次审计报告也纳入 docs 并在 README 链接，提升工程可读性（**参赛材料加分项**） |
| P3-5 | README 的下载链接文件名与实际产物名不一致（见 7.1），建议改为真实文件名或改用 Releases 页面链接 |
| P3-6 | `README` 提到"节气"但无实现，建议要么补实现，要么从 README 移除该措辞 |
| P3-7 | `LineIcon.vue` 是新增 UI 元素时的必经改动点；若 Workspace 要用新图标，需同步扩充 |
| P3-8 | `preload.cjs` 的 `toPlain()`（`:3-10`）对每个参数做 `JSON.parse(JSON.stringify(...))`，是一层不错的防护；新增通道建议保持同风格 |

### 17.1 未发现问题的项（重要，避免过度担忧）

以下项目**经检查没有发现问题**，不应在评审中作为风险点：

- ✅ **XSS 风险基本不存在**：全项目仅 1 处 `v-html`（`MarkdownRenderer.vue:2`），而它的输入**先经过 `escapeHtml()`**（`:12-19,22`）再做语法替换；链接 URL 限定了 `https?://`（`:26`）。且 CSP 为 `script-src 'self'`（无 `unsafe-inline`），`src/renderer/index.html:6`。**这是本项目安全方面做得很好的一点。**
- ✅ **命令注入风险不存在**：唯一的子进程调用 `execFileSync('powershell.exe', [数组参数])`（`apps.cjs:54-58`）使用数组传参 + base64 编码传入 .lnk 路径，无字符串拼接注入面。
- ✅ **listener 泄漏问题基本不存在**：全项目仅 2 处 `addEventListener`/IPC listener（`BookReader.vue:294` 的 keydown、`BookshelfView.vue:441` 的 `books:changed`），**两者都在 `onBeforeUnmount` 中正确注销**（`BookReader.vue:296`、`BookshelfView.vue:445-447`）。
- ✅ **定时器泄漏基本不存在**：`TodoPanel` 的 `reminderTimer`（`:298`）在 `:301-303` 正确清除；`QuickNoteWidget`（`:42`）、`useTimer`（`:18-23`）都有清理；`RightDock` 也有（但它是死代码）。
- ✅ **没有 `localStorage`/`sessionStorage`/`indexedDB` 混用**，数据源唯一。
- ✅ **Promise 未捕获问题很少**：`preload.cjs:12-18` 统一抛错 + 大多数调用点有 `try/catch`；少数"裸调用"（如 `SettingsView.vue:56` 的 `workbench.system.openDataDir()`）属有意为之（无需处理结果）。**只有 2 处真正的 unhandled rejection**（`NotesPanel.vue:77`、`QuickNoteWidget.vue:31` 的 setTimeout 回调，见 B17/B18），其余模板事件里的 rejection 会被 Vue 的 `callWithAsyncErrorHandling` 接住（只打 console）。
- ✅ **书籍章节解析算法本身是可行的**：`parseBookChapters`（`main.cjs:479-507`）能正确识别 `第一章`/`序章`/`楔子`/`番外` 等中文标记，未闭合代码块、前言块（`:496-504`）等边界都有处理。**唯一缺陷是缩进类不含全角空格**（P2-26），不是算法错误。
- ✅ **`backup:export` 的"遍历 `data/*.json` 全量打包"设计很好**（`backup.cjs:5`）：新增 `workspaces.json` / `work-sessions.json` 会被自动纳入备份，无需改动备份代码。同理 `settings:clear-data` 的 `rm -rf dataDir` 也能自动覆盖新表。
- ✅ **`books:changed` 的订阅/退订是正确范式**：`preload.cjs:146-150` 返回取消函数，`BookshelfView.vue:441` 注册、`:445-447` 在 `onBeforeUnmount` 中调用 → **这是全项目唯一的事件通道，且没有泄漏**。未来 Workspace 若要加实时刷新通道，照抄这个模式即可。

---

## 18. 构建与运行验证

### 18.1 实际执行的验证（严格只读/不修改项目）

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 依赖是否已安装 | `Test-Path node_modules/electron` 等 | ✅ 已安装（electron、vite.cmd、electron-builder.cmd 均存在） |
| Node / npm 版本 | `node -v` / `npm -v` | v22.19.0 / 10.9.3 |
| **未执行 `npm install`** | — | ✅ **刻意跳过**（可能改写 `package-lock.json`，违反约束）。已验证 `package-lock.json` 的 root deps 与 `package.json` **完全一致**（lockfileVersion 3），故无需安装 |
| **构建** | `npm run build` | ✅ **成功**，exit 0 |
| 构建产物 | `dist/renderer/` | `index.html` 708 B + `assets/index-DfpquVQk.css` 76.97 kB + `assets/index-DRzTpOn2.js` 183.10 kB，59 modules，2.42s |
| 构建后工作区是否干净 | `git status --short` | ✅ **完全干净（无输出）** |
| 业务数据是否被改动 | 对比 `data/*.json` 的 `LastWriteTime` | ✅ **全部保持原时间戳**（最新为 2026/9/21 9:48，早于本次审计） |
| **Electron 启动验证** | 未执行 | ⚠️ **刻意跳过**：启动会读取 `settings.json` 并可能触发 `syncGoalRecurringTasks()`（`main.cjs:1231`）写盘 → 违反"不得修改业务数据"。**已通过静态阅读 `createWindow()` 与 `registerIpc()` 完成启动路径验证** |

### 18.2 三条命令（用户询问）

| 用途 | 命令 | 依据 |
| --- | --- | --- |
| **开发启动** | `npm run dev` | → `node scripts/dev.mjs`：先 `createServer`（Vite，端口 5173 strictPort），再 `spawn(electronPath, ['.'], {env: {...process.env, VITE_DEV_SERVER_URL: devUrl}})`；`main.cjs:1207-1212` 检测到 `VITE_DEV_SERVER_URL` 时 `loadURL(devUrl)`，否则 `loadFile(dist/renderer/index.html)` |
| **正式构建** | `npm run build` | → `vite build --configLoader native`。⚠️ `--configLoader native` 是**必需**的（因为配置是 `.mjs`），去掉可能报错 |
| **Windows 打包** | `npm run dist` | → `npm run build && electron-builder --win`，产出 `nsis` + `portable` 两个 target 到 `dist-release/v0.1.2/` |
| 仅打包不生成安装器 | `npm run dist:dir` | → `electron-builder --dir` |
| 启动已构建版本 | `npm start` | → `electron .`（需先 `npm run build`） |
| 一键脚本 | `启动工作台.bat` | 自动检查 node / `node_modules/electron/install.js` / `electron.exe` / `dist/renderer/index.html`，缺失则安装/下载/构建，最后 `npm start` |

### 18.3 当前是否能成功 build？

**✅ 能。** `npm run build` 完整成功（exit 0，59 modules，2.42s），无任何 warning 或 error。产物与仓库中已有的 `dist/` 哈希完全一致（`index-DRzTpOn2.js`、`index-DfpquVQk.css`），说明**构建是可复现的，且当前 `dist/` 就是这份源码的产物**。

### 18.4 打包配置审查（`package.json` `build` 字段）

```json
"build": {
  "appId": "com.xiaoboluo.workbench",
  "productName": "小菠萝的工作台",
  "directories": { "output": "dist-release/v0.1.2" },   // ⚠️ 版本号硬编码在路径里
  "files": ["electron/**/*", "dist/renderer/**/*", "package.json"],
  "win": { "target": ["nsis", "portable"], "icon": "build/icon.ico" },
  "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true,
            "createDesktopShortcut": true, "createStartMenuShortcut": true,
            "shortcutName": "小菠萝的工作台",
            "artifactName": "小菠萝的工作台-${version}-安装包.exe" },
  "portable": { "artifactName": "小菠萝的工作台-${version}-portable.exe" }
}
```

**观察（非阻塞）：**
- ✅ `files` 白名单正确，**不会把 `node_modules` 打进包**（因为 renderer 已构建、主进程零运行时依赖除 vue 之外… 实际上主进程也不用 vue）。这也是为什么打包出 83 MB 而非更大。
- ⚠️ **`directories.output` 硬编码 `v0.1.2`**：版本升级到 0.1.3 时若忘记改，会继续输出到 v0.1.2 目录。`dist-release/` 下已存在 `0.1.0/`、`v0.1.1/`、`v0.1.2/` 三代产物，说明历史上是手工维护的。
- ⚠️ **`dependencies` 里只有 `vue`**，但 `vue` 实际只被 Vite 打进 `dist/renderer` bundle，运行时并不 `require('vue')`。因此 `"dependencies": {"vue": ...}` 可以（理论上）移到 `devDependencies`，进一步减小打包体积。属 P3 优化。
- ✅ `oneClick: false` + `allowToChangeInstallationDirectory: true` 符合 README 描述。
- ✅ 已有三代真实打包产物（`dist-release/v0.1.2/` 下两个 exe 各约 83 MB），证明**打包链路是真实可用的**。

---

## 19. 项目规模统计

> 统计范围：`src/` + `electron/`（不含 `node_modules`、`dist`、`dist-release`、`.git`、图片资源）。用 PowerShell 实测。

### 19.1 文件数量

| 类别 | 数量 |
| --- | --- |
| **源码文件总计** | **47** |
| `.vue`（Vue 单文件组件） | **30** |
| `.js`（ESM，渲染层） | **7** |
| `.cjs`（CommonJS，主进程） | **8** |
| `.html` | 1 |
| `.css` | 1 |
| **Electron 文件** | **8**（4 根 + 4 services） |
| **渲染层文件** | **39** |

### 19.2 代码行数

| 范围 | 总行数 | 非空行数 |
| --- | --- | --- |
| **全项目源码** | **12,476** | **10,979** |
| `electron/`（主进程） | 2,201 | — |
| `src/renderer/`（渲染层） | 10,275 | — |

### 19.3 按目录细分

| 目录 | 文件数 | 行数 |
| --- | --- | --- |
| `electron/` | 4 | 1,518 |
| `electron/services/` | 4 | 683 |
| `src/renderer/`（index.html） | 1 | 13 |
| `src/renderer/src/`（main.js + App.vue） | 2 | 88 |
| `src/renderer/src/assets/` | 1 | **3,224** |
| `src/renderer/src/components/` | **20** | 3,957 |
| `src/renderer/src/composables/` | 4 | 198 |
| `src/renderer/src/utils/` | 2 | 171 |
| `src/renderer/src/views/` | **9** | 2,624 |

### 19.4 主要组件数量

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 视图（views） | 9 | dashboard/todos/calendar/review/bookmarks/bookshelf/files/chat/settings |
| **有效**组件（components） | **18** | 被引用的 |
| **死**组件 | **2** | `RightDock.vue`、`SuggestionPanel.vue` |
| composables | 4 | 其中 `useTodosStore` 被 2 处引用、`useTimer` 被 1 处、`toast` 被 12 处、`useWorkbench` 被 19 处 |
| 工具模块 | 2 | `quadrant.js`、`lunar.js` |
| IPC 通道 | **92** | + 1 个反向事件通道 |

### 19.5 复杂度判断

**结论：这是一个"中等偏小、结构清晰"的项目。**

- **规模**：12,476 行 / 47 文件，其中 **26% 是单个 CSS 文件**（3,224 行 `styles.css`），**纯逻辑代码约 9,000 行**。属于"个人项目做到产品级完成度"的典型体量。
- **单文件最大**：`electron/main.cjs` 1,263 行（**唯一真正需要关注的结构问题**，P1-4）。
- **组件最大**：`BookshelfView.vue` 720 行（但含 270 行样式）。
- **技术复杂度**：⭐ 低。零框架（除 Vue 本体）、零状态库、零路由、零 UI 库、零测试。**这意味着"理解成本极低，扩展门槛极低"** —— 对 Workspace 接入是**利好**。
- **领域复杂度**：⭐⭐ 中。真实实现了农历换算（1900–2100 数据表）、四象限算法、周期任务双向同步、书籍章节解析 + 多编码识别、.lnk 解析、在线书城下载入库。**这些是这个项目真正的"技术含量"，而非 AI 模块。**

---

## 20. Workspace 功能改造成本表

> 难度/风险均为**相对**判断。全部假定在"不改现有数据格式语义、不重构"的前提下。

| # | 功能 | 难度 | 风险 | 预计涉及的主要文件 | 是否需改现有数据格式 | 是否可能破坏现有功能 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Workspace 本体**（新建/列表/编辑/归档） | **低** | **低** | 新增 `workspaces.json`；`main.cjs`（+5 handler）；新增 `views/WorkspaceView.vue`；`App.vue`（viewMap）；`Sidebar.vue`（菜单） | ❌ 不改（纯新增文件） | ❌ 几乎不可能 |
| 2 | **Workspace 关联 Todo** | **低** | **中** | `main.cjs`（todos:\* 增加字段透传）；`TodoPanel.vue`（可选筛选 UI）；`todo.workspaceId` | ✅ **加字段**（向后兼容：缺失 = 未归类） | ⚠️ 需注意 `syncGoalRecurringTasks`（`main.cjs:257-273`）重建自动待办时会丢字段 |
| 3 | **Workspace 关联文件** | **低** | **中** | `files.cjs`（`addFavorite` 的去重逻辑 `:93`）；`files.json` 加 `workspaceId` | ✅ 加字段 | ⚠️ **唯一有行为变化的地方**：同一路径无法挂到两个 Workspace（见 10.4） |
| 4 | **Workspace 关联便签** | **低** | **低** | `files.cjs`（notes 相关）；`notes.json` 加 `workspaceId`；注意"快速便签"（`type:'quick'`）应始终未归类 | ✅ 加字段 | ❌ 低 |
| 5 | **Workspace 关联收藏夹** | **低** | **低** | `main.cjs`（bookmarks:\*）；`bookmarks.json` 加 `workspaceId` | ✅ 加字段 | ❌ 低 |
| 6 | **Workspace 关联快捷应用** | **中** | **低** | `apps.cjs`；`apps.json` 加 `workspaceId`；⭐ 需处理"一个 app 已有 `groupId` 又要 `workspaceId`"的双重归属语义 | ✅ 加字段 | ❌ 低（`groupId` 逻辑独立） |
| 7 | **Workspace 绑定工作流** | **低** | **低** | 仅 `workspaces.json` 加 `workflowIds: []`；运行时直接复用 `workbench.workflows.run(id)` | ❌ **完全不改** `workflows.json` | ❌ 几乎不可能（方案 B 的核心优势） |
| 8 | **开始工作** | **中** | **中** | 新增 `composables/useWorkSession.js`（模块级单例）；`sessions:start` handler；需处理"重复开始"与"上次未结束" | ✅ 新增表 | ❌ 低 |
| 9 | **工作计时** | **中** | **中** | `useWorkSession.js`；⚠️ **不能改 `useTimer.js`**（会破坏番茄钟）；需解决"组件卸载计时不停"（必须用模块级 ref） | ✅ 新增表 | ⚠️ 若误改 `useTimer.js` 会破坏计时器组件 |
| 10 | **结束工作** | **低** | **低** | `sessions:end` handler；`WorkSessionEndDialog` 组件（复选本次完成的 Todo + 备注 + 下一步） | ✅ 写 session 字段 | ❌ 低 |
| 11 | **Work Session 历史** | **低** | **低** | `sessions:list` handler；在 WorkspaceView 或 ReviewView 展示 | ❌ 表已存在 | ❌ 低 |
| 12 | **工作快照** | **低** | **低** | **无新增数据表**（复用 session 字段）；仅需若干 computed + join | ❌ 不改 | ❌ 低 |
| 13 | **继续上次工作** | **中** | **中** | `WorkspaceView.vue` + `useWorkSession.js` + 调用现有 `workflows.run`；⚠️ 依赖"应用预检存在性"（新增，低风险） | ❌ 不改 | ❌ 低 |
| 14 | **自动汇总今日工作** | **低** | **低** | `ReviewView.vue`（+1 个区块 +2 个 IPC 调用）；`sessions:list` 或 `list-by-date` | ❌ 只读不写 | ❌ 低 |
| 15 | **Dashboard 显示最近 Workspace** | **低** | **低** | `DashboardView.vue` 加一个卡片组件；`workspaces.list()` 按 `lastOpenedAt` 排序 | ❌ 不改 | ❌ 低 |

### 20.1 成本汇总

| 难度分布 | 数量 |
| --- | --- |
| **低** | **11 项**（1,2,3,4,5,7,10,11,12,14,15） |
| **中** | **4 项**（6,8,9,13） |
| **高** | **0 项** |

| 风险分布 | 数量 |
| --- | --- |
| **低** | **11 项** |
| **中** | **4 项**（2,3,8,9） |
| **高** | **0 项** |

**关键结论：没有任何一项需要"高难度"或"高风险"。** 15 项功能中有 11 项是"低难度 + 低风险"，剩下 4 项的中等风险全部来自**同一个根源**：给现有数据表加 `workspaceId` 时的一致性维护（第 2、3 项），以及跨页面计时状态的管理（第 8、9 项）。这两类问题都有明确的、已被现有代码验证过的解法。

---

## 21. Workspace MVP 推荐范围

> 目标：**既能体现"连续工作"创新，又尽量少改现有项目。**
> 时间假设：参赛前的有限时间内，且**不允许破坏现有功能**。

### 21.1 P0 — 必须做（没有这些就不算 Workspace 功能）

| # | 内容 | 涉及文件 | 为什么必须 |
| --- | --- | --- | --- |
| P0-1 | **`workspaces.json` + 4 个 IPC 通道**（list/create/update/delete） | `main.cjs` | 数据地基，一切的前提 |
| P0-2 | **Workspace 页面**（列表 + 新建/编辑 + 进入） | 新增 `views/WorkspaceView.vue` | 演示的主体界面 |
| P0-3 | **导航接入**（viewMap + Sidebar 菜单项） | `App.vue`、`Sidebar.vue` | 否则页面进不去 |
| P0-4 | **Todo 加 `workspaceId` + Workspace 内筛选显示待办** | `main.cjs`、`TodoPanel.vue`（或 WorkspaceView 内独立展示） | **"关联已有 Todo 而非重做一套"是用户核心诉求**，也是评审最能看懂的复用点 |
| P0-5 | **`work-sessions.json` + 开始/结束工作**（含 `endedAt: null` 未结束检测） | 新增 `main.cjs` handler + `composables/useWorkSession.js` | **"连续工作"的创新点本体** |
| P0-6 | **工作计时**（模块级单例，跨页面存活） | `useWorkSession.js` | 与 P0-5 是同一件事的两面 |
| P0-7 | **工作快照展示**（"上次做到哪里 / 还有什么没完成 / 下一步是什么"） | `WorkspaceView.vue`（纯 computed） | **演示时最具冲击力的一屏**，且零额外数据表 |
| P0-8 | **文件 + 便签 + 收藏夹 + 快捷应用加 `workspaceId`** | `files.cjs`、`main.cjs` | 让 Workspace 真正"聚合"，否则只是个空壳。**注意 `files.cjs:93` 的去重逻辑** |
| P0-9 | **工作流绑定**（`workspace.workflowIds` + 一键运行） | 仅 `workspaces.json` + 复用 `workbench.workflows.run` | 复用现成引擎，**主进程零改动**，性价比最高的一项 |

### 21.2 P1 — 推荐做（成本低、显著提升完整度）

| # | 内容 | 理由 |
| --- | --- | --- |
| P1-1 | **"继续上次工作"一键流程** | 自动开文件夹/开应用/开网页 —— **直接调用 P0-9 绑定的工作流**，几乎零额外成本，但演示效果最强 |
| P1-2 | **今日复盘显示工作时长汇总**（`ReviewView.vue` 加 1 个区块） | 改动极小（约 30 行），但把"工作记录"与"复盘"串成闭环，**是"个人效率系统"完整性的关键证据** |
| P1-3 | **Dashboard 显示最近 Workpace 卡片** | 提升"连续性"感知；复用 `lastOpenedAt` 排序 |
| P1-4 | **资源存在性预检**（`fs.existsSync` → `exists` 布尔字段） | 避免演示时点了失效路径却只弹一个 toast。**参赛演示的可靠性保障** |
| P1-5 | **Workspace 归档（`archived`）而非删除** | 防止误删导致大量 Todo/文件失去归属 |
| P1-6 | **工作流 file 步骤改用 `system.selectFile` 选择器** | 修 P2-3，让演示时不必手打路径 |

### 21.3 P2 — 有时间再做

| # | 内容 | 理由 |
| --- | --- | --- |
| P2-1 | Session 历史时间线视图 | 有价值但非核心 |
| P2-2 | `workspaceIds[]` 多归属 | **先做单值，保留升级路径**（见 10.3） |
| P2-3 | Workspace 图标（`icon` 字段 + 扩充 `LineIcon.vue`） | 用 `color` 首字母已能应付 MVP |
| P2-4 | `autoRunWorkflowIds`（打开时自动运行指定工作流） | 见 14.4，MVP 手动触发更可控 |
| P2-5 | 打开过的资源记录（`openedResources`）用于更精细的"恢复现场" | 收益递减 |
| P2-6 | 日历上显示工作时长 | `CalendarView.vue` 已有工作日/待办叠加机制，可复用 |
| P2-7 | `schemaVersion` + 极简 migration 基建 | **技术上是 P0 级债，但业务上可延后**；若时间允许，强烈建议挤进 P1 |

### 21.4 暂时不要做（明确排除）

| 排除项 | 理由 |
| --- | --- |
| ❌ **自研 AI 助手** | 现有 AI 模块是 webview 网页容器，没有任何模型接入基建（无 API key 管理、无请求层、无 prompt 体系）。自研等于从零做一个新项目，且**与"本地离线"定位冲突**（需要联网 + API key） |
| ❌ **复杂 AI 分析**（如自动生成下一步建议、智能归类待办） | 同上；且第 13 章已证明**"继续上次工作"完全可以用普通程序逻辑实现**，不需要 AI |
| ❌ **云同步** | 与"数据自主 / JSON 本地存储 / 无账号"的核心定位直接冲突。README `:25,160` 明确承诺离线 |
| ❌ **多用户** | `settings.user` 是单对象（`defaults.cjs:14`），无多用户基建；且产品定位是"个人工作台" |
| ❌ **在线账号系统** | README `:19` 明确"不需要登录账号" |
| ❌ **复杂协作** | 需要服务端 + 冲突解决 + 权限，与本地单机架构根本冲突 |
| ❌ **过度重构** | 尤其：**不要引入 vue-router**（设计文档 `:10` 明确排除）、**不要引入 Pinia**、**不要把 `main.cjs` 大卸八块**。这些都会在赛前引入不可控的回归风险 |
| ❌ **引入 UI 组件库** | 现有 UI 是手写 + CSS 变量体系（`styles.css` 3,224 行），换库会破坏全部视觉一致性 |
| ❌ **给工作流加 `args` / `spawn` 带参启动** | 引入"任意程序 + 任意参数执行"的安全面，且需要替换 `shell.openPath`。**用 `.lnk` 快捷方式即可绕过**（第 15.2 节） |
| ❌ **关系表（relation JSON）** | 第 10.3 节已论证：与项目风格完全不符，改动最大 |
| ❌ **给 Workspace 加聚合统计字段**（totalMinutes 等） | 立刻产生一致性地狱，见 11.4 |

### 21.5 MVP 的一句话定义

> **Workspace MVP = 一张新的 `workspaces.json` + 给 6 张现有表各加一个 `workspaceId` + 一张 `work-sessions.json` + 一个 WorkspaceView 页面 + 复用现有工作流引擎的"继续工作"按钮。**
> 不新增任何第三方依赖，不引入路由/状态库，不改任何现有数据字段的语义，不重构 `main.cjs`。

---

## 22. 文件级改动地图

> ⚠️ **以下全部为"假设未来实现"的规划，本次审计未创建、未修改任何文件。**

### 22.1 预计新增文件（6 个）

| # | 文件 | 作用 | 规模估计 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | `src/renderer/src/views/WorkspaceView.vue` | Workspace 主页：列表/详情、关联资源聚合、"开始工作"按钮、工作快照展示 | 约 400–600 行（含 scoped CSS） | **低**（全新文件，不影响任何现有代码） |
| 2 | `src/renderer/src/composables/useWorkSession.js` | **模块级单例**（照抄 `useTimer.js:3-9` 的顶层 ref 模式）：当前 session、计时 tick、开始/结束逻辑 | 约 120–180 行 | **中**（必须模块级，否则跨页面丢失；这是最容易做错的地方） |
| 3 | `src/renderer/src/components/WorkspaceCard.vue` | Workspace 卡片（颜色条、名称、描述、最近打开时间、未完成数） | 约 100–150 行 | 低 |
| 4 | `src/renderer/src/components/WorkSessionPanel.vue` | 计时显示 + 结束工作表单（勾选本次完成的 Todo、备注、下一步） | 约 200–300 行 | 低 |
| 5 | （可选）`src/renderer/src/components/ResumeWorkCard.vue` | "上次做到哪里/还有什么没完成/下一步" + 【继续上次工作】按钮 | 约 150 行 | 低 |
| 6 | （可选）`src/renderer/src/utils/workspace.js` | 纯函数：按 workspaceId 过滤/分组的复用逻辑，避免在多个组件里重复 `filter` | 约 60 行 | 低 |

**数据文件（运行时由 `DataStore` 自动创建，不是"新增源码文件"）：**
- `data/workspaces.json`（新增，数组）
- `data/work-sessions.json`（新增，数组）

### 22.2 预计修改文件（9 个）

| # | 文件 | 为什么需要改 | 大概改什么 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | **`electron/main.cjs`** | 新增 IPC 通道 + Workspace/Session 的读写函数 | ① 在 `:69-83` 附近加 `readWorkspaces/writeWorkspaces/readSessions/writeSessions`；② 在 `registerIpc()` 内新增约 **11 个 handler**（`workspaces:list/create/update/delete/reorder/touch` + `sessions:list/start/end/update/delete`），照抄 `groups:*`（`:726-749`）的模式；③ 在所有现有 `read*/write*` 调用点**透传** `workspaceId`（`todos:create` `:815-835`、`todos:update` 等） | **中**。这是唯一需要碰 1,263 行大文件的地方。**关键防御**：`todos:create`（`:818-831`）显式列举了字段白名单，**必须记得加 `workspaceId`，否则前端传了也会被丢弃** |
| 2 | **`electron/services/files.cjs`** | 便签与文件收藏需要支持 `workspaceId` | ① `addFavorite`（`:90-110`）的 entry 加 `workspaceId`，并**修改去重键**（`:93`，见 10.4）；② `addNote`（`:199-212`）的 entry 加 `workspaceId`；③ 两个函数的入参要能接收 `workspaceId` | **中**。`addFavorite` 的去重逻辑改动**会改变现有行为**（同一路径不再能重复添加），需确认产品意图 |
| 3 | **`electron/services/apps.cjs`** | 快捷应用需要支持 `workspaceId`（且不被扫描流程覆盖） | `makeAppEntry`（`:81-110`）加 `workspaceId`；`addApp`（`:121-127`）/`addBatch`（`:274-292`）透传 options | 低 |
| 4 | **`src/renderer/src/App.vue`** | 导航接入新页面 | `:27-35` 加 import；`:51-61` 的 `viewMap` 加 `workspace: WorkspaceView` | **低**（3 行） |
| 5 | **`src/renderer/src/components/Sidebar.vue`** | 菜单接入新入口 | `:85-95` 的 `baseNavItems` 加 `{ id:'workspace', icon:'workspace', label:'工作空间' }` | **低**（1 行）。⚠️ 注意 `:97-110` 的排序逻辑对未在 `navOrder` 中的项会排到 999（即末尾），老用户升级后新菜单出现在最后，符合预期 |
| 6 | **`src/renderer/src/components/LineIcon.vue`** | 提供 `workspace` 图标 | 在 name→path 映射表中加一个条目 | 低。**不加也不会报错**，只是图标缺失 |
| 7 | **`src/renderer/src/components/TodoPanel.vue`** | 支持"只显示某 Workspace 的待办"筛选 | ① `:151-155` 的 `filteredTodos` 增加 workspace 过滤；② `:202-212` `openCreate` / `:231-254` `saveTodo` 透传当前 `workspaceId`；③ 可选：列表项显示 Workspace 标签 | **中**。`TodoPanel` 是 646 行的核心组件，且它**自己维护 `todos` ref**（`:133`）而非用 `useTodosStore`。建议**用可选 prop 传入 `workspaceId`**，不传时行为完全不变（保证向后兼容） |
| 8 | **`src/renderer/src/views/ReviewView.vue`** | 今日复盘显示工作时长汇总 | ① `:11-25` metrics 区加一张卡/一个区块；② `:127-136` `loadData` 的 `Promise.all` 加 2 个 IPC；③ 加 1 个 computed 做分组求和 | **低**（约 30 行）。⚠️ 顺带建议修 B3（`getReviewRecord` 读时写盘），但那属于 bug 修复，需单独决策 |
| 9 | **`src/renderer/src/views/DashboardView.vue`** | （P1）显示"最近工作空间"卡片 | `:11-46` 模板加一个区块；`widgetDefs`（`:62-65`）可选加 `workspace` widget | 低 |

### 22.3 明确**不需要**改的文件（重要，减少顾虑）

| 文件 | 为什么不用改 |
| --- | --- |
| ✅ `src/renderer/src/composables/useTimer.js` | **不要动**。它承担番茄钟/秒表，工时计时用新建的 `useWorkSession.js`。改它会破坏现有计时器 |
| ✅ `electron/services/backup.cjs` | 备份逻辑是"遍历 `data/*.json` 全量打包"（`:5`）→ **新增的 `workspaces.json` / `work-sessions.json` 会自动被备份覆盖，零改动**。这是本项目备份设计的一个隐性优点 |
| ✅ `electron/store.cjs` | `DataStore` 是通用 KV 原语，新表直接可用，**零改动** |
| ✅ `electron/preload.cjs` | 需**新增** API 条目（`workspaces.*`、`sessions.*`），但这是**追加**而非修改，且模式完全照抄 `groups`（`:54-59`）。原条目一行不动 |
| ✅ `electron/services/launcher.cjs` | 方案 B 下 `runWorkflow(store, workflowId)` 签名已满足需求，**零改动**（这是方案 B 最大价值） |
| ✅ `electron/defaults.cjs` | 除可能加 `defaultWorkspaces()` 外无需改 |
| ✅ `src/renderer/src/utils/quadrant.js` | 复用其 `sortTodosByQuadrant` 即可，零改动 |
| ✅ `src/renderer/src/utils/lunar.js` | 零改动 |
| ✅ `src/renderer/src/assets/styles.css` | 建议**不改全局样式**，WorkspaceView 用 scoped style，避免影响其他页面 |
| ✅ `src/renderer/index.html` | CSP 无需调整（Workspace 不加载外部网页） |
| ✅ `vite.config.mjs` / `package.json` | **零改动** —— 不引入任何新依赖 |
| ✅ `electron/services/apps.cjs`（除了第 3 项） | 逻辑零改动 |

### 22.4 改动风险热力图

```text
高风险  │ （无）
        │
中风险  │ main.cjs（+11 handler 到 1263 行文件）    TodoPanel.vue（646 行核心组件）
        │ files.cjs（去重语义变化）                  useWorkSession.js（必须模块级单例）
        │
低风险  │ App.vue  Sidebar.vue  LineIcon.vue  ReviewView.vue  DashboardView.vue
        │ WorkspaceView.vue（新）  WorkspaceCard.vue（新）  WorkSessionPanel.vue（新）
        │
零风险  │ store.cjs  launcher.cjs  backup.cjs  quadrant.js  lunar.js  styles.css
        │ package.json  vite.config.mjs  index.html
```

---

## 23. 推荐开发顺序

> 原则：**先地基后楼层、先可回滚后可演示、每一步都能独立验证。**

### 阶段 0：前置决策与安全网（建议 0.5 天，**强烈建议不要跳过**）

| 步骤 | 内容 | 产出 |
| --- | --- | --- |
| 0.1 | **先导出一份完整备份**（应用内"导出备份"，或直接复制 `Documents\小菠萝的工作台\`） | 出问题可完整回滚 |
| 0.2 | **确认第 24 章的 6 个产品问题**（尤其"同一文件能否属于两个 Workspace"、"目标生成的待办归属"） | 避免返工 |
| 0.3 | **在 git 上打一个 tag/branch**（如 `pre-workspace`） | 可随时 diff 与回退 |
| 0.4 | （可选但强烈建议）**为 `store.cjs` 写 3 个单元测试**（写入/读取/损坏自愈） | 后续所有数据层改动的安全网 |

### 阶段 1：数据地基（**先数据后 UI**，建议 1 天）

| 步骤 | 内容 | 验证方式 |
| --- | --- | --- |
| 1.1 | `main.cjs` 加 `readWorkspaces/writeWorkspaces` + 4 个 `workspaces:*` handler | 用 DevTools 控制台/临时按钮调 `workbench.workspaces.list()` |
| 1.2 | 手动往 `workspaces.json` 写 2 条测试数据，确认 `list` 能读出 | 检查 JSON 文件 |
| 1.3 | 加 `sessions:*` handler + `work-sessions.json` | 同上 |
| 1.4 | **验证向后兼容**：把 `workspaces.json` 删掉，确认应用照常启动（`store.read` 会返回 `[]`） | 重启应用 |
| 1.5 | **验证备份自动覆盖新表**：导出备份，确认新 JSON 在备份文件里 | 查看备份文件 |

> ⚠️ **阶段 1 结束时必须确认：现有功能 100% 未受影响。** 此时还没有任何 UI 改动，是验证成本最低的时刻。

### 阶段 2：页面骨架与导航（建议 0.5 天）

| 步骤 | 内容 |
| --- | --- |
| 2.1 | 新建 `WorkspaceView.vue`，先只做"列表 + 新建/编辑" |
| 2.2 | `App.vue` 的 `viewMap` + `Sidebar.vue` 的 `baseNavItems` 接入 |
| 2.3 | 加 `LineIcon` 的 `workspace` 图标 |
| 2.4 | **验证**：菜单能进、能建 Workspace、刷新后数据还在、**其他 9 个页面全部正常**（重点回归） |

### 阶段 3：关联现有数据（**本阶段风险最高，建议 1.5 天，逐类推进**）

| 步骤 | 内容 | 风险控制 |
| --- | --- | --- |
| 3.1 | **先做 Todo**（因为 TodoPanel 结构最清晰，且 Todo 是核心） | 用**可选 prop** 传 `workspaceId`，不传时行为完全不变 |
| 3.2 | 再做便签 + 收藏夹（这两个表结构最简单，仅需加字段） | 每做完一类就回归验证一次 |
| 3.3 | 再做文件收藏（**注意 `files.cjs:93` 去重逻辑**） | 这是唯一改变现有行为的地方，单独验证 |
| 3.4 | 最后做快捷应用（要处理与 `groupId` 的双重归属） | — |
| 3.5 | **重点验证 `syncGoalRecurringTasks`**：创建带周期任务的目标，让它生成待办，确认 `workspaceId` 行为符合决策 | 这是最容易被忽略的破坏点 |

### 阶段 4：工作会话与计时（**创新点核心**，建议 1 天）

| 步骤 | 内容 |
| --- | --- |
| 4.1 | 新建 `useWorkSession.js`（**必须模块级 ref**，照抄 `useTimer.js:3-9`） |
| 4.2 | 实现开始/结束工作 + 计时 tick |
| 4.3 | **验证跨页面存活**：开始工作 → 切到"待办" → 切回来，确认计时未中断、时长正确 |
| 4.4 | **验证异常恢复**：开始工作 → 强杀应用 → 重启，确认能检测到 `endedAt === null` 的未结束会话 |
| 4.5 | 结束工作表单（勾选本次完成的 Todo、备注、下一步） |

### 阶段 5：工作快照与"继续上次工作"（建议 1 天）

| 步骤 | 内容 |
| --- | --- |
| 5.1 | 工作快照展示（纯 computed join 已有数据） |
| 5.2 | 工作流绑定（`workflowIds` + 复用 `workbench.workflows.run`） |
| 5.3 | 资源存在性预检（`exists` 布尔） |
| 5.4 | 【继续上次工作】按钮：新建 session + 运行绑定工作流 + 启动计时 + 切视图 |
| 5.5 | **端到端验证**：完整走一遍"开始工作 → 做几件事 → 结束工作 → 关闭应用 → 重开 → 继续上次工作" |

### 阶段 6：闭环与打磨（建议 1 天）

| 步骤 | 内容 |
| --- | --- |
| 6.1 | `ReviewView.vue` 加今日工作时长汇总 |
| 6.2 | `DashboardView.vue` 加最近 Workspace 卡片 |
| 6.3 | 工作流 file 步骤改用 `system.selectFile` 选择器（提升演示流畅度） |
| 6.4 | 空状态、错误提示、loading 态打磨（**评审观感的关键**） |
| 6.5 | README 更新（**务必同步修正第 7.1 节的 README 不一致项**） |
| 6.6 | 完整回归：9 个原有页面 + 20 个组件功能逐项过一遍 |
| 6.7 | 准备演示数据与演示脚本（预设好 Workspace、绑好工作流、**确保所有路径有效**） |

### 顺序上的 3 条硬性建议

1. **绝对不要在阶段 1 之前动 UI。** 数据层先跑通，是唯一能在低成本下验证"没有破坏现有数据"的顺序。
2. **绝对不要为了 Workspace 去改 `useTimer.js`、`main.cjs` 的现有 handler 语义、或 `files.cjs` 以外的共享逻辑。** 新功能尽量写在**新文件**里，`main.cjs` 只做"追加 handler"。
3. **阶段 3 之后、阶段 4 之前，务必完整回归一次。** 给 6 张表加字段是本项目最容易出问题的一步（尤其是 `syncGoalRecurringTasks` 会重写待办数组）。

---

## 24. 需要产品负责人进一步确认的问题

> 以下 8 个问题会**实质性影响数据模型与改动范围**，建议在动手前明确。每个问题都给出我的推荐答案。

| # | 问题 | 为什么重要 | 我的推荐 |
| --- | --- | --- | --- |
| **Q1** | **同一条记录（文件/便签/收藏）是否允许同时属于多个 Workspace？** | 决定用 `workspaceId` 还是 `workspaceIds[]`。直接决定第 2、3、4、5 项功能的实现方式 | **推荐：MVP 阶段不允许（用 `workspaceId`）。** 与项目现有 `groupId`/`categoryId` 风格一致，改动最小。若未来确有需求，`workspaceId` → `workspaceIds[]` 的升级是兼容的 |
| **Q2** | **`files.json` 目前按路径去重（`files.cjs:93`），加 Workspace 后是否允许同一路径出现在不同 Workspace？** | 这是**唯一会改变现有行为**的改动点 | **推荐：允许（去重键改为 `path + workspaceId`）。** 否则"同一项目文件夹用于两个 Workspace"无法实现，而这恰恰是常见需求 |
| **Q3** | **长期目标自动生成的待办（`generated: true`）应归属哪个 Workspace？** | `syncGoalRecurringTasks()`（`main.cjs:228-313`）会**重建**待办数组，若不同步维护 `workspaceId` 该字段会丢失 | **推荐：从目标继承。** 在 `Goal` 上也加 `workspaceId`，生成待办时带上；同时**必须在 `syncGoalRecurringTasks` 的重建逻辑里保留该字段**（`:257-273`） |
| **Q4** | **Workspace 的"删除"应该是真删还是归档？** | 决定是否加 `archived` 字段，以及关联数据（Todo/文件）的处置 | **推荐：归档为主（`archived: true`），真删需二次确认并要求用户选择"关联数据处理方式"。** 保护用户数据符合产品定位 |
| **Q5** | **"开始工作"时是否必须绑定一个 Workspace？** | 决定 `session.workspaceId` 是否可为 null | **推荐：允许 null（不绑定也能计时）。** 降低使用门槛，也让 `work-sessions.json` 更通用 |
| **Q6** | **"继续上次工作"应该自动运行几个工作流？一个还是全部绑定的？** | `runWorkflow` 失败即中断（`launcher.cjs:68-72`），串行多个会放大失败风险 | **推荐：只自动运行 1 个（用 `autoRunWorkflowIds` 指定），其余在界面列出由用户手动点击。** 演示更可控 |
| **Q7** | **本次是否允许顺手修复第 17 章的 P0/P1 缺陷？** | P0-1（`backup:import` 路径穿越）与 P1-1（提醒永不生效）是**真实缺陷**，但修复它们属于"额外工作"，且会碰 `backup.cjs`（备份是数据安全关键路径） | **推荐：分两步。** ① `P1-2`（便签丢字，改 3 行）和 `P1-5`（chatProviders.enabled，改 4 行）风险极低，可顺带修；② `P0-1`、`P1-1`、`P1-3` 建议**单独作为一个修复轮次**，配好回归测试后再动 |
| **Q8** | **是否需要为 Workspace 加 `schemaVersion` + migration 基建？** | 加 `workspaceId` 是本项目第一次"批量修改 6 张表的结构"。没有版本号，将来第二次改动会更危险 | **推荐：加，且越早越好。** 成本很低（一个 `meta.json` + 一个 `migrate()` 分支），但它是所有未来结构演进的保险。**如果时间紧张，可以作为阶段 0 的一部分** |

---

## 25. 最终结论

### 25.1 总体判断

**这个项目是一个"架构简单但完成度高"的本地桌面应用，它的数据层和 IPC 层设计得比它的规模所要求的更规范，因此非常适合承载 Workspace 这个新方向。**

它最值得肯定的三点：
1. **数据层有真正的抽象**（`DataStore` 一个类管住全部 17 张 JSON 表，含原子写入 + 损坏自愈）；
2. **IPC 有统一模式**（92 个通道全走 `safeHandle` 错误包装）；
3. **Electron 安全基线正确**（`contextIsolation` + `sandbox` + `contextBridge` + CSP + webview 白名单，且**唯一一处 `v-html` 有正确的转义**）。

它最需要警惕的三点：
1. **`electron/main.cjs` 1263 行、职责过多**，会成为所有改动的冲突热点；
2. **零测试、零 lint、零类型检查**，12,476 行代码没有任何自动化安全网；
3. **数据无版本号无迁移机制**，而 Workspace 恰好要做本项目第一次"批量改 6 张表结构"。

**但这三点都不构成 Workspace 的阻碍** —— 它们是"应该顺手补的工程债"，而不是"必须推翻重来的架构问题"。

### 25.2 十五个问题的最终回答

**Q1：目前这个项目整体架构是否适合继续增加 Workspace？**
**适合。** 依据：`DataStore` 是通用 KV 原语（`store.cjs:34-60`），新增 `workspaces.json` 成本几乎为零；92 个 IPC 全走统一的 `safeHandle` 模式（`main.cjs:48-57`）；新增一级页面只需改 3 处（`App.vue:51-61` + `Sidebar.vue:85-95`）。**判定为 B 级：可以实现，改动中等。**

**Q2：增加 Workspace 是否需要推翻现有结构？**
**完全不需要。** 现有结构中的 4 个关键机制都可以原样复用：① 数据读写（`DataStore`）② IPC 注册（`safeHandle`）③ 页面挂载（`viewMap`）④ 多步自动化执行（`launcher.runWorkflow`）。**唯一"缺失"的是路由，但项目本来就不需要路由**（设计文档 `docs/superpowers/specs/2026-08-13-workbench-design.md:10` 明确排除了 vue-router）。

**Q3：现有 Todo、文件、便签、快捷应用能否直接复用？**
**能，全部直接复用，只需各加一个 `workspaceId` 字段。** 不需要重做任何一个模块。
- Todo：`todos.json` 加字段，`TodoPanel.vue` 用可选 prop 接收筛选条件
- 文件：`files.json` 加字段（⚠️ 需同时调整 `files.cjs:93` 的路径去重键）
- 便签：`notes.json` 加字段（注意 `type:'quick'` 的快速便签应保持未归类）
- 快捷应用：`apps.json` 加字段（与现有 `groupId` 并存，语义独立）

**Q4：现有工作流能否复用？**
**能，而且几乎零改动。** `launcher.runWorkflow(store, workflowId)`（`launcher.cjs:51`）已接受 `workflowId`，IPC 通道 `workflows:run` 已存在（`main.cjs:926`），渲染层 `workbench.workflows.run(id)` 已可用（`preload.cjs:104`）。**Workspace 想运行绑定的工作流，直接调用即可，主进程一行都不用改。**
⚠️ 但要知道它的真实能力边界：只有 `app`/`file`/`url` 三种步骤，无参数、无条件、无计时、无状态、无执行历史（详见第 8.3 节）。

**Q5：工作流应该直接放入 Workspace，还是保留独立工作流库再由 Workspace 绑定？**
**保留独立工作流库，Workspace 用 `workflowIds: []` 绑定（方案 B）。**
4 个决定性理由：① 用户自己的例子（"每日收尾"被多个 Workspace 共用）在方案 A 下无法优雅实现；② 方案 B 主进程零改动（复用现有 `workflows:run`）；③ 零数据迁移风险（现有 `workflows.json` 完全不碰）；④ 与项目现有引用模式（`steps[].appId` → `apps.json`、`todo.sourceGoalId` → goals）完全同构。

**Q6：工作现场快照能否不用 AI 实现？**
**能，100% 用普通程序逻辑实现，而且所需数据几乎全部已存在。**
- 剩余事项 = `todos.filter(workspaceId && !completed)` ← **已有**
- 相关资源 = `files/bookmarks/notes/apps.filter(workspaceId)` ← **实体已有，仅缺字段**
- 本次完成 = `session.completedTodoIds` join `todos` ← 仅需新建关系
- 备注 / 下一步 = 用户手填两个字符串
- 唯一需要"新数据"的只有：Session 记录 + `nextStep` 字符串
**不需要任何模型、任何 prompt、任何联网。**

**Q7："继续上次工作"能否可靠实现？**
**能可靠实现。** 用户设想的 7 个动作（打开 Workspace / 显示未完成 Todo / 开文件夹 / 开 VS Code / 开 GitHub / 开文档 / 开始计时）**全部有现成能力可用**，且"开文件夹/开应用/开网页"正好对应现有工作流的 3 种 step 类型。
**但可靠性取决于 3 个防御措施**：① Session 支持 `endedAt: null`（防崩溃丢失）；② 启动前 `fs.existsSync` 预检并灰显失效项；③ 只自动运行 1 个工作流（避免失败中断）。
**已知限制**：`shell.openPath` **无法传参数**，因此"用 VS Code 打开指定文件夹"这种带参启动做不到（可用 `.lnk` 快捷方式绕过，或拆成两步）。
**Windows 具体风险**：中文/空格路径**已天然安全**（全程用 `shell.openPath` 而非命令行拼接，且本机 `Documents\小菠萝的工作台\` 就是中文路径，已在真实使用中验证）；主要风险是 exe 路径失效和权限问题（需 UAC 提权的程序会失败），建议用"预检 + 灰显 + 明确文案"应对，不要尝试绕过提权。

**Q8：当前项目最大的技术债是什么？**
**是"缺少数据版本与迁移机制"（P0-2），而不是任何单个 bug。**
理由：项目已有 17 张 JSON 表，且已经表现出"字段演进靠读时兜底"的模式（如 `quadrant.js:9-10` 从 `priority` 推导 `importance`、真实 `settings.json` 里残留 `weatherLocation` 死字段）。**Workspace 恰好要做本项目第一次"批量给 6 张表加字段"的结构性改动** —— 没有版本号和 migration，这次改动的风险无法被系统性控制，而且第二次、第三次只会更危险。
**紧随其后的第二、第三大债**：`electron/main.cjs` 单文件 1263 行职责过多（P1-4）；零测试/零 lint（P1-7）。

**按"影响力"排序的前 5 个债务（可据此排修复优先级）：**
1. **无 schema 版本与迁移机制**（P0-2）—— 唯一会限制未来所有结构演进的一项
2. **webview 导航/弹窗链路无协议与后续导航校验**（P1-6）—— 本次审计中安全影响最大的一条链，修一处的收益最大
3. **待办提醒实际不可用且失败后永久不再提醒**（P1-1）—— "静默且不可恢复"的功能失效，比崩溃更糟
4. **`electron/main.cjs` 1263 行、职责过多**（P1-4）—— 会成为所有后续改动的冲突热点
5. **零测试/零 lint**（P1-7）—— 加 Workspace 时任何回归都只能靠手工点

**另需单列一项"数据正确性"债务**：`CalendarView.vue:129-160` 的 `holidayMap` **内容本身是错的**（2026 年春节日期用了 2025 年的）。它与上面 5 项性质不同 —— 不是"缺机制"，而是"已有数据错误"，且**用户可见、评审可见**，参赛前应优先处理（详见 Q9）。

**Q9：最容易因为改 Workspace 而被破坏的是哪个模块？**
分两个角度回答，两者不同：

**（A）"改 Workspace 时最容易被我改坏"的模块 —— `electron/main.cjs` 中"长期目标 → 待办/日历"的自动同步机制（`syncGoalRecurringTasks`，`:228-313`），以及围绕它的 `todos:create/update/delete`（`:815-870`）。**
具体原因：① `syncGoalRecurringTasks` **会重建 `todos.json` 的数组**（`:247-250` 的 `filter` + `:257` 的 `push`），若 `workspaceId` 没被显式保留就会**静默丢失**；② `todos:create`（`:818-831`）使用**显式字段白名单**，前端传了 `workspaceId` 也会被丢弃；③ `goals:checkin`（`:785-806`）和 `todos:update`（`:836-850`）之间有**双向回写**逻辑，任何字段改动都要同时考虑两侧。
**第二危险的是 `files.cjs:93` 的路径去重**（改它会改变现有用户可观察到的行为）。

**（B）"当前就已经坏掉、且最容易被用户/评审撞见"的模块 —— 按触发概率排序：**
1. **日历的法定节假日数据（B12）** —— 2026 年春节日期整体错误（用了 2025 年的），"除夕出现两次、春节出现 8 天"，**只要打开日历就能看见**，且与 README 宣称的日历能力直接矛盾。**参赛前必须处理。**
2. **文件浏览的无权限目录失败链（B14）** —— `files.cjs:46` 的 `readdirSync` 未包 try + `FileBrowser.browse` 无 catch，用户误入 `C:\System Volume Information` 等目录即**完全无提示失败**，是最容易复现的体验缺陷。
3. **书架阅读位置不恢复（B11）** —— `contentEl.value` 恒为 null，`scroll` 永远恢复不了，**每次重开书都回到章首**。阅读功能的核心体验之一失效。
4. **便签的快速便签可被误删（B13）与最后 500ms 丢字（P1-2/B17）** —— 两条都是**静默数据丢失**。
5. **收藏星标与实际数据不一致（B15）** —— 大小写双重语义导致重复收藏项 + 星标删不掉。

**强烈建议：阶段 3 每改一类数据就完整回归一次目标同步流程；同时把 (B) 中的 1、2 两项在动手 Workspace 之前单独修掉。**

**Q10：如果只做比赛 MVP，最少应该新增哪些功能？**
**9 项 P0（第 21.1 节）—— 一张 `workspaces.json` + 6 张表加 `workspaceId` + 一张 `work-sessions.json` + 一个 WorkspaceView + 复用工作流引擎的"继续工作"。**
其中**最不能省的三项**是：
1. **Workspace 关联现有 Todo 并在页面内展示**（这是"复用而非重做"的核心证据，评审最看得懂）
2. **开始/结束工作 + 模块级计时**（"连续工作"的创新点本体）
3. **工作快照三问展示**（"上次做到哪里 / 还有什么没完成 / 下一步是什么"）—— **演示时最具冲击力的一屏，且零额外数据表**
另外强烈建议挤进 MVP 的两项：**工作流绑定**（主进程零改动，性价比最高）和 **今日复盘汇总**（约 30 行，把闭环补全）。

**Q11：现有 AI 模块准确来说是不是仅"AI 网页入口"？**
**是，完全不折不扣的"AI 网页入口"。** 实现在 `ChatView.vue:40-52`，就是一个 `<webview>` 标签，4 个服务各用独立的 `persist:` 分区保存登录态。
**逐项确认**：不调用任何 AI API（无 `fetch`/`axios`）· 不保存 API Key（`chatProviders` 只有 `{enabled,url,label}`）· 无后端模型 · 无 prompt · **不读取任何用户本地数据**（只从 settings 取 URL）· 本质是带 4 个书签的受限浏览器。
**准确命名**：「AI 服务快捷入口」或「内嵌 AI 网页」。**不应称为"AI 助手"或"AI 对话"。** README `:45` 的描述本身是准确的，参赛材料中不应把它当作 AI 能力点。

**Q12：当前项目是否已经存在类似 Workspace 的数据结构或组件，可以直接复用？**
**没有直接的 Workspace 实体**（源码零 workspace 字段/类型），**但有 5 个高度同构的可复用模式**：
1. **`app-groups.json` + `app.groupId`**（`apps.cjs:15-26, 89`）—— 最接近："分组"就是轻量 Workspace，含 `id/name/sort/createdAt` + 完整 CRUD IPC（`main.cjs:726-749`）+ 前端分组 tab UI。**新增 Workspace 的 4 个 handler 可以逐行照抄 `groups:*`。**
2. **`todo.sourceGoalId` + `sourceDate`**（`main.cjs:269-270`）—— 单值外键跨表关联的现成范式
3. **`book.categoryId`**（`main.cjs:421, 1055-1057`）—— 可 null 的分类外键 + 删除分类时把子项置 null 的处理（`main.cjs:1104-1112`），**Workspace 归档时应照抄这个"级联处理"思路**
4. **`reader.progress[bookId]`**（`main.cjs:445`）—— 以 id 为键的字典结构，适合参考做"每 Workspace 的偏好/状态"
5. **`apps.lastLaunched` / `launchCount`**（`launcher.cjs:26-27`，**已在真实维护但无人使用**）—— "最近使用"的现成字段设计，`workspace.lastOpenedAt` 可直接照抄
**⚠️ 但没有可复用的"Workspace 页面组件"**：`RightDock.vue` 和 `SuggestionPanel.vue` 虽是死代码，但二者都不是 Workspace 类界面，**不建议改造复用**（会增加对死代码的依赖）。

**Q13：当前数据结构如果加入 Workspace，最推荐：`workspaceId` / `workspaceIds[]` / relation table / 其他？**
**最推荐 `workspaceId`（单值外键）。**
依据：项目有 **5 个单值外键先例**（`app.groupId`、`book.categoryId`、`todo.sourceGoalId`、`event.sourceGoalId`、`workflow.steps[].appId`）和 **0 个数组型外键、0 个关联表**。
- `workspaceIds[]`：与风格不符，需处理 `undefined` vs `[]` 双重空值，暂不推荐（但可作为未来升级路径，且升级是兼容的）
- relation table：**改动最大**（新增第 18 个 JSON + 所有消费方都要改成"先查关系再查实体"），与项目零先例，**明确不推荐**
- **唯一必须配套的调整**：`files.cjs:93` 的去重键需要从 `path` 改为 `path + workspaceId`（见 Q2）

**Q14：当前架构是否支持保存长期 Work Session 历史？**
**支持，而且这是本项目最擅长的事。**
- `DataStore.read/write`（`store.cjs:34-60`）就是为"不断追加的 JSON 数组"设计的，`checkins.json`（11 条日期）、`daily-review.json`（12 条记录）、`apps.json`（**63 条**）都证明了长期累积是可行的。
- **需要新建 `work-sessions.json`**，不能复用 `daily-review.json`（它以 `date` 为主键，一天只能一条，见 `main.cjs:1042`）。
- **唯一需要提前防范的性能点**：如果每天 3 段工作，一年约 1000 条 session。按 `books.json` 已达 59 KB 的经验，1000 条 session 约 300–500 KB，**全量 `JSON.parse` + IPC 传输仍在可接受范围**，但建议 `sessions:list` 支持按 `dateKey`/时间范围过滤，避免长期全量加载。
- **建议**：`sessions:list` 默认只返回最近 N 天（如 90 天），并提供按 Workspace 查询；这能在不引入数据库的前提下把性能风险压到最低。

**Q15：从源码真实情况来看，这个项目最值得保留并强化的现有特色是什么？**
**最值得强化的是"工作流引擎 + 快捷应用 + 文件系统集成"这套本地自动化能力，而不是 AI 模块。** 按价值排序：

1. **⭐ 已有的本地自动化骨架**：`launcher.cjs` 的 `runWorkflow`（3 种 step 类型 + 顺序执行）与 `apps.cjs` 的图标提取/.lnk 解析/桌面扫描（含用 PowerShell COM 解析快捷方式真实目标）。**这是"真桌面应用"而非"套壳网页"的核心证据，也是最难被其他参赛作品抄走的部分。**
2. **⭐ 真实维护但完全未被使用的埋点**：`apps.json` 的 `lastLaunched` + `launchCount`。**63 条真实数据都有，但零 UI 使用。** 强化它（最近使用排序、使用频率统计）几乎零成本却能立刻提升"智能感"。
3. **⭐ 长期目标的周期任务双向同步**：`syncGoalRecurringTasks`（`main.cjs:228-313`）实现"目标 → 自动生成待办 + 自动生成日历事件 + 待办完成回写打卡"的完整闭环，还带每小时定时同步。**这个逻辑的复杂度被严重低估了，它是"效率系统"最有说服力的证据。**
4. **⭐ 书架模块的工程细节**：4 种编码识别（UTF-8/BOM/UTF-16LE/BE/GB18030，`main.cjs:453-477`）、章节正则解析（`:479-507`）、在线书城下载自动入库（`:1234-1251`）。**在中文环境下处理 GB18030 是真实痛点，这是很扎实的工作。**
5. **数据层的自愈设计**：`store.cjs:42-51` 的"解析失败 → 改名备份 → 重建默认值"，以及 `:56-59` 的临时文件 + rename 原子替换。**个人项目能想到这一层的不多。**
6. **工作流本身** —— 但需要**强化而非保留现状**：目前只有 23 行执行逻辑、3 种 step、无状态无历史（第 8.3 节）。**它是最值得投入的"半成品"**：只要扩展 step 类型（比如加 `delay` 可配置、加 `todo` 操作、加执行历史与状态），它就能从"启动器编排"升级为真正的"自动化引擎"，而 Workspace 的"一键继续工作"正是它最好的应用场景。

**一句话总结：这个项目的差异化优势在于"真正接管 Windows 本地文件与应用"，Workspace 应该建立在这个优势之上，而不是去追 AI 热点。**

---

## 附录 A：审计过程与合规声明

| 约束 | 执行情况 |
| --- | --- |
| 只分析，不实现新功能 | ✅ 未实现任何功能 |
| 不修改现有源码 | ✅ `git status --short` 输出为空 |
| 不删除/移动/重命名任何文件 | ✅ 未执行任何此类操作 |
| 不做大规模重构 | ✅ 未执行重构 |
| 不自动 commit / push | ✅ 未执行任何 git 写操作（仅 `status`/`log`/`tag`/`rev-parse` 只读命令） |
| 不因为发现问题就顺手修复 | ✅ 所有问题仅记录在报告第 17 章 |
| 可执行只读检查、搜索、构建、测试 | ✅ 执行了 grep/glob/read/`npm run build`/版本查询 |
| 运行项目进行验证但不得修改业务数据 | ✅ **刻意未启动 Electron**（启动会触发 `syncGoalRecurringTasks()` 写盘）。构建产物写入 `dist/`（已在 `.gitignore`），且 `data/*.json` 的 `LastWriteTime` 全部保持原值 |
| 不执行可能修改 lockfile 的 `npm install` | ✅ 未执行；已静态验证 `package-lock.json` 与 `package.json` 一致 |
| 不升级依赖 | ✅ 未执行任何升级 |
| 最终只输出分析报告 | ✅ 本文件 |

**产出物**：本报告文件 `docs/AUDIT-workspace-feasibility-2026-09-21.md`（新增文档，未触碰任何源码）。

## 附录 B：关键文件速查表

| 想了解 | 看这个 |
| --- | --- |
| 数据存在哪 | `electron/main.cjs:14-34`（`configRoot`/`dataRoot`） |
| JSON 怎么读写 | `electron/store.cjs:34-60`（`DataStore.read/write`） |
| IPC 怎么注册 | `electron/main.cjs:48-57`（`safeHandle`）+ `:531-1167`（`registerIpc`） |
| 渲染层能用什么 | `electron/preload.cjs:20-160`（白名单 API） |
| 页面怎么切换 | `src/renderer/src/App.vue:38,51-63`（`activeView` + `viewMap`） |
| 左侧菜单在哪 | `src/renderer/src/components/Sidebar.vue:85-95`（`baseNavItems`） |
| 工作流执行逻辑 | `electron/services/launcher.cjs:51-73`（`runWorkflow`，**全部能力就这 23 行**） |
| 快捷应用与图标 | `electron/services/apps.cjs:81-110`（`makeAppEntry`）、`:39-73`（`resolveLnkTargets`） |
| AI 网页入口 | `src/renderer/src/views/ChatView.vue:40-52`（就一个 `<webview>`） |
| 四象限算法 | `src/renderer/src/utils/quadrant.js:8-27` |
| 农历/节日 | `src/renderer/src/utils/lunar.js`（**无节气实现**） |
| 目标周期同步 | `electron/main.cjs:228-313`（`syncGoalRecurringTasks`，**改动 Workspace 时最危险的地方**） |
| 备份导出/导入 | `electron/services/backup.cjs`（**`importBackup` 有 P0 路径穿越**） |
| 项目设计文档（原作者的意图） | `docs/superpowers/specs/2026-08-13-workbench-design.md`（**:10 明确排除 vue-router**） |

---

*报告结束。本次审计未修改任何源码、数据或配置。所有结论均附真实文件路径、函数名与行号依据；所有推测均已明确标注。*
