# 09 — 官方资料索引与核验记录

文档编制日：2026-10-17。本文件中的“已证实”仅指**公开官方文档描述**，不代表已在用户的本机 DSH 版本执行成功。

## 1. 官方项目与架构

- DSH 官方仓库：<https://github.com/deepseek-ai/deepseek-harness>
- DSH 架构说明：<https://deepseek-harness.github.io/deepseek-harness/en/reference/>
- 官方首个插件教程：<https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/>
- 官方插件打包与安装：<https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish>
- Cordis 事件系统（官方仓库源码文档）：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/framework/events.md>

## 2. 关键事件与审批

- 官方审批 API：<https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/approval>
- 官方结构化提问：<https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/user-questions>
- 官方 Todo：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/todo.md>
- 官方 Session 事件目录：<https://deepseek-harness.github.io/deepseek-harness/en/reference/persistence-catalog>
- 官方工具目录：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-catalog.md>

**从这些官方资料能够确认**：

- `todo/write` 整表写入，TodoItem 有 `content` 和 `status` (`pending`, `in_progress`, `completed`)；未提供每项的稳定业务 ID。
- `approval/request` 是 waterfall，`allowed-once` 是唯一放行结果，审批请求不直接重复附带工具参数，通过 `callId` 与工具调用数据关联。
- `user-questions/request` 单独处理结构化输入，不应视为审批的别名。
- 持久事件可以通过 `session/event` 的观察方式处理；详细事件回调签名需要目标源码确认。

## 3. Desktop 特性

- 官方 Desktop README：<https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md>
- DSH 官方架构 Desktop 部分：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- 社区报告的本地插件 `link:` + peerDependencies 问题（需确认版本和真实性）：<https://github.com/deepseek-ai/deepseek-harness/discussions/9494>

**已证实**：Desktop 自己管理 `$DSH_HOME/profiles/desktop`，内置 Electron Host 和插件生命周期；同其他 CLI Profiles 不完全相同。

**未证实**：当前用户 Desktop 版本是否允许 Glass 完成审批所有权接管；这里必须做 SPIKE。

## 4. Electron 官方资料

- BrowserWindow API：<https://www.electronjs.org/docs/latest/api/browser-window>
- 窗口创建选项：<https://www.electronjs.org/docs/latest/api/structures/base-window-options>

系统材质 `setBackgroundMaterial('acrylic')` 是 Windows 11 22H2+ 的 Electron API 功能；与透明无边框窗口组合是否能够表现预期效果需要实测。`setIgnoreMouseEvents` 可以开启穿透，但必须具备恢复机制。

## 5. 目标运行环境核验（Codex 本地填写）

2026-10-18 过程延迟专项：只读核对本机 `D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/`，相关包版本均为0.2.1-rc.2。`dsh-api-session-controller/lib/index.js:1546,1573,1604` 证实 `session/follow.request.assistantStream=true` 才返回实时帧与重连基线；1658处为线格式。`dsh-agent-loop/lib/index.js:354,1080,1156` 证实实时start/chunk/end先于/伴随持久消息提交；`dsh-llm/lib/index.js:954,1150` 证实text/reasoning delta、block-end及压缩快照格式。SHA256和本轮验证范围见 `docs/integration-matrix.md`（该轮验收记录未随仓库保存）；未读取用户凭据或修改已安装应用/Profile。

```text
检查日期：2026-10-17
OS + Build：Windows 11 家庭版 中文版 x64 / 26300
Node：PATH=24.15.0 (D:/node)；DSH bundled=24.18.1
pnpm：PATH=12.4.1；DSH bundled metadata=11.7.0
Glass Electron：44.8.0，实际启动与自动化测试通过
DSH CLI 版本：bundled `dsh.cmd`=0.2.0-rc.2；app.asar 内 `dsh-desktop-host/lib/cli.js` --version=0.2.1-rc.2（2026-10-18 实测），不在当前 PATH
DSH Desktop 版本：0.2.1-rc.2（CLI 实测；安装包文件版本未复核），D:/DSH
DSH Git SHA / tag：安装包 commit 未知；参考公开 master=1517a4dbca0a2789ff1d41ba439600f8547d23fa
运行模式：官方 Desktop 已安装；本轮使用 bundled CLI 隔离 Web Profile 测试，并以 app.asar 内 host CLI 做真实 Host 实装联调
Profile：项目 .local-dsh-probe/profiles/web（独立 DSH_HOME，不改用户原 Profile）
核心源码签名校验：PASS，安装包 JS 行为+哈希；未提供 .d.ts，本机 Session 回调实测
真实 todo 事件：PASS，官方 Runtime 的人工夹具 3→2，并已在 Glass 内实装同步（`pnpm test:live`）；非模型任务
真实 Host 认证/观察链：PASS（2026-10-18，隔离 DSH_HOME）：`/connect?interactions=answer` 302+独立 operator Cookie → `session/list` → `remote.mux` → Todo 快照，断开清理与错误 token 拒绝通过；见 docs/evidence/live-dsh/result.json。样例会话为 idle/cold 夹具，不是模型驱动 Agent。
Desktop 插件装载：BLOCKED / 未实测
Approval ownership：BLOCKED / 未注册回答者；真实 Host 上无审批投递
Structured question ownership：BLOCKED / 未注册回答者
备注/复现步骤：见 integration-matrix.md、local-source-signatures.md、evidence/dsh-web-probe.txt
```

请按可复现证据填写，不可从网页最近版本号推定用户当前的安装版本。

### 2026-10-22 首次启动修复复测

Node 24.15.0、工作区 Electron 44.8.0；本机系统 curl、tar、Windows PowerShell/WPF 实际参与隔离首次启动复测。受控下载中断/503、Range 续传、失败重试、真实 Electron 启动和销毁通过；21 文件187测试、lint/typecheck/build 通过。只读取安装版插件公开源码与缓存 manifest/version，没有修改用户 DSH Profile，也没有重新验收真实 Desktop 模型任务或审批所有权。完整方法和边界见 [首次启动恢复](first-run-recovery.md)。
