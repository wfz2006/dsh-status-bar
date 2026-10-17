# DSH Glass — Codex-ready 开发规格包

> 版本：v1.0 | 文档日期：2026-10-17 | 目标平台：Windows 11 优先 | 目标产品：DeepSeek Harness (`dsh`) 桌面悬浮伴侣

**一句话定义**：以液态玻璃为视觉语言、可自由移动与伸缩的桌面窗口，让用户查看 DSH 会话任务、Todo、工具活动，并在已验证的授权通道中直接处理审批和结构化提问，无需切回 DSH 主窗口。

原始输入是开发规格包。2026-10-17 已实现首轮 **Mock 开发预览**（协议、鉴权桥、Electron 自适应窗口），并完成独立 DSH Web 插件探测。**尚未连接官方 Desktop 的当前任务，真实审批不可用**。运行方式见 [RUNNING.md](docs/RUNNING.md)，实测范围见 [支持矩阵](docs/integration-matrix.md)。原始完整规格保留在下文及 MASTER_SPEC。

## 推荐阅读顺序

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
