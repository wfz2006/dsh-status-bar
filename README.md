# DSH Glass — Codex-ready 开发规格包

> 版本：v1.0 | 文档日期：2026-10-17 | 目标平台：Windows 11 优先 | 目标产品：DeepSeek Harness (`dsh`) 桌面悬浮伴侣

**一句话定义**：以液态玻璃为视觉语言、可自由移动与伸缩的桌面窗口，让用户查看 DSH 会话任务、Todo、工具活动，并在已验证的授权通道中直接处理审批和结构化提问，无需切回 DSH 主窗口。

原始输入是开发规格包。2026-10-17 已实现首轮 **Mock 开发预览**（协议、鉴权桥、Electron 自适应窗口），并完成独立 DSH Web 插件探测。**尚未连接官方 Desktop 的当前任务，真实审批不可用**。后续轮次补上跨进程认证适配器（官方 Host 认证链接 → 本机 JSON-RPC + `remote.mux` WS），以 Fake Host 合同测试验证；2026-10-18 又在**真实官方 Host**（隔离 DSH_HOME + 只读探测插件）上完成实装联调：Electron 经设置面板认证 303+Set-Cookie、`session/list`、`remote.mux` 会话/Todo 同步、断线清空与错误 token 拒绝，`pnpm test:live` 可复现。官方 Desktop 的当前任务与真实审批仍未联通。运行方式见 [RUNNING.md](docs/RUNNING.md)，实测范围见 [支持矩阵](docs/integration-matrix.md)。原始完整规格保留在下文及 MASTER_SPEC。

2026-10-17 按 [Liquid UI 重设计规范](DSH_Glass_Liquid_UI_Redesign_Spec.md) 完成四形态 UI 重构：任务胶囊、速览、紧凑详情与独立审批，移除常驻品牌/连接底栏，功能迁至菜单/设置；新增偏好持久化、自动行为与手动尺寸保护。实际验证与尚未覆盖项见 [分阶段记录](docs/redesign-audit.md)。

同日按 UI Improvement Pack 做一轮集中整改：去除正常任务子卡片、默认薄透、审批固定操作栏、内容先退场再收起。真实桌面截图/录屏、材质矩阵、性能记录及尚待用户评价的Gate A见 [验收包](reports/electron-redesign/decision.md)；未擅自迁移技术栈。

最新状态：已删除整面蓝灰染色和字体白边/阴影，加实字重。旧材质验收失败后完成 Tauri 原生对照；在用户明确授权后，新增**默认关闭的限定区域取样**，让同源透镜实际处理窗后画面。真实原生条纹输入已验证13物理像素偏折及RGB分离，隐藏/停用/实色/异常退出回归通过；见 [真实折射验收](reports/desktop-optics/README.md)。正式入口仍为 Electron。10-17 晚追加跨进程 DSH 适配器与 10 项合同测试；10-18 在真实官方 Host（隔离 DSH_HOME）上完成 Electron 实装联调：认证 303/Cookie、`session/list`、`remote.mux` 会话/Todo 同步、断线清空、错误 token 拒绝，`pnpm test:live` 可复现，证据见 `docs/evidence/live-dsh/`。真实 Desktop 审批仍 BLOCKED，见 [ADR 004](docs/adr/004-authenticated-host.md)。

## 推荐阅读顺序

最新运行版本已落地用户确认的统一视觉方向：清透玻璃、黑白内容、单冷蓝强调、状态色按需，任务/审批/设置共享一套层次。见 [本轮实际样张](reports/refined-ui/README.md)。

内部色块已按后续反馈改为薄透彩色玻璃，保留实色文字与功能色。真实条纹穿透按钮的对照见 [晶透控件验收](reports/crystal-controls/README.md)。

最新截图反馈修订：去掉装饰短横条与独立蓝色角落按钮，改为内缩透明操作组和SVG详情展开行；旧Acrylic对照因系统方角已停用并迁回薄透。设计参考与原生角像素证据见 [三处细节重设计](reports/chrome-redesign/README.md)。

本轮补充：修复150% DPI拖动尺寸持续增长，改为原生只移动；窗口内亮边微增至1.5px，控件/命令使用更鲜明的局部色底，文字按功能区分蓝/紫/绿/红/琥珀，主标题与普通正文保持实色，提供可见收起/菜单。实测边界见 [移动尺寸](reports/move-size/README.md) 与 [可读性样张](reports/ui-clarity/README.md)。

1. [AGENTS.md](AGENTS.md)：Codex 必须遵守的工程规则。
2. [docs/00_PRODUCT_PRD.md](docs/00_PRODUCT_PRD.md)：产品边界、用户场景和验收条件。
3. [docs/01_ARCHITECTURE.md](docs/01_ARCHITECTURE.md)：总体架构、组件边界和交互控制方案。
4. [docs/02_PROTOCOL.md](docs/02_PROTOCOL.md)：本项目**自定义**本地协议与数据类型。
5. [docs/03_UX_DESIGN.md](docs/03_UX_DESIGN.md)：交互状态、尺寸断点、设计系统。
6. [docs/04_DSH_INTEGRATION.md](docs/04_DSH_INTEGRATION.md)：官方已验证接口、可行性实验与待确认项。
7. [docs/05_SECURITY_TESTING.md](docs/05_SECURITY_TESTING.md)：威胁模型、测试矩阵和验收标准。
8. [docs/06_EXECUTION_PLAN.md](docs/06_EXECUTION_PLAN.md)：里程碑、先后关系、停工条件。
9. [docs/07_DECISIONS.md](docs/07_DECISIONS.md)：架构决策记录。
10. [docs/08_STATE_MODEL.md](docs/08_STATE_MODEL.md)：会话投影、状态机、乱序处理。
11. [docs/09_SOURCES.md](docs/09_SOURCES.md)：官方源地址、已确认事实与易变点。
12. [TASKS.md](TASKS.md)：Codex 实施清单。
13. [PROMPT_FOR_CODEX.md](PROMPT_FOR_CODEX.md)：新 Codex 会话的启动提示词。

## 范围约束

- 第一版主要服务 **Windows 11 x64**；macOS/Linux 暂不承诺。
- **不替代 DSH 本体**：不写代理模型、会话引擎、工具运行器。
- **观察先行，审批最后接入**：DSH Desktop 的交互所有权必须先验证。
- **不默认能接管 Desktop 审批**：`approval/request` 是 waterfall，不是广播。
- **不做未经证实的自动审批**；任何批准都需明确的人类点击。
- **无障碍与性能优先**：动态折射 Shader 为可选增强，不作为 MVP 阻塞项。

## 优先级说明

`P0` 必须实现：插件加载、会话观察、Todo、窗口拖拽缩放、自适应密度、连接/故障显示、真实审批可行性验证。

`P1`：真正的审批闭环（仅在 M1 通过后）、结构化提问、通知、跨屏/窗口恢复、多会话切换。

`P2`：动态边缘折射、主题市场、时间线高级搜索、跨平台支持。

## 启动方式（给 Codex）

在空项目目录放置全部文件，然后在 Codex 中打开此目录，粘贴 [PROMPT_FOR_CODEX.md](PROMPT_FOR_CODEX.md) 中的首轮指令。**先执行 M0（环境与 DSH 接口核验），不要第一步直接写审批桥。**

建议初始技术栈：pnpm workspace、TypeScript strict、Electron、electron-vite、React、Tailwind、Zustand、Zod、Vitest、Playwright（桌面 E2E 实测视环境而定）。具体版本锁定到实际兼容版本后写入锁文件，避免套用未经验证的模板版本。

## 验收的最终定义

1. DSH 主窗口不在前台时，Glass 仍能展示实际任务状态。
2. Todo 更新及时且恢复连接后不会回退到旧状态。
3. 悬浮窗按空间重排信息，安全操作始终可访问。
4. 已验证授权模式下，允许/拒绝可反馈真实的 DSH 决策；失联、过期、撤销请求绝不自动放行。
5. Windows DPI、显示器切换、休眠唤醒、关闭恢复、重复启动下稳定运行。

见 [验收测试](docs/05_SECURITY_TESTING.md) 与 [执行路线](docs/06_EXECUTION_PLAN.md)。
