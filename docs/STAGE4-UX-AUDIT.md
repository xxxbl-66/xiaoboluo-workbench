# Stage 4 UX Audit

基准：`feature/workbench-polish-stage3` / `03ef79f`；开发前 236/236 测试通过。审查对象为当前 Vue 页面、共享样式和 Electron 数据边界。

## 产品职责与主流程

1. 主流程：从 Dashboard 找到最近项目与下一步，进入 Workspace，继续并自动开启 Session，按需恢复 Workflow 环境，编辑资料和任务，结束 Session 留下下一步，随后在 Resume/History 中回看。
2. Dashboard 应只回答“现在做什么”：active 工作、最近工作的下一步、今日任务及轻量入口。现状同时摆放欢迎统计、快捷应用、待办、最近项目、便签、计时器、全部工作流，入口权重相同。
3. Workspace 是项目上下文：工作状态、上次进度、任务、资料、环境预设和历史。现状七个纵向区域与资源 tab 重复展示 Todo/Goal，用户需要滚动很久。
4. Session 是一次工作记录和计时；Workflow 是打开环境的预设。现状 SessionPanel 的“开始工作”、ResumeCard 的“继续上次工作”、Workflow 的“运行”同时突出，且“继续”后执行中的 Workflow 不阻止结束 Session。
5. 当前 active Session 在 Workspace 卡片可见，但在 Dashboard/侧栏不显著；上次完成与下一步在 ResumeCard 同级，下一步不够醒目。列表里的“继续”只进入项目，却暗示已开始 Session。

## 交互与状态问题

6. Workspace Header 仅放编辑和归档，主 CTA 在下方 SessionPanel/ResumeCard 重复出现；应按 active / 有历史 / 首次 / 归档确定唯一主动作。归档操作降级到次要位置。
7. Workspace Note 另开 Modal、Markdown 编辑/预览；NotesPanel 就地编辑、自动保存，两者反馈不一致。资源编辑 Modal 多但本轮以共享视觉及准确保存反馈改善，不重写编辑系统。
8. `saveNoteRecord` 不检查 update 的 null，Workspace 会关闭编辑器并报成功；NotesPanel 也可能读取 null.id。表单错误目前大多 Toast，输入未必就近显示。
9. Resume/History 直接信任 snapshots 数组项，null 或 primitive 在渲染时可异常；应在读出边界过滤，无有效快照时回退 ID。
10. Favorite 新建按 path+workspaceId 去重，资源关联移动却不检查目标重复；应在写盘前拒绝且保持两条原记录。
11. Workflow 结果关闭时直接设为 null，无法重看；恢复结果和手动运行结果分开管理，切项目时要清空旧结果。
12. History 加载失败仍显示空态；Resources 加载失败 Toast 后也显示空态。搜索无结果与真正无资源已有区分，但空态缺少就近下一步按钮。
13. Dashboard 的最近列表加载失败被当成空列表；某些设置/小组件持久化失败静默。Success Toast 必须在真实成功后显示；表单错误优先就近，系统异常用 Toast/错误条，避免重复提示。
14. Workflow 编辑器本质是紧凑步骤表，现有结构可保留，但列表只显示步骤数量，没有内容摘要；运行结果需仅展开失败步骤，保留重看入口。
15. End Session Modal 的任务清单、摘要、备注、下一步都常驻；在任务多时压过真正要填写的内容，应该压缩摘要并限制清单高度。

## 视觉与演示风险

16. CSS 有两套全局 token 定义，后半段覆盖前半段；组件又有各自尺寸，主次按钮、焦点、disabled、空态不完全一致。基准视觉偏 20px 大圆角、多个白卡，桌面信息密度不稳定。
17. 侧栏是平铺十项和打卡卡片，工作空间没有工作中标识；布局在低高度窗口可能迫使关键操作滚动。部分编辑器与结果列表的宽度也需限制。
18. Todo/Bookmarks 的英文装饰标签和自定义卡片体系最有原型感；Dashboard Welcome 的问候、书架数量、连续打卡挤占主流程；Review 与 Settings 已有合理分组，只需统一层级和风险区。
19. 比赛演示最大断点：Dashboard 看不到下一步；“继续”语义不准；运行中可以结束；结果关后丢失；Note 假成功；History 坏快照崩溃。这些属于产品状态与数据边界问题，CSS 无法解决。

## 本轮设计规则

- 一级认知：Dashboard 看今日与当前；Workspace 管项目连续工作；Todo/资料/Calendar/Review 是日常模块；Settings 管配置。
- Workspace 一处明显主 CTA：工作中显示状态及结束；有历史则继续；首次则开始；归档则提示恢复。Workflow 始终是次级环境操作。
- 在数据边界判定成功与失败；UI 的 loading/error/empty/search-empty 分开。最近一次 Workflow 结果保留在当前界面内直至覆盖或切 Workspace。
- 复用现有 CSS，统一 token、按钮/输入/卡片/Modal/Toast，采用克制的 Windows 桌面工具样式；适配 1280×720、1366×768、1920×1080。
