# DSH Glass — 实施任务清单

说明：以下均为**待执行任务**，勾选需附证据（测试、截图、日志或提交链接），不能仅凭实现意图标记完成。状态 `BLOCKED` 须写明原因。

## M0 — 环境与可行性探测（P0）
- [x] M0-01 收集 OS、Electron/Node/pnpm、DSH CLI/Desktop 版本及安装方式。证据：docs/integration-matrix.md；官方 bundled CLI `--version`=0.2.0-rc.2。
- [x] M0-02 阅读目标 DSH 版本官方源码：`session/event`、`approval/request`、`user-questions/request`、`todo/write`。证据：安装包 JS 摘录/哈希及公开源码快照，见 docs/local-source-signatures.md；安装包不含声明文件。
- [x] M0-03 验证 Web Profile 以正常插件形式启动，输出真实 Session 事件。证据：docs/evidence/dsh-web-probe.txt，隔离 Profile 人工夹具写入 Todo 3→2，非模型任务；插件热卸载待补测。
- [ ] M0-04 验证 Desktop Profile 是否可以安全安装启用 Bridge 插件（无修改已签名资源）。BLOCKED：尚未通过 Desktop 官方插件 UI 在隔离环境验证；本轮未修改安装/Profile。
- [ ] M0-05 审批 answerer 所有权探测：官方 Desktop UI 与 Glass 如何保证仅一个回答者；失败则确认观测模式可用。BLOCKED：静态确认 waterfall，不足以证明 Desktop 委派/owner；Glass 的真实观察模式也未验收。
- [x] M0-06 记录支持矩阵和接口快照，明确第一版目标构建方式。证据：docs/integration-matrix.md；首轮仅 Mock Preview。

## M1 — 可测试的基础设施（P0）
- [x] M1-01 pnpm monorepo + workspace 脚本 + TypeScript strict。证据：pnpm lint/typecheck/test/build 通过，锁文件已生成。
- [x] M1-02 `packages/protocol`：Schema、解析验证、类型与协议版本。首轮只读子集，精确范围见 docs/02_PROTOCOL.md §9；应答命令未实现且拒绝。
- [x] M1-03 `packages/adapters/mock`：确定性 Mock 事件流、延迟/乱序/断线测试模式。证据：tests/mock.test.ts + Electron 桌面断线/重连。
- [x] M1-04 `packages/bridge`：单实例本机 Transport、鉴权、连接生命周期。证据：tests/bridge.test.ts；Origin/token/并发客户端/大小/速率/握手顺序；跨进程发现待真实适配阶段。
- [x] M1-05 Session Store：快照、增量、顺序与跨会话隔离。证据：tests/projection.test.ts + Electron 会话切换和重连最新快照。
- [x] M1-06 单测：重复消息、旧 epoch、错误 payload、Todo 整表替换。证据：pnpm test；含空 Todo、并行 Todo、原型键、迟到快照回归。

## M2 — 桌面窗口和自适应 UI（P0）
2026-10-17 用户指定Edge项目材质：移植同源SDF/RGB引擎与最终operation渐变/边缘，生命周期清理与solid降级通过；31单测、类型/构建、固定footer和完整Electron回归通过。原生截图/像素边界见 `reports/edge-material-port/README.md`，不声称跨应用真实折射。
2026-10-17 UI Improvement Pack：E0–E4 单次集中整改与E5证据已实现；去子卡片、默认薄透、固定审批footer、长命令/队列切换、退场时序。29单测、功能/偏好/审批布局/应用scale/native录屏测试通过；Gate A仍待用户视觉评分及系统矩阵，见 `reports/electron-redesign/decision.md`，不将其标为整体验收通过。
2026-10-17 Liquid UI v1 新版：四形态、菜单迁移、珍珠冰蓝材质、可选自动行为与持久化手动尺寸。28 项单测与实际 Electron/双次启动回归通过；分阶段证据及真实 DSH、全 DPI/多屏未验收项见 `docs/redesign-audit.md`。以下早期记录保留为历史，不替代新版验收。
2026-10-17 视觉修订：透明 Acrylic/清透/实色三档、移除系统与页面双框、420ms 原生形变（减少动画立即切换）、340×300 紧凑默认布局、审批/活动设置收起。证据：`docs/evidence/liquid/acceptance.json` 及原生合成截图；物理桌面像素折射未实现。单元测试现为 21 项。
- [ ] M2-01 Electron 主进程：单实例、托盘、关闭行为、窗口尺寸记忆。已实现最小版本；跨重启展开尺寸/位置偏好与原生托盘操作尚待完整验收。
- [x] M2-02 Preload 白名单 IPC（禁止在 renderer 开 Node）。证据：Playwright Electron 验证 sandbox/contextIsolation/nodeIntegration 与窄 API，无 token。
- [ ] M2-03 可拖拽、可调整尺寸、磁性吸附、跨屏恢复。
- [x] M2-04 胶囊/紧凑/工作台布局与高度不足时滚动降级。证据：docs/evidence/size-*.png；180×54、280×140、340×280、520×90、520×620 DIP。
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
