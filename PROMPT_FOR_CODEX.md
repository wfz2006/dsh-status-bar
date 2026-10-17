# 给 Codex 的首轮开发指令（直接复制下文）

你现在负责实现 DSH Glass —— 一个 Windows 11 上的 DeepSeek Harness 液态玻璃悬浮伴侣。此目录含完整产品与技术规格。请先完整阅读 README.md、AGENTS.md、TASKS.md、docs/04_DSH_INTEGRATION.md、docs/06_EXECUTION_PLAN.md、docs/09_SOURCES.md。

**本轮只执行 M0 + M1 的第一个最小可交付闭环**，具体如下：

1. 检查当前工作目录和开发环境，包括 OS、Node、pnpm、DSH CLI/官方 Desktop 是否安装、版本，以及能否找到其公开接口/源码。不要修改官方 DSH 安装本身。
2. 根据文档初始化 pnpm TypeScript Monorepo，包含 apps/desktop、packages/protocol、packages/bridge、packages/adapters/mock、packages/adapters/dsh 等目录。建立 lint/typecheck/test 脚本与 strict tsconfig。
3. 实现一个可启动的 Mock Adapter，通过自定义协议提供连接状态、会话、完整 Todo 快照、工具事件和模拟审批请求。Mock 数据必须显著标注 Mock，不得与真实 DSH 数据混淆。
4. 实现 Windows Electron 悬浮窗的最小端到端闭环：无边框、可拖动、可调整大小、3 个信息密度断点、Zustand Store、连接断开提示、基本玻璃材质降级。
5. 探测官方 DSH 的 `session/event` 和 `approval/request` 真正可用的接入方式，记录证据，不要在未验证所有权前注册抢占式审批 answerer。
6. 给核心协议与 Todo 投影写测试（完整快照覆盖、按 Session 分开、断线失效）。最后运行全部可用检查并填写 TASKS.md。

请使用小步提交式工作流：每一步给出文件变更和测试结果；若无法连接真实 DSH，继续完成 Mock UI，但将真实集成标记为 BLOCKED。不要基于猜想创造 DSH 原生 API。遇到已验证的官方 API 变化请更新文档。最终输出“已完成 / 未完成 / 风险 / 下一步”的工作总结。
