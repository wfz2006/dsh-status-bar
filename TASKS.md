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
- [x] M3-01 采用经官方认证 Host 的 Electron Adapter（不依赖 Cordis 插件）：用户根认证 URL → 0.2.1-rc.2 `/connect?interactions=answer` 独立 operator；Fake Host 与真实 Host 均验证 302/Cookie/RPC。
- [x] M3-02 会话增删、control baseline、live `session/follow` 与冷历史只读 `session/page`；冷会话不 follow、不唤醒 Agent。真实 Host `pnpm test:live` 读到一条 idle/cold 测试会话并安全保持 unknown。
- [x] M3-03 `todos` 作为每个 session 的完整投影，按 native sequence 合并、拒绝旧快照；支持清空、重连快照与跨会话隔离。证据：`tests/dsh-host-contract.test.ts` + live Todo Probe A/C。
- [x] M3-04 关联 `tool/call`/`tool/result`，跟踪 pending/running/success/error/cancelled 与脱敏摘要；审批审计 ID、tool callId、Remote eventId 分开；参数不完整不显示成可批准。Fake Host 合同覆盖。
- [x] M3-05 映射 starting/running/idle/unknown；明确 completed、max-tokens（limit-reached）、blocked/error、aborted/cancelled、archived；idle/缺少 reason 不推断完成。实时 Todo、工具、stats/note 投影已接入。
- [x] M3-06 独立 DSH_HOME Web Host + Electron 生命周期：成功连接、token 拒绝、断开清理真实验证；不读写原用户 Profile。`pnpm test:live`。
- [x] M3-07 认证跨进程 Adapter 的 Fake Host 合同测试扩至34项，覆盖权限、冷历史、状态终因、投影排序、会话生命周期、审批/提问回执和超时；真实 Host 联调见 `scripts/live-dsh-integration.mjs` 与 `docs/evidence/live-dsh/`。Desktop 当前用户会话单列为 M4-08，不冒充实机验收。

## M4 — 人工交互闭环（P0/P1，**取决于 M0-05 是否通过**）
- [x] M4-01 独立 operator `/connect?interactions=answer` 与 Gateway owner/client.peer 限制已形成 ADR 004；收到当前 waterfall 可证明答复权限。Desktop 中原 answerer 是否与 operator 同时响应、真实所有权竞争仍未实测，见 M4-08。
- [x] M4-02 审批显示 toolName/callId/安全命令摘要；完整参数缺失/不匹配时只读。
- [x] M4-03 单次允许/拒绝，`$events/result` void 不当作确认；只在匹配 `approval/decided` 后改变状态。34 项合同测试覆盖；真实审批请求尚未在 Host 生成。
- [x] M4-04 cancelled/unavailable、断线、重复点击、过期、并发与10秒无回执降不可用；Fake Host合同测试覆盖。
- [x] M4-05 有 durable callId 的结构化选项/文本验证；等待 settled 投影确认，timed wait continued 使用正式 `userQuestions/answer`；无 durable callId 的旧式问题只读。
- [x] M4-06 多 Session / 多请求隔离由 Main gate、Adapter identity 与 Fake Host 合同测试覆盖。
- [x] M4-07 应答通道由 Main `request-gate` 与 Adapter 双重校验身份/能力/参数。审批只等官方决议；continued 问题只等正式 API boolean true；不复用过期 Remote event。
- [ ] M4-08 官方 Desktop 当前用户任务、真实审批/问答和原 answerer 竞争实测。BLOCKED：隔离 Host 探针没有模型生成操作或真实审批，因此现有结果只证明认证、只读会话/Todo和安全拒绝。
- [x] M4-09 真实官方 Host 实装联调：`/connect` 302 独立 operator + 会话/Todo 观察 + 断开清空 + 错误 token 拒绝；`pnpm test:live`，隔离 DSH_HOME + 只读探测插件，2026-10-18 PASS。此项不替代官方 Desktop 与真实审批验收。证据：`scripts/live-dsh-integration.mjs`、`docs/evidence/live-dsh/`。

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
- [x] M5-10 会话用量指标（2026-10-18）：适配器从 `sessionStats`/`tokenUsage`/`contextPressure` 计算轮数、步数、tok/s、总 token、缓存命中率与上下文占用；胶囊显示「N轮 · N步」，速览两行、详情一行补充 tok/s/总 token/缓存/上下文。真实投影 `{turns:5,steps:137}` 样例断言与 Fake Host 合同测试覆盖（11 项），13 文件 94 测试全过。
- [x] M5-11 磨砂玻璃主题（2026-10-18）：新增 `material: frosted`（设置「玻璃主题」），取样画面 `blur(34px) saturate(.72) contrast(.9)` + 乳白径向雾面 + 细颗粒；auto 主题在磨砂下按浅色表面解析，深色主题使用深灰雾面；未取样时退回半透明白雾。隔离 Electron 断言 material/图层/滤镜/auto 解析/深色 PASS，截图 `evidence-real/ui-frost-*.png`（仓库外），13 文件 95 测试全过。
- [x] M5-12 工作过程视图与胶囊动效（2026-10-18）：大窗新增「过程 / 步骤」切换，过程页按工具活动时间线渲染 `toolName`、状态与摘要（复用最近活动面板的同一份 `session.activities` 数据）；展开高度 280→360。工作胶囊标题加呼吸动画（透明度 + 0.5px 浮动，`data-animation=reduced/off` 与 `prefers-reduced-motion` 均关闭）。隔离 Electron 断言 `capsule-breathe`、过程页 1 条活动、步骤页 2 条 Todo、窗口 400×360 PASS，截图 `evidence-real/ui-capsule-working.png`、`ui-expanded-process.png`、`ui-expanded-steps.png`（仓库外）。
- [x] M5-13 排版与配色层级（2026-10-18）：建立三级墨色 `--fg / --ink-2 / --ink-3` 与语义色 `accent / success / warning / danger`（含 soft 底色，light/dark 同步）；标题用 Georgia/宋体 600，指标数字改等宽并以强调色着色，工具名用强调色芯片，活动状态用色点，设置分组标题加引导点与发丝线，页签选中有强调色浅底；运行态胶囊标题用 fg→accent 渐变，删除与省略号重叠的尾随三点。隔离 Electron 复核 capsule/peek/expanded/settings/dark 五张截图，13 文件 95 测试全过、lint/typecheck 0。
- [x] M5-14 烟熏磨砂与真实转录（2026-10-18）：磨砂主题改为烟熏深色（取样 `blur(30px) saturate(1.35) brightness(.74)`，深色雾面 + 颗粒，auto 主题在磨砂下解析为深色）；新增 `session.note` 帧与 `Session.notes`（reasoning/message，≤60 条），DSH 适配器从 `assistant/message` 抽取思考与正文，工具活动摘要改用命令预览；大窗过程页按 sourceSeq 混合思考、正文与工具调用，带类型图标与可展开详情；胶囊运行态改为逐字波动（`capsule-wave`，空格用固定宽度占位，动画关闭设置仍生效）。13 文件 97 测试、lint/typecheck 0、构建通过；隔离截图 `evidence-real/shot-frost-*.png`（仓库外）。后续按反馈移除 3px 点阵颗粒（白色小点），烟熏雾面保留。
- [x] M5-15 紧凑胶囊与七项体验修正（2026-10-18）：胶囊 300×52→288×50、内边距 18→13px、间距 12→8px；移除系统托盘并在 BrowserWindow 上 `skipTaskbar: true`，菜单「隐藏到托盘」改为「隐藏窗口」；完成态由整块绿色渐变改为 5% success 底 + 1px 内描边 + 小签「已完成」；过程行 padding 8→5px、图标 22→20px、正文 12→11.5px；随后进一步压到 22px 行高（padding 2px、图标 18px、标题 10px、预览 10.5px），转录新增用户输入（note kind `user`、标签「你」）并按真实事件 seq 排序，工具结果到达时行状态即时从「执行中」变为「已完成」（Mock 同步补 user note 与 read_file 结果帧）；修复统计闪烁根因（`applyProjections` 按 key 合并缓存，单 key 快照不再把 stats 归零）；速览新增 20px 上下文圆环；原生 `<select>` 换成自绘 `SessionPicker`（药丸触发器显示「会话 N」+ 半透明列表；弹层左对齐、宽度自适应 ≤240px、限高 150px，始终留在窗内）；修复胶囊省略号与三点重叠、下拉框原生弹层不可美化的问题。新增 Fake Host 单 key 投影与转录/状态回归测试（13 文件 100 测试）、隔离 Electron 七项断言 PASS，截图 `evidence-real/shot-seven-*.png`（仓库外）。
- [x] M5-16 完成与审批提示音（2026-10-18）：新增 `shared/sound.ts` 纯规则 `chimeFor`（仅同一会话内、完成态翻转或待处理数增加时触发；首次观察、切换会话、关闭提示音均静默）与 `renderer/sound.ts` Web Audio 双音提示（完成 659→988Hz、审批 523→784Hz，无音频资源、无网络）；主进程开启 `autoplay-policy=no-user-gesture-required`；设置「行为」新增「提示音」开关（默认开启，持久化）。新增 4 个规则用例与设置归一化断言（14 文件 127 测试）；隔离 Electron 断言默认开启、完成音、审批音、AudioContext running 全 PASS。

## 后续扩展（P2）
- [ ] 多 Agent 统一抽象与插件接口。
- [ ] 完整事件时间线搜索与筛选。
- [ ] 高级实时边缘光学效果。
- [ ] macOS/Linux 技术评估。
