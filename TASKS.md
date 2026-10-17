# DSH Glass — 实施任务清单

说明：以下均为**待执行任务**，勾选需附证据（测试、截图、日志或提交链接），不能仅凭实现意图标记完成。状态 `BLOCKED` 须写明原因。

## M0 — 环境与可行性探测（P0）
- [ ] M0-01 收集 OS、Electron/Node/pnpm、DSH CLI/Desktop 版本及安装方式。
- [ ] M0-02 阅读目标 DSH 版本官方源码：`session/event`、`approval/request`、`user-questions/request`、`todo/write`。
- [ ] M0-03 验证 Web Profile 以正常插件形式启动，输出真实 Session 事件。
- [ ] M0-04 验证 Desktop Profile 是否可以安全安装启用 Bridge 插件（无修改已签名资源）。
- [ ] M0-05 审批 answerer 所有权探测：官方 Desktop UI 与 Glass 如何保证仅一个回答者；失败则确认观测模式可用。
- [ ] M0-06 记录支持矩阵和接口快照，明确第一版目标构建方式。

## M1 — 可测试的基础设施（P0）
- [ ] M1-01 pnpm monorepo + workspace 脚本 + TypeScript strict。
- [ ] M1-02 `packages/protocol`：Schema、解析验证、类型与协议版本。
- [ ] M1-03 `packages/adapters/mock`：确定性 Mock 事件流、延迟/乱序/断线测试模式。
- [ ] M1-04 `packages/bridge`：单实例本机 Transport、鉴权、连接生命周期。
- [ ] M1-05 Session Store：快照、增量、顺序与跨会话隔离。
- [ ] M1-06 单测：重复消息、旧 epoch、错误 payload、Todo 整表替换。

## M2 — 桌面窗口和自适应 UI（P0）
- [ ] M2-01 Electron 主进程：单实例、托盘、关闭行为、窗口尺寸记忆。
- [ ] M2-02 Preload 白名单 IPC（禁止在 renderer 开 Node）。
- [ ] M2-03 可拖拽、可调整尺寸、磁性吸附、跨屏恢复。
- [ ] M2-04 胶囊/紧凑/工作台布局与高度不足时滚动降级。
- [ ] M2-05 状态 UI：未连接/运行/等待/完成/失败、无 Todo 和多个 in_progress。
- [ ] M2-06 玻璃主题（原生材质优先，CSS 降级）与减少动画选项。
- [ ] M2-07 快捷键和置顶开关可用，避免覆盖全屏应用。

## M3 — DSH 观察模式（P0）
- [ ] M3-01 构建 Cordis DSH Adapter 插件，能被目标 Profile 加载。
- [ ] M3-02 监听或通过受支持 API 获取持久会话事件。
- [ ] M3-03 `todo/write` 完整快照投影，sessionId 隔离。
- [ ] M3-04 关联 `tool/call` 与结果，输出脱敏摘要；未验证的内容标记缺失。
- [ ] M3-05 获取真实状态和重连快照；模型思考中与未知状态不伪装成准确进度。
- [ ] M3-06 不启动 DSH 主窗口时的稳定性/生命周期测试。

## M4 — 人工交互闭环（P0/P1，**取决于 M0-05 是否通过**）
- [ ] M4-01 验证审批 answerer 所有权与请求生命周期，形成 ADR。
- [ ] M4-02 审批请求显示 toolName/callId/原始命令摘要；完整参数缺失时限制危险批准。
- [ ] M4-03 单次允许/拒绝；等待真实决议确认后改变 UI。
- [ ] M4-04 处理 cancelled/unavailable、断线、重复点击、过期、并发。
- [ ] M4-05 用户问题（结构化选项/文本）验证与回答闭环。
- [ ] M4-06 多 Session 多请求路由隔离测试。

## M5 — 质量、打包与发布（P1）
- [ ] M5-01 Windows 11 22H2+、DPI 100/125/150/200% 检查。
- [ ] M5-02 多屏/休眠唤醒/异常重启/重复启动检查。
- [ ] M5-03 性能基线 + 禁用 Shader 降级策略。
- [ ] M5-04 用户配置、开机启动（默认关闭）、卸载清理。
- [ ] M5-05 构建未签名本地测试安装包，明确 Windows 安全提示。
- [ ] M5-06 用户使用文档、已知限制、安全说明、日志脱敏审核。

## 后续扩展（P2）
- [ ] 多 Agent 统一抽象与插件接口。
- [ ] 完整事件时间线搜索与筛选。
- [ ] 高级实时边缘光学效果。
- [ ] macOS/Linux 技术评估。
