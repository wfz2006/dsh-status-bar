# DSH Glass — 实施任务清单

说明：以下均为**待执行任务**，勾选需附证据（测试、截图、日志或提交链接），不能仅凭实现意图标记完成。状态 `BLOCKED` 须写明原因。

## M0 — 环境与可行性探测（P0）
- [x] M0-01 收集 OS、Electron/Node/pnpm、DSH CLI/Desktop 版本及安装方式。证据：docs/integration-matrix.md；bundled `dsh.cmd --version`=0.2.0-rc.2，app.asar 内 `dsh-desktop-host` CLI `--version`=0.2.1-rc.2（2026-10-18 实装联调复测，两处版本号不一致，安装包文件属性未复核）。
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
- [x] M2-08 广域内容拖动与移动中实时背景：移除10px原生拖动限制；保留按钮/输入/命令选择；取样按当前世界坐标重投影并裁剪，缺覆盖时隐藏旧纹理。实际按住鼠标移动36/120 DIP过程中持续收到不同位置与不同像素的帧，无选择/误展开；证据 `reports/drag-optics/`，33单测通过。
2026-10-17 后续授权与实装：用户明确允许限定区域取样后，实现仅本HWND/PID+最多48物理像素边距的本地输入，默认关闭、隐藏暂停、实色/Acrylic/错误立即停用；不保存不上传。真实原生条纹输入的偏折最大13物理px、RGB分离1276px（零位移0）；32单测和实际光学/生命周期回归通过。`reports/desktop-optics/README.md` 为最新证据，DSH真实接入仍BLOCKED。
2026-10-17 用户明确拒绝材质移植：Gate A失败。已删除全表面蓝灰染色、文字白边/阴影并加实字重；清透样式回归通过。Gate B独立Tauri 2 Release探针已编译运行；透明/Acrylic原生截图完成，HostBackdropBrush位移被Windows以“Backdrop brushes cannot be transformed”拒绝。桌面折射/色散仍未完成，未迁移正式入口。见 `reports/native-compositor/README.md`。
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

- [x] M2-09 当前 150% DPI 连续移动不增长、拖动实时输入与可读性修订。证据：`reports/move-size/` 四形态各80次，`reports/drag-optics/` 按住鼠标每步viewport固定，`reports/ui-clarity/` 亮暗三形态、纯黑文字/浅亮控件/1px亮边。全DPI矩阵与用户视觉验收仍待完成。

- [x] M2-10 根据用户后续反馈细化配色：1.5px内亮边，按钮/文本框更鲜明更实，按操作/进度/命令/提示/决策功能区分文字色。证据：`reports/ui-clarity/` 亮暗三形态复测与当前样张；正文保持清晰实色，审批机制不变。

- [x] M2-11 按圈图重做窗口操作/详情入口：去装饰拖动横条，内缩SVG操作组与标题避让，自定义折叠行；实机确认Acrylic方角后停用对照选项、迁移旧偏好。证据：`reports/chrome-redesign/` 原生四角背景像素一致、键盘折叠与受控亮暗样张；35单测通过。用户视觉评价仍待完成。

- [x] M2-12 将内部实色块改为薄透彩色玻璃：局部高光/亮边/柔化、实色文字，易读档保留衬底；原生条纹晶透与实色对照证明背景透过按钮，见`reports/crystal-controls/`。35单测与亮暗三形态回归通过。

- [x] M2-13 按“去灰蒙、透明透亮”反馈取消控件模糊、默认雾底与外阴影，高光收至3px边缘；真实条纹对照验证清晰边缘与更高透光对比，见`reports/crystal-controls/`，旧磨砂样张保留。

- [x] M2-14 按用户批准的Raycast布局/Linear层级方向落地统一视觉：黑白中性正文、单冷蓝强调、状态色按需，命令区少框、设置分组与开关；证据`reports/refined-ui/`亮暗8张实运行样张、窄审批回归，35单测。真实DSH与用户审美验收仍待完成。

- [x] M2-15 按用户要求加入5%中性黑材质底色，文字/亮边不随之变暗、不加模糊；原生灰色输入开启/关闭对照验证约95%亮度保留，见`reports/smoked-glass/`。

- [x] M2-16 按用户反馈将黑底5%微调至8%，统一悬停/按下/键盘焦点反馈，拖动表面无几何变化、禁用审批不伪装可用，减少动画覆盖开关伪元素。证据`reports/smoked-glass/`与`reports/interaction-feedback/`。

- [x] M2-17 胶囊圆角28→24并同步原生裁剪，黑底10%，内部图标/文字与箭头/开关采用快速按下和轻微回弹；完整动画拖动、减少动画、禁用审批和亮暗排版验证，36单测。证据`reports/motion-polish/`。

- [x] M2-18 用户可自定义玻璃底色、浓度和亮度，实时预览/本地保存/恢复默认；旧偏好兼容，自动文字配色考虑调色与亮度，取样开关独立。40单测、两次真实启动的偏好保存及真实输入的颜色/亮度/折射像素验收，见`reports/glass-appearance/`。

- [x] M2-19 审批外跳文字改为紧凑图标，允许/拒绝18%功能染色并增加明确的只读预览反馈；展开全程保留RGB色散、按实际尺寸合并更新，旧纹理仅在扩展时保留世界坐标交集。41单测与展开时序、亮暗按钮、窄审批/拖动回归，见`reports/approval-morph/`。审批仍不可提交。

- [x] M2-20 文字改用本机真实Segoe UI Variable Text/Noto Sans SC，标题Medium、胶囊14px、小字适当放大并提高次要文字对比；无描边/阴影，悬停文字保持稳定。胶囊20/大框22 DIP同步CSS和原生裁剪，41单测、CDP实际字体、亮暗8样张与窄审批/展开回归，见`reports/type-clarity/`。

- [x] M2-21 字体按角色搭配：标题Georgia/Noto Serif SC、正文Segoe Text/Noto Sans SC、小字Segoe Small、代码/数值Cascadia Mono；本机已有字体无新增安装。CDP核实实际字形，亮暗10样张与布局/窄审批回归，41单测，见`reports/type-clarity/editorial.md`。

## M3 — DSH 观察模式（P0）
- [ ] M3-01 构建 Cordis DSH Adapter 插件，能被目标 Profile 加载。
- [ ] M3-02 监听或通过受支持 API 获取持久会话事件。
- [ ] M3-03 `todo/write` 完整快照投影，sessionId 隔离。
- [ ] M3-04 关联 `tool/call` 与结果，输出脱敏摘要；未验证的内容标记缺失。
- [ ] M3-05 获取真实状态和重连快照；模型思考中与未知状态不伪装成准确进度。
- [ ] M3-06 不启动 DSH 主窗口时的稳定性/生命周期测试。
- [x] M3-07 认证跨进程适配器：`hostLink → 认证 HTTP RPC + remote.mux WS` 已实现；本机 Fake Host 合同测试 10 项覆盖握手、快照、网关事件、审批/提问流与断线（`tests/dsh-host-contract.test.ts`，2026-10-17）。2026-10-18 在真实官方 Host（隔离 DSH_HOME + 只读探测插件）上实装联调 PASS，见 `scripts/live-dsh-integration.mjs` 与 `docs/evidence/live-dsh/`；官方 Desktop 端到端未验收，如实仍按 BLOCKED 处理。

## M4 — 人工交互闭环（P0/P1，**取决于 M0-05 是否通过**）
- [ ] M4-01 验证审批 answerer 所有权与请求生命周期，形成 ADR。
- [ ] M4-02 审批请求显示 toolName/callId/原始命令摘要；完整参数缺失时限制危险批准。
- [ ] M4-03 单次允许/拒绝；等待真实决议确认后改变 UI。
- [ ] M4-04 处理 cancelled/unavailable、断线、重复点击、过期、并发。
- [ ] M4-05 用户问题（结构化选项/文本）验证与回答闭环。
- [ ] M4-06 多 Session 多请求路由隔离测试。
- [x] M4-07 应答通道：`approval.respond`/`question.respond` 经官方 `$events/result` 回写，仅在官方事件确认后收口；Main `request-gate` 校验身份/能力/参数完整性（Fake Host 合同测试覆盖）。
- [ ] M4-08 官方 Desktop 上验证 answerer 所有权与真实决议（M4-01 未完成前对外保持 BLOCKED）。
- [x] M4-09 真实官方 Host 实装联调（认证 + 会话/Todo 观察 + 断线清空 + 错误 token 拒绝）：`pnpm test:live`，隔离 DSH_HOME + 只读探测插件，2026-10-18 PASS；不替代官方 Desktop 与真实审批验收。证据：`scripts/live-dsh-integration.mjs`、`docs/evidence/live-dsh/`。

## M5 — 质量、打包与发布（P1）
- [ ] M5-01 Windows 11 22H2+、DPI 100/125/150/200% 检查。
- [ ] M5-02 多屏/休眠唤醒/异常重启/重复启动检查。
- [ ] M5-03 性能基线 + 禁用 Shader 降级策略。
- [ ] M5-04 用户配置、开机启动（默认关闭）、卸载清理。
- [ ] M5-05 构建未签名本地测试安装包，明确 Windows 安全提示。
- [ ] M5-06 用户使用文档、已知限制、安全说明、日志脱敏审核。
- [x] M5-07 本地 DSH bundle（`packages/dsh-plugin`）：`dsh.bundle.patch` + profile `link:` 依赖 + `dsh.profile.bundles` 挂载，隔离 Web Profile 启动实测打印 `[dsh-glass-plugin] loaded`（2026-10-18）；desktop profile 已同样接线。
- [x] M5-08 启动器钩子（2026-10-18）：Host 启动后插件用 `connection.authenticatedUrl(origin)` 取认证链接，`spawn` Glass 并传 `--dsh-link`；Glass 启动即自动连接，第二实例聚焦并重连。隔离 Host 实测 PASS（`node autolaunch-check.mjs`，脚本仓库外），认证链接不写日志。
- [x] M5-09 默认与外观收紧（2026-10-18）：默认始终置顶（设置版本 2 一次性迁移旧 normal）、启动即开真实折射与色散（原生助手可用且非实色材质）、完成态胶囊绿色高亮 +「已完成」、圆角胶囊 18/大框 20 DIP、胶囊高度 56→52。隔离 smoke 断言 PASS（pinned/pin/radius/height/chip/背景渐变/色散 enabled+running），截图 `evidence-real/ui-capsule-*.png`（仓库外）。

## 后续扩展（P2）
- [ ] 多 Agent 统一抽象与插件接口。
- [ ] 完整事件时间线搜索与筛选。
- [ ] 高级实时边缘光学效果。
- [ ] macOS/Linux 技术评估。
