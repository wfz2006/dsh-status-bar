# 本地接入支持矩阵

## 2026-11-18 小蓝鲸水池

本机安装包的 `app.asar/package.json` 版本为 `0.2.2-rc.3`。验收使用其官方 Web 宿主、Agent 循环、提问工具和审批服务，另启独立 DSH 配置与 Glass 窗口。测试插件提供两个会话、本地固定模型回复和一项只返回审批结果的无副作用操作。已安装 Desktop 的日常用户配置、云模型和安装包升级路径仍待单独验收。

| 环境 | 操作与证据 |
|---|---|
| 官方 DSH Web + Glass Electron | 新连接进入空水池。从 A 收到 B 的提问，输入后返回 A，再次进入 B，仍可提交原草稿。同一 Agent 接收答案后依次请求两次审批，Glass 显示各自的拒绝和允许一次回执。收到正式任务完成事件时鲸鱼庆祝一次，重新加载显示完成姿态。运行 `node scripts/pool-session-acceptance.mjs`。 |
| 可控制断线的宿主 + Glass Electron | 在同一份提问重连时恢复草稿，改题、换请求或离线已结束时丢弃旧草稿。另一会话同名请求的回执不能提前结束当前等待。运行 `node scripts/pool-reconnect-acceptance.mjs`。 |
| Windows 桌面，150% 缩放 | 胶囊贴边、点开和拖出后大小稳定。隐藏窗口后更新任务，通过已注册的 `Ctrl+Shift+G` 唤回同一窗口，直接显示最新状态。运行 `node scripts/pool-window-acceptance.mjs`。 |
| 小鲸鱼眨眼，WebGL 与 Canvas 2D | `node scripts/whale-blink-acceptance.mjs` 分别测量小圆点和弯形眼区的遮合比例，检查 16 款皮肤闭眼时只有一道连续弧线、睁眼后恢复原图，同时检查眼区外花纹、动作节奏和减少动态效果。矢量皮肤改动后运行 `node scripts/build-whale-eyelids.mjs` 同步眼睑材质。 |

`node scripts/whale-pool-acceptance.mjs` 还检查键盘展开、减少动态效果、显卡上下文恢复与实际展开路线。在本机高刷新率 Electron 窗口中，对同一段游动按显示回调采样，鲸鱼位置更新的中位间隔由 30.8 毫秒降至 3.8 毫秒。此数值衡量位置更新，不等同于显示器实拍帧率。

在项目根目录先运行 `pnpm build`，再逐个运行上述脚本。会话和重连验收的结果与截图写入本地 `reports/pool-companion-prototype/`。[查看整眼眨眼对比动图](images/homepage/whale-blink.webp)

## 2026-10-18 接入记录

当日交付版本为 Glass 0.1.0，含真实源连接入口与显式 Mock 演示。当时认证合同已更正为 0.2.1-rc.2 独立 operator，旧根路径 303 联调记录不能替代当日回归。

| 目标 | 插件加载 | Session/Todo | Glass UI 真实连接 | 审批 / 问题回答 |
|---|---|---|---|---|
| Mock Adapter | PASS | PASS，确定性夹具 | PASS，认证 WS + Electron | 不提供，按钮禁用 |
| 官方 0.2.1-rc.2 bundled CLI / 独立 Web Profile | 历史探针 PASS | PASS：真实 session/list 与投影 Todo 同步；样例为 idle/cold 会话，状态安全标 unknown，不恢复 Agent | PASS：用户链接 → `/connect?interactions=answer` 302+独立 Cookie → RPC → `remote.mux` 三条 baseline → Electron；断开清空、错误 token 拒绝、renderer 不含 token；`pnpm test:live` | void 投递 + 官方决议/投影回执由34项 Fake Host 合同测试覆盖；真实模型驱动审批/问答尚未验收 → BLOCKED |
| 官方 Desktop 0.2.1-rc.2 / 原有 desktop Profile | 未测试 | 未测试现有用户会话 | BLOCKED | BLOCKED，未验证唯一 owner/委派 |

Web 证据是**真实 DSH Runtime 中的人工测试夹具**，不是模型驱动的 Agent 任务，也不证明 Desktop UI 已联通。默认真实源未连接；Mock 仅显式演示/测试开启。DSH 模式需要用户粘贴官方启动器输出的认证链接。不得用历史 303 登录记录证明新的独立 operator 认证或真实审批成功。真实审批与提问必须等当前官方决议/投影回执；审批参数无法完整验证、旧式无 durable callId 问题、无合法 owner answer delivery 时只读。

## 环境

- Windows 11 家庭版 中文版 x64，10.0.26300 / Build 26300。
- Shell 开发工具：`D:\node\node.exe` v24.15.0，`D:\npm-global\pnpm.ps1` 12.4.1。
- 官方应用：`D:\DSH\DeepSeek Harness.exe`；本轮文件版本 0.2.1.0，ASAR package/CLI 版本 0.2.1-rc.2。旧 0.2.0-rc.2 记录不作为当前版本依据。
- CLI 不在当前 PATH，但**已经随 Desktop 捆绑**：`D:\DSH\resources\runtime\cli\bin\dsh.cmd` 与 `app.asar` 内 `dsh-desktop-host/lib/cli.js`；2026-10-18 实测后者 `--version`=0.2.1-rc.2（`dsh.cmd` 包装器仍报 0.2.0-rc.2，两者版本号不一致）。无需重新安装。
- DSH 自带 runtime 元数据：Node 24.18.1、pnpm 11.7.0。与系统 PATH 工具不同。
- Glass：Electron 44.8.0、electron-vite 6.0.0、Vite 8.3.4、React 19.3.1、TypeScript 5.9.3。版本在 pnpm-lock.yaml 锁定。
- Electron screenshot 为本机系统缩放下的物理像素；测试窗口设置以 DIP 为准。

## 可复现 Web 探测与实装联调

在项目根目录，用独立的 DSH_HOME，不读取或改动用户原 Profile：

```powershell
$env:DSH_HOME = "$PWD/.local-dsh-probe"
$env:GLASS_PROBE_FIXTURE = '1'
& 'D:/DSH/resources/runtime/cli/bin/dsh.cmd' --profile web --patch "$PWD/packages/adapters/dsh/probe/cordis.patch.yml" --no-open --port 0
```

`--patch` 是启动器级选项，必须位于 profile 名之前（实测 `dsh web --patch …` 报 `unknown option '--patch'`，`dsh --patch … web` 报 `--profile <name> is required`）。迁移目录后先更新 patch 中的绝对插件路径。仅在独立测试 Profile 设置 `GLASS_PROBE_FIXTURE=1`；普通观察加载时不设置该变量，不会写入测试事件。CLI 会打印带 token 的本地认证 URL，日志分享前必须去掉 URL/token。按 Ctrl+C 结束这一个测试服务。

实装联调一条命令完成（需本机已安装 DSH）：`pnpm test:live`。脚本自行启动隔离 Host、用 Playwright 启动真实 Electron，在设置面板粘贴链接，验证认证/会话/Todo 同步、断线清空与错误 token 拒绝；机器可读结果写入 `.local-dsh-probe/live-integration.json`，证据落盘到 `docs/evidence/live-dsh/`，均不含 token。

证据：[脱敏 Web 日志](evidence/dsh-web-probe.txt)、[安装包代码定位及 SHA-256](evidence/installed-signatures.json)、[实装联调结果](evidence/live-dsh/result.json)、[连接截图](evidence/live-dsh/connected.png)。未验证正常卸载 listener 的完整生命周期，后续需补热卸载测试。

## Go / No-Go

默认真实源未连接；DSH 模式由用户粘贴自己的认证链接开启，Mock 需显式演示。独立 operator 的 `answer` 权限由官方 `/connect` 授予，`$events` 还会校验权限并仅向 owner 下发 waterfall；Glass 不注册 Cordis answerer。真实 Desktop 当前用户任务及真实模型驱动审批/问答验收完成前，不将代码或 Fake Host 合同测试宣传为实机审批 PASS。10 秒无权威回执的提交显示 unavailable，用户须回 DSH 核对，不显示通过/已答复。
