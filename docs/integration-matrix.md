# 本地接入支持矩阵

检查日期：2026-10-17。当前交付版本：Glass 0.1.0，**Mock 开发预览**。

| 目标 | 插件加载 | Session/Todo | Glass UI 真实连接 | 审批 / 问题回答 |
|---|---|---|---|---|
| Mock Adapter | PASS | PASS，确定性夹具 | PASS，认证 WS + Electron | 不提供，按钮禁用 |
| 官方 0.2.0-rc.2 bundled CLI / 独立 Web Profile | PASS | PASS：插件通过官方 SessionStore 写入测试事件并收到 `session/event`，Todo 数量 3→2 | 尚未实现跨进程 DSH Adapter 传输 | BLOCKED，未注册 answerer |
| 官方 Desktop 0.2.0-rc.2 / 原有 desktop Profile | 未测试 | 未测试现有用户会话 | BLOCKED | BLOCKED，未验证唯一 owner/委派 |

Web 证据是**真实 DSH Runtime 中的人工测试夹具**，不是模型驱动的 Agent 任务，也不证明 Desktop UI 已联通。Glass 当前仍只显示 Mock 数据。不能据此宣传 Observe PASS 或 Control PASS。

## 环境

- Windows 11 家庭版 中文版 x64，10.0.26300 / Build 26300。
- Shell 开发工具：`D:\node\node.exe` v24.15.0，`D:\npm-global\pnpm.ps1` 12.4.1。
- 官方应用：`D:\DSH\DeepSeek Harness.exe`，卸载注册项/文件版本/CLI 都是 0.2.0-rc.2。
- CLI 不在当前 PATH，但**已经随 Desktop 捆绑**：`D:\DSH\resources\runtime\cli\bin\dsh.cmd`，`--version` 实测 0.2.0-rc.2。无需重新安装。
- DSH 自带 runtime 元数据：Node 24.18.1、pnpm 11.7.0。与系统 PATH 工具不同。
- Glass：Electron 44.8.0、electron-vite 6.0.0、Vite 8.3.4、React 19.3.1、TypeScript 5.9.3。版本在 pnpm-lock.yaml 锁定。
- Electron screenshot 为本机系统缩放下的物理像素；测试窗口设置以 DIP 为准。

## 可复现 Web 探测

在项目根目录，用独立的 DSH_HOME，不读取或改动用户原 Profile：

```powershell
$env:DSH_HOME = "$PWD/.local-dsh-probe"
$env:GLASS_PROBE_FIXTURE = '1'
& 'D:/DSH/resources/runtime/cli/bin/dsh.cmd' web --patch "$PWD/packages/adapters/dsh/probe/cordis.patch.yml" --no-open --port 0
```

迁移目录后先更新 patch 中的绝对插件路径。仅在独立测试 Profile 设置 `GLASS_PROBE_FIXTURE=1`；普通观察加载时不设置该变量，不会写入测试事件。CLI 会显示本地认证 URL，日志分享前必须去掉 URL/token。按 Ctrl+C 结束这一个测试服务；本轮测试服务已结束。

证据：[脱敏 Web 日志](evidence/dsh-web-probe.txt)、[安装包代码定位及 SHA-256](evidence/installed-signatures.json)。未验证正常卸载 listener 的完整生命周期，后续需补热卸载测试。

## Go / No-Go

只允许交付 Mock Preview。Desktop 插件正常装载、live Session 快照、生命周期和审批所有权验证完成前，不开启 DSH 模式、不实现 `approval.respond`、不接管任何官方 answerer。
