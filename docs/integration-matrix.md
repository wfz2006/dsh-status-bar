# 本地接入支持矩阵

检查日期：2026-10-18。当前交付版本：Glass 0.1.0，**Mock 开发预览 + 认证适配器（合同测试 + 真实 Host 实装联调）**。

| 目标 | 插件加载 | Session/Todo | Glass UI 真实连接 | 审批 / 问题回答 |
|---|---|---|---|---|
| Mock Adapter | PASS | PASS，确定性夹具 | PASS，认证 WS + Electron | 不提供，按钮禁用 |
| 官方 0.2.1-rc.2 bundled CLI / 独立 Web Profile | PASS | PASS：插件通过官方 SessionStore 写入测试事件并收到 `session/event`，Todo 数量 3→2 | PASS（实装联调 2026-10-18）：同一真实 Host 上，Electron 经设置面板粘贴认证链接 → 303+Cookie → `session/list` RPC → `remote.mux` `session/follow`；会话/标题/Todo 同步、断线清空、错误 token 拒绝；`pnpm test:live` 可复现 | 代码路径已实现（`$events/result` 回写）并由 Fake Host 合同测试覆盖；真实 Host 上尚无审批投递 → BLOCKED |
| 官方 Desktop 0.2.1-rc.2 / 原有 desktop Profile | 未测试 | 未测试现有用户会话 | BLOCKED | BLOCKED，未验证唯一 owner/委派 |

Web 证据是**真实 DSH Runtime 中的人工测试夹具**，不是模型驱动的 Agent 任务，也不证明 Desktop UI 已联通。Glass 默认仍显示 Mock 数据；DSH 模式需要用户粘贴官方启动器输出的认证链接。认证、会话/Todo 观察、断线清理与错误 token 拒绝已在真实官方 Host（隔离 DSH_HOME）上实装联调通过（`pnpm test:live`，证据 `docs/evidence/live-dsh/`），但未接入官方 Desktop 的当前任务，真实审批投递/决议仍未验收，不能据此宣传 Control PASS。

## 环境

- Windows 11 家庭版 中文版 x64，10.0.26300 / Build 26300。
- Shell 开发工具：`D:\node\node.exe` v24.15.0，`D:\npm-global\pnpm.ps1` 12.4.1。
- 官方应用：`D:\DSH\DeepSeek Harness.exe`；卸载注册项/文件版本旧记录为 0.2.0-rc.2，本轮未复核。
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

默认只允许交付 Mock Preview。DSH 模式保持实验性、默认关闭，只能由用户粘贴自己的认证链接开启；官方 Desktop 的插件正常装载、live Session 快照、生命周期和审批所有权验证完成前，不对外宣称真实审批可用，不接管任何官方 answerer。2026-10-18 增补：认证、会话/Todo 观察、断线清理与错误 token 拒绝已在真实官方 Host（隔离 DSH_HOME + 只读探测插件）上实装联调通过（`pnpm test:live`）；该证据不覆盖官方 Desktop 当前任务与真实审批决议。
