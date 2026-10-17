# 首轮验收记录

日期：2026-10-17。平台：Windows 11 x64 Build 26300。全部命令在项目根目录执行。

这是首轮验收的历史记录；后续液态玻璃/紧凑布局修订见 [最新视觉验收](liquid/verification.md)，现有单测为 21 项。

| 检查 | 结果 |
|---|---|
| `pnpm lint` | PASS，0 errors |
| `pnpm typecheck` | PASS，strict TypeScript |
| `pnpm test` | PASS，4 files / 17 tests |
| `pnpm build` | PASS，main/preload/renderer 产物均生成 |
| `pnpm test:desktop` | PASS，实际 Electron 44.8.0 |
| 独立只读代码复核 | 两项 P2 已先复现后修复，复核确认无遗留问题；独立重跑 17 tests 通过 |
| 官方 DSH bundled CLI 隔离 Web Probe | PASS 插件加载 + 人工 Session 事件 + Todo 3→2 |
| 官方 Desktop 正常插件接入 / 真实任务 / 真实审批 | BLOCKED，未验收 |

单元与集成重点：错误协议、错误 Todo、旧消息/epoch、迟到旧快照、空 Todo、并行 Todo、跨 Session、原型键；Origin/token、并发客户端、握手前请求、超大帧、频率限制、重连。

Electron 重点：默认胶囊展开、Todo 整表替换、只读审批禁用、会话切换、断线失效、重连最新快照、主题、置顶真实状态及外部变更同步、180×54/280×140/340×280/520×90/520×620 DIP 断点，无横向页面溢出，renderer 无 Node/token，沙箱与 contextIsolation 开启，无 renderer runtime errors。

自动化详情见 [desktop-smoke.json](desktop-smoke.json)。桌面截图保留在同目录，系统缩放使物理像素尺寸大于 DIP；这不是完整 DPI 矩阵验收。

已知工具提示：Playwright 1.56.1 启动器在 Node 24 输出 DEP0190；官方 DSH CLI 输出 DEP0180。它们是上游弃用提示，未压制；检查均返回成功。不同壁纸下的系统 Acrylic、原生拖拽手感、托盘恢复、休眠/多屏、性能与安装包尚未验收。

## 跨进程 DSH Adapter 合同测试（2026-10-17 晚）

| 检查 | 结果 |
|---|---|
| `pnpm lint` | PASS，0 errors |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，12 files / 88 tests（含 `tests/dsh-host-contract.test.ts` 10 项） |
| `pnpm build` | PASS |

合同测试在本机 Fake Host（HTTP 303 认证 + `/api/<method>` JSON-RPC + `/api/remote.mux` WS）上复现握手、快照、网关事件、审批与提问投递、`$events/result` 回写与断线失效；不连接官方 Desktop，不能替代真实 owner/answerer 验收。首轮修复：welcome 能力位曾写成「连接时是否已有投递」，恒为 false 导致审批卡片永久禁用；现改为连接级能力，逐投递授权仍由适配器与 `request-gate` 强制。

## 真实官方 Host 实装联调（2026-10-18）

`pnpm test:live` = `scripts/live-dsh-integration.mjs`：启动随 Desktop 捆绑的官方 Host（`app.asar` 内 `dsh-desktop-host` CLI，`--profile web --patch packages/adapters/dsh/probe/cordis.patch.yml --no-open --port 0`，隔离 `DSH_HOME=.local-dsh-probe`），再用 Playwright 启动真实 Electron 应用，在设置面板粘贴认证链接完成连接。

| 检查 | 结果 |
|---|---|
| Host 版本 / 认证 | `0.2.1-rc.2`；GET 根链接 → 303 + 同源 `Location: /` + `Set-Cookie`，`POST /api/session/list` → `server-response result.ok=true`（1 项） |
| 应用连接 | 设置面板提交后 `mode=dsh`、`connection=connected`、`endpoint=http://127.0.0.1:<port>`、`error=null` |
| 能力位 | `observeSessions/observeTodos/observeTools/respondApproval/respondQuestion` 全 true（真实链路复验连接级能力修复） |
| 会话观察 | 真实 API 返回 1 个会话；标题「未命名会话」、phase/agentStatus `finished/idle`、Todo `Probe A:completed` + `Probe C:in_progress`（与 Host 侧 fixture 一致） |
| 凭据边界 | renderer `getState()` 序列化中不含 token；证据文件不含 token |
| 断开 / 错误 token | 断开后 `connection=disconnected` 且 sessions=0；错误 token 被 Host 拒绝，界面显示本地化错误且保持 disconnected |
| 截图 | [connected.png](live-dsh/connected.png)（设置面板「DSH 已连接 / 会话已同步」）；机器可读结果 [result.json](live-dsh/result.json) |

未覆盖：真实模型任务、真实审批投递/决议（fixture 只写 turn/todo，无 `$events` 审批事件）、官方 Desktop 当前任务、多会话并发；本机 DSH 安装版本为 `0.2.1-rc.2`（`dsh.cmd` 包装器仍报 `0.2.0-rc.2`，文件属性未复核）。

## 真实本机会话人工验收（2026-10-18，只读快照）

把本机真实 DSH home 的 `sessions/` 与 `storages/` 复制到仓库外的隔离目录（不写回用户 profile，不含 `credentials`），用同一捆绑 Host 启动该快照，再由 Playwright 启动构建后的 Electron 应用，在设置面板粘贴真实认证链接完成连接。

| 检查 | 结果 |
|---|---|
| 真实会话规模 | 82 个会话，79 个有标题；0 个 running；1 个带 5 条 Todo（含 in_progress） |
| 当前会话 | 本工作会话标题正确显示，phase/agentStatus `finished/idle` |
| 会话切换 | 展开视图会话选择器 82 项；切到真实 Todo 会话后 5 行 Todo 与 Host 数据一致 |
| 能力位 / 凭据 | 连接级能力全 true；token 未进入 renderer 投影与证据文件 |
| 断开 | `connection=disconnected`、sessions=0 |
| 崩溃修复 | 首轮暴露主进程崩溃：连接发生在 Mock bridge 握手前，`adapter!` 未赋值；改为 `adapter?.welcome() ?? mockWelcome()` / `snapshot` 兜底后复跑 3 次全部 PASS |
| 截图 | 保留在仓库外（真实会话标题属私有数据），不随仓库分发 |

限制：这是真实数据快照，不是对运行中 Desktop 进程的实时接管（该进程的认证 token 只在内存中，无法在不干扰用户应用的前提下取得）；未触发真实审批/提问投递，不能替代 M4-08 的官方 Desktop 决议验收。

## 启动器钩子（2026-10-18）

`packages/dsh-plugin` 从空载占位改为启动器：等待 `webServer.getOrigin()` 后向 `connection.authenticatedUrl(origin)` 取认证链接，`spawn` Electron 运行 `apps/desktop` 并传 `--dsh-link=<url>`。Glass 启动后由 `dshLinkFromArgs` 校验（仅 loopback http(s) 根链接，无凭据/hash/子路径，≤4096 字符）再自动连接；第二实例由单实例锁聚焦并重连。

| 检查 | 结果 |
|---|---|
| 链接解析单测 | `tests/launch.test.ts` 4 项：正常链接、重复参数取最后一次、缺失/空值、跨域/凭据/hash/子路径/file/超长全部拒绝 |
| 自动连接 | 隔离 Host（空 Profile）+ Playwright 以 `--dsh-link` 启动构建产物，无需任何界面操作即 `mode=dsh`、`connection=connected`，`endpoint` 为不带 token 的 origin |
| 第二实例 | 再启动一个进程携带新链接：第二进程立即退出，第一窗口保持 connected（单实例交接） |
| 插件实际拉起 | 隔离 Web Profile 启动 Host，stdout 打印 `[dsh-glass-plugin] Glass desktop companion launched`，进程表出现带 `--dsh-link` 的 Electron；结束后清理 |
| 脱敏 | 插件日志不含链接；`--dsh-link` 只出现在进程参数中；证据不含 token |

限制：本验证用隔离 Profile（非 desktop profile），未自动验证市场「已安装」条目在用户 Desktop 重启后的实际加载；插件拉起的是开发态 `apps/desktop`，不是安装包。

## 默认与外观收紧（2026-10-18）

目标：默认始终置顶、启动即开启真实折射与色散、任务完成时胶囊绿色高亮并显示「已完成」、缩小圆角、压缩胶囊高度。

| 检查 | 结果 |
|---|---|
| 默认置顶 | `getWindowState().pinned === true`、`settings.pin === 'always'`；旧配置 `normal` 由设置版本 2 一次性迁移为 `always` |
| 胶囊尺寸/圆角 | 窗口 302×52（原 300×56），`.glass` computed `border-radius: 18px`（原 20px）；大框 20px |
| 完成高亮 | mock 完成场景 8.6s 后 `data-state=completed`、`.capsule-state` 文本「已完成」、`.task-capsule` 背景为绿色渐变 `linear-gradient(160deg, rgba(72,205,122,.34), rgba(34,160,88,.22))` |
| 色散默认开 | 非 smoke 启动 2.6s 后 `getOpticsState() = { enabled: true, running: true, error: null }` |
| 单元/构建 | `pnpm lint` 0、`pnpm typecheck` 0、`pnpm test` 13 文件 92 用例、`pnpm build` 成功（renderer 829.66 kB） |

截图：`ui-capsule-default.png`、`ui-capsule-completed.png`（保存在仓库外 `evidence-real/`，避免把本机窗口画面入库）。

限制：验证用 `GLASS_SMOKE=1` 的 Mock 投影与临时用户目录；自动化期间窗口以 `setIgnoreMouseEvents(true)` 隔离真实鼠标，未覆盖人工交互下的置顶行为与完成态动画观感。

## 会话用量指标（2026-10-18）

数据来源：DSH 会话投影的 `sessionStats`、`tokenUsage`、`contextPressure`，由跨进程适配器归一化后随 `session.upserted` 下发；缺失字段整体省略，不伪造数字。

| 指标 | 计算 |
|---|---|
| 轮数 / 步数 | `sessionStats.turns` / `sessionStats.steps` |
| tok/s | `decodeTokens / decodeMs × 1000`，取整 |
| 总 token | `uncachedInput + cacheRead + cacheWrite + output` |
| 缓存命中 | `cacheRead / (cacheRead + uncachedInput) × 100`，保留 1 位 |
| 上下文占用 | `contextPressure.projectedTokens / contextWindow × 100`，保留 1 位 |

真实投影样例（快照会话 `session-de3b6b77…`）：`turns=5, steps=137, tokens=9,354,169, tok/s=254, cache=95.6%, context=9.9%`。

| 检查 | 结果 |
|---|---|
| 适配器合同测试 | Fake Host 注入真实形状投影，`session.stats` 六项逐一相等（`tests/dsh-host-contract.test.ts`，11 项） |
| 视图汇总 | `taskMetrics` + `formatTokens`：1.3M / 432K / 9.8K 格式与空会话隐藏（`tests/view-model.test.ts`，94 项总） |
| 胶囊 | 文案「3轮 · 42步」与 Todo 进度并存，宽度不换行 |
| 速览 | 两行：「3 轮 · 42 步 · 218 tok/s」「1.3M tok · 缓存 96.4% · 上下文 7.2%」 |
| 详情 | 单行指标条：轮/步、tok/s、总 token、缓存、上下文，不挤压 Todo 列表 |

截图：`ui-capsule-metrics.png`、`ui-peek-metrics.png`、`ui-expanded-metrics.png`（仓库外 `evidence-real/`）。

限制：成本（¥）不在会话投影里，未显示；指标每 5 秒随 `session/list` 轮询刷新，不是逐 token 实时值。

## 磨砂玻璃主题（2026-10-18）

新增 `material: 'frosted'`（设置 → 外观 → 玻璃主题 → 磨砂玻璃），原生窗口保持透明，由渲染层合成：

| 层 | 参数 |
|---|---|
| 取样画面 | `filter: blur(34px) saturate(.72) contrast(.9) brightness(1.08)` + `scale(1.06)` 遮住模糊边缘 |
| 乳白雾面 | 径向渐变 `rgba(255,255,255,.62) → .26 → .10` + 纵向 `.34/.14/.24`，位于折射透镜层下方 |
| 颗粒 | `radial-gradient` 3px 点阵，`soft-light`，总不透明度约 .22 |
| 深色 | 深灰雾面 `rgba(52,62,78,.58) → rgba(16,20,28,.12)`，亮边降至 .26 |
| 未取样回退 | 根节点 `rgba(255,255,255,.30)`（深色 `.32`）半透明白雾，不出现全透明空洞 |
| auto 主题 | 磨砂表面按浅色解析（`data-theme=light`），避免深色壁纸把文字刷成白色后压在乳白雾面上 |

隔离 Electron 实测（`GLASS_SMOKE=1` + 显式开启取样）：

| 检查 | 结果 |
|---|---|
| 材质 | `setSettings({material:'frosted'})` 后 `WindowState.material='frosted'`、`data-material=frosted` |
| 取样 | `optics.enabled=true`、`running=true`、`error=null`，canvas 可见 |
| 图层 | `.glass-frost` 存在，canvas 计算样式含 `blur(34px) saturate(0.72) contrast(0.9)`，根背景非透明 |
| 三种形态 | 胶囊 302×52、速览 340×168、详情 400×360 均保持雾面与模糊 |
| auto / dark | auto 解析为 `light`；切 dark 后仍保留雾面层 |

截图：`ui-frost-capsule.png`、`ui-frost-peek.png`、`ui-frost-expanded.png`、`ui-frost-dark.png`（仓库外 `evidence-real/`；壁纸为深红色，因此雾面呈玫瑰色，属真实取样结果）。

限制：模糊作用于 30~60fps 的桌面取样帧，采样停止（隐藏窗口/关闭色散）后退回静态白雾；未在 100% DPI 和多屏拼接上复测边缘采样。

## 工作过程视图与胶囊动效（2026-10-18）

大窗（400×360）新增「过程 / 步骤」两个页签。过程页复用 `session.activities` 的工具活动时间线，逐条显示工具名、执行状态（等待执行/执行中/已完成/执行失败/已取消）与摘要、结果摘要；数据与「最近活动」面板同源，DSH 会话来自 `tool/call`、`tool/result` 与 follow 审计事件，Mock 会话来自 `session.tool.activity` 帧。工作胶囊在 `agentStatus=running/starting` 时标题做呼吸动画（透明度 .8↔1、上下 0.5px）；`data-animation=reduced` 放慢到 6s，`off` 与系统 `prefers-reduced-motion` 直接停用（尾随三点后因与标题省略号重叠，已在 M5-13 移除）。

隔离 Electron 实测（`GLASS_SMOKE=1`）：

| 检查 | 结果 |
|---|---|
| 胶囊呼吸 | `data-state=running`、`.capsule-title` 计算样式 `animationName=capsule-breathe` |
| 过程页 | 切大窗后高度 360、两个页签、默认「过程」选中，过程页 1 条 `read_file` /「执行中」/「查看协议与状态模型 · Mock 事件」 |
| 步骤页 | 点「步骤」后 `aria-selected=true`，Todo 2 条 |
| 窗口 | `getBounds()` 400×360（忽略鼠标事件、位置固定在 120,120 后测量） |

截图：`ui-capsule-working.png`、`ui-expanded-process.png`、`ui-expanded-steps.png`（仓库外 `evidence-real/`）。限制：过程页只覆盖工具活动，不含模型流式文字；真实会话中非运行态不再 follow，历史活动来自重连时 follow 快照与 `session/list` 的有限投影。

## 排版与配色层级（2026-10-18）

`typography.css` 建立四种角色：显示字体 Georgia + Noto Serif SC/宋体 600（标题、胶囊标题），正文 Segoe UI Variable Text/Segoe UI，说明字 11–12px，数据与工具名用 Cascadia Mono/Consolas。`refined-theme.css` 新增三级墨色 `--fg / --ink-2 / --ink-3` 与语义色 `--accent / --success / --warning / --danger`（各带 soft 底色），light 与 dark 分别取值；标题用 fg，运行态胶囊标题用 fg→accent 渐变，完成态标题偏 success。

层级规则：指标数字统一等宽 + accent（胶囊「N 轮 · N 步」、速览两行、详情指标条）；每组指标按「标签 ink-3 + 数值 ink-2/accent」分层；工具名用 accent-soft 芯片，活动状态用色点（执行中 accent、成功 success、失败 danger）；页签选中用 accent-soft 底与 accent 边；设置分组标题加 accent 引导点与发丝线；胶囊步数用等宽 ink-3。此前工作胶囊尾随三点因与标题省略号视觉重叠而删除，呼吸动画保留（`capsule-breathe`）。

隔离 Electron 截图复核（`GLASS_SMOKE=1`，忽略鼠标事件并固定 120,120）：胶囊 302×52、速览、详情 400×360、设置面板、深色主题五张；页签与窗口尺寸断言沿用 process-check 脚本。检查结果：lint 0、typecheck 0、13 文件 95 测试全过、`pnpm --filter @glass/desktop build` 成功。

限制：显示字体依赖本机 Georgia/宋体/等宽字体可用性，缺失时回退系统字体；深色截图是透明窗口内容落在浅灰背景上的取样效果，真实深色壁纸下对比更高；approval 视图存在既有截图重影（与字体无关，待查）。

## 烟熏磨砂、过程转录与逐字波动（2026-10-18）

磨砂主题按反馈重做为烟熏深色：取样画面 `filter: blur(30px) saturate(1.35) brightness(.74) contrast(1.06) scale(1.06)`，叠加深色雾面渐变、白色斜向光泽与 3px 颗粒；`auto` 主题在磨砂下解析为深色，未取样时退回 `rgba(26,14,19,.34)` 深色底。截图 `shot-frost-capsule.png`、`shot-frost-expanded.png`（仓库外）为深红壁纸上的烟熏效果。

过程数据：协议新增 `session.note`（`kind: reasoning|message`，`text` 1–2000，按 `sourceSeq` 去重、最多 60 条）与 `Session.notes`；DSH 适配器在 `assistant/message` 事件中抽取 `content` 的 reasoning/text 块（空白归一化、忽略空块），工具活动摘要改为命令预览（完整可解析时）。大窗过程页把 notes 与 activities 按 `sourceSeq` 降序混排，每行带类型图标（思考/正文/read_file/pwsh/edit/search/globe 等）、工具名与状态，行可展开看完整正文/结果。Fake Host 合同测试新增 assistant/message 用例，协议生命周期新增 note 顺序/去重/过期用例，Mock 快照回放包含 notes。

文字波动：工作胶囊标题拆为逐字符 `span.wave-char`，`capsule-wave` 每字符 3s 循环（0.4→−1.6px 上浮 + 透明度 0.82→1），相邻延迟 45ms（最多 24 字符错相）；空格用 `flex:0 0 .3em` 固定占位，避免 flex 收缩吞掉间距（截图曾呈现「构建DSHGlass悬浮伴侣」）。`data-animation=reduced/off` 与 `prefers-reduced-motion` 关闭动画，静态渲染不受影响。

隔离 Electron 断言：磨砂层 `data-theme=dark`/`.glass-frost` 存在；波动 17 个字符、空格宽 4.34px、`animationName=capsule-wave`、第二字符延迟 45ms；过程页 5 行（message/reasoning/tool/reasoning/message）、5 个图标、工具行可展开；检查结果 lint 0、typecheck 0、13 文件 97 测试全过、`pnpm --filter @glass/desktop build` 成功。

限制：实时转录依赖被 follow 的 running 会话（`session/follow` 的 assistant/message 流；归档会话只有缓存投影，通常没有 notes）；思考文本可能很长，列表预览截断、详情最多显示 6 行；截图仍受既有 approval 重影影响的视图未纳入本轮证据。


## 紧凑胶囊与七项体验修正（2026-10-18）

| 项目 | 改动 | 验证 |
| --- | --- | --- |
| 胶囊紧凑 | viewSize 300×52→288×50；`.task-capsule` padding 18→13px、gap 12→8px | 隔离 Electron 断言 bounds 290×50（含 2px 阴影）、computed padding 13px/gap 8px，截图 `shot-seven-capsule.png` |
| 不在任务栏/托盘 | BrowserWindow `skipTaskbar: true`；删除 Tray/nativeImage 及 tooltip；菜单「隐藏到托盘」改「隐藏窗口」 | 代码路径 + 启动无托盘图标；菜单退出仍可用 |
| 完成态 | 去掉整块绿色渐变；5% success 底 + 1px 内描边 + 细成功小签「已完成」 | 断言 `data-state=completed`、chip 文本、`backgroundImage=none`，截图 `shot-seven-completed.png` |
| 过程紧凑 | summary padding 8→5px、icon 22→20px、正文 12→11.5px、隐藏横向滚动 | 断言两条 summary paddingTop=5px、row 高 30px |
| 统计闪烁 | 适配器新增 `projectionValues` 按会话合并投影 key，再计算 stats；单 key 快照不再覆盖为 0 | Fake Host 单 key snapshot 后 stats 仍为 5 轮/137 步/254 tok/s（13 文件 98 测试） |
| 上下文圆环 | 速览新增 20px SVG 圆环（aria-label「上下文占用 N%」） | 断言圆环存在、label 7.2%，截图 `shot-seven-peek.png` |
| 选择器 | 自绘 `SessionPicker`（药丸触发器 + listbox 弹层，onBlur 关闭），替换原生 select | 断言无原生 select、弹层 2 项、圆角 12px，截图 `shot-seven-picker.png` |

检查：`pnpm lint` 0、`pnpm typecheck` 0、13 文件 98 测试全过、`pnpm --filter @glass/desktop build` 成功（renderer index-CBk6rsPg.js 845.51 kB）。隔离脚本 `ui-seven-check.mjs` 七项断言 PASS；截图在仓库外 `evidence-real/shot-seven-*.png`。

限制：任务栏/托盘效果无法在无头断言中读取系统状态，按代码路径与启动表现确认；多屏/DPI 实机矩阵仍未覆盖。