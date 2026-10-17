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
