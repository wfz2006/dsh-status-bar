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
