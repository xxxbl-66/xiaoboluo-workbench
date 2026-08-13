# 小菠萝的工作台

一个使用 Electron + Vue3 开发的 Windows 本地个人工作台。完全离线运行，不登录账号，不依赖后台服务器；所有用户数据保存在 Windows 文档目录下的独立文件夹，程序更新不会丢失数据。

## 功能

- 驾驶舱：快捷应用、桌面应用扫描、今日待办、工作流、本地建议。
- 待办：长期目标进度、每日任务、优先级、截止时间、完成筛选、统计。
- 日历：类苹果日历，聚合日程、待办截止日和休息日/节假日。
- 今日复盘：待办完成度、阅读/专注时长，以及三个复盘问题。
- 收藏夹：响应式卡片收藏文章、推文、视频和想法链接。
- 我的书架：添加本地书籍，内置在线书城并可将下载内容归入书架。
- 个性化：自定义头像和昵称，左侧导航可拖拽排序。
- 文件：本地文件浏览、文件收藏、图片画廊、Markdown 便签。
- 对话：工作台内嵌豆包 / DeepSeek / GPT 网页，默认不联网，进入并选择服务后才加载。
- 设置：外观、开机自启、数据目录、备份导入导出、扩展功能开关。

## 数据目录

`C:\Users\<你的用户名>\Documents\小菠萝的工作台`

- `data/`：所有 JSON 数据。
- `thumbs/apps/`：应用图标缓存。
- `thumbs/images/`：图片缩略图缓存。
- `backups/`：本地配置备份。
- `logs/`：本地日志。

## 环境要求

- Windows 10/11
- Node.js 18 或更高版本
- npm 10 或更高版本

## 安装依赖

```powershell
cd C:\Users\86185\Desktop\工作台
npm install
```

如果公司网络或代理导致 Electron 二进制下载失败，可先使用以下命令只安装依赖并跳过 Electron 下载，随后再在正常网络下重新执行 `npm install`：

```powershell
$env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'
npm install
```

## 双击启动

在项目根目录双击 启动工作台.bat，脚本会检查依赖并自动启动。

## 启动开发模式

```powershell
npm run dev
```

开发模式会同时启动 Vite 和 Electron，修改渲染层代码后会自动热更新。

## 构建渲染层

```powershell
npm run build
```

## 运行已构建版本

```powershell
npm start
```

## 打包 Windows exe

```powershell
npm run dist
```

输出目录为 `release/`，会生成 NSIS 安装包和便携版 exe。如果只想生成未安装的目录用于测试：

```powershell
npm run dist:dir
```

## 离线与网络说明

- 工作台本体不主动联网。
- 文件、图片只保存原始路径，不复制大文件；图片仅缓存小尺寸缩略图。
- 对话页的豆包 / DeepSeek / GPT 网页在用户主动选择服务后由内嵌 webview 加载。
- GPT 当前仅预留接口，默认关闭。
- 天气、云端备份等扩展接口默认关闭，关闭时不会发起任何网络请求。

## 项目结构

```text
electron/                 主进程与安全 IPC
  main.cjs
  preload.cjs
  store.cjs
  defaults.cjs
  services/               应用、文件、启动、备份等原生能力
scripts/dev.mjs           开发模式启动脚本
src/renderer/             Vue3 渲染层
  index.html
  src/main.js
  src/App.vue
  src/views/
  src/components/
  src/assets/styles.css
docs/                     设计与实现文档
```
