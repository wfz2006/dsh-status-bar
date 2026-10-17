# 07 — 架构决策记录（ADR）

## ADR-001：独立 Electron Companion + DSH Adapter

**状态**：决定，仍需本地验证。

**背景**：DSH Desktop 自身包含 Electron，但修改上游代码带来签名、更新、兼容性风险。

**决策**：Glass 作为独立 Electron 程序，Adapter 作为受支持的 Cordis 插件存在于目标 DSH Runtime，双方通过受认证的 loopback 通道通信。

**结果**：单独发布 Glass 比直接改官方 Desktop 更易维护；代价是本机 IPC、生命周期与插件安装需要额外开发。

**备选**：直接 Fork 上游 Desktop（维护成本大）；直接调用内部私有 Host 协议（随版本变化高风险）；屏幕/OCR 识别（不满足准确审批）。

## ADR-002：观察/控制能力隔离

**状态**：确定。

**背景**：`approval/request` 是 waterfall，可能已有官方 UI answerer。

**决策**：观察模式独立存在，`respondApproval=false` 为默认。只有目标 DSH 版本的所有权验证通过后，开放控制模式。界面能力以 Bridge `capabilities` 为准。

**结果**：某些 Desktop 版本可能只能展示审批提醒、不能回答，但不会冒险重复授权。

## ADR-003：Todo 完整替换、每 Session 单独保存

**状态**：确定（DSH 官方语义）。

**背景**：`todo/write` 不提供稳定 itemId，携带整个列表。

**决策**：投影层按 `(runtimeId, sessionId)` 保留最后一次 Todo 快照，替换整个数组。不允许对 Todo 项基于文字生成跨快照稳定 ID 并误导用户。

**结果**：动画可使用临时位置键，但不能把临时 key 当作业务身份。

## ADR-004：审批操作默认无自动重试

**状态**：确定。

**背景**：允许一次是真实工具执行安全边界。

**决策**：所有审批命令需明确交互；客户端断线、超时、切换 epoch 不允许重发允许指令。服务端对 `clientCommandId` 去重；未知时显示未确认。

**结果**：在网络异常中可能要求用户回到 DSH 核实，但比重复允许安全。

## ADR-005：视效渐进增强

**状态**：确定。

**背景**：Windows 原生 Acrylic 与透明窗口组合受系统和 Electron 行为影响。

**决策**：系统背板优先，失败降级 CSS/静态背景。动态折射不作为 MVP 必需能力，尽量保留减少动画选项。

## ADR-006：协议自有版本化

**状态**：确定。

**背景**：DSH preview 内部 API 可能频繁变更。

**决策**：Bridge 与 UI 使用独立 protocolVersion，并在 DSHAdapter 内完成转换。协议不向 renderer 泄露 DSH Agent 引用或未知类型。

## ADR-007：先 Web Profile 探测，再 Desktop

**状态**：决定，需根据用户安装环境调整。

**背景**：官方 Desktop 是专用 Profile，CLI 不直接管理它。

**决策**：优先在可复现的官方源码/Web Profile 插件运行环境验证事件和协议，然后走 Desktop 自己的插件管理能力。禁止直接篡改 Desktop profile 和打包资源。
