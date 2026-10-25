# 工具步骤与完成状态同步修复（2026-10-23）

针对“过程窗口的工具步骤、完成状态明显落后 DSH 主窗口”，本轮修复了实时订阅等待、旧异步响应覆盖新状态，以及工具行入场淡入延迟。源码已构建；没有修改已安装 DSH、用户 Profile 或安装版插件缓存，也没有发布新版。

## 根因与修复

1. **冷会话恢复运行仍等待列表轮询。** `api-session/status(id,true)` 已证明真实 Agent 正在运行，但原代码没有更新 `live`，随后的 `follow(id)` 被自身保护条件挡住。直到下一次 10 秒 `session/list` 才开始收工具/终态事件。现在收到该原生信号立即更新可用性并订阅，仍不订阅没有 Agent 的冷历史。
2. **旧列表响应覆盖实时状态。** 原 `knownAtStart = new Map(sessions)` 仅保存对象引用，而 Session 原地更新，异步 RPC 返回时无法检测其中的新事件。现在同时保存对象身份和本地 revision；已收到较新事件的会话不再接受旧列表行。重复的原生运行状态也推进本地 revision，避免“状态文字相同”时漏掉保护。
3. **冷历史的旧完成记录覆盖新一轮工具。** `session/page` 等待期间会话可能已恢复运行。现在核对同一连接、同一会话对象、同一 revision 及当前可用性，丢弃迟到页面；新一轮运行清理旧冷读取标记。
4. **工具行已到达 DOM，仍被淡入动画遮住。** 原来工具行沿用 260ms 入场动画；现与实时文本行一样，在首帧直接显示。窗口整体的展开/收起动画保留。

完成仍以正式 `turn/end` 的 reason 为准；`api-session/status(false)` 仅表示 idle，不能推断 completed。未知终态、取消、错误、达到输出上限和审批撤销仍走原状态机。没有增加自动批准、缩短授权确认超时或降低光学画质。

## 目标版本依据

本轮通过已安装 Electron 的只读 ASAR 文件接口核对 **DSH 0.2.1-rc.2**：

- `dsh-api-session-controller/lib/index.js:2991` 从 `agent/status` 的真实 Agent 发出 `api-session/status(agent.id,status === 'running')`。
- 同文件的 `agent/created`、`agent/disposed` 会发布带 `agentAvailable` 的 `api-session/added`；但不能依靠该通知补回建立订阅前已经错过的状态。
- `session/follow` 对 `session/event` 逐条排队、唤醒并按序发送；没有 10 秒工具事件节流。因此这次修复建立实时订阅的时机，保留低频列表作为库存兜底。
- 官方工具结果按模型顺序提交为 `tool/result`；没有为追求更快而提前推断工具成功或最终完成。

对应源码 SHA-256 与公开源码副本保存在本机 `reports/process-sync/installed/`，不含用户 Profile、密钥或聊天。探测脚本为 `scripts/probe-process-events.cjs`，必须通过 Electron 的 Node 模式传入安装版 `app.asar` 绝对路径。

## 前后对照

在同一机器、生产 Electron、150% DPI 上，用官方格式合成 Host 驱动真实 Adapter → Main → preload → React。窗口可见但未获焦，开启原生取样及完整 RGB 折射；一个初始无 Agent 的会话收到运行事件后，依次执行 12 个工具（24 个 running/success/error 状态），最后发正式完成事件。没有调用真实模型，也没有使用用户会话。

| 项目 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 原生 running 事件 → 实时订阅建立 | 8,730 ms | 19 ms |
| 工具事件 → DOM，中位数 | 26 ms | 25 ms |
| 工具事件 → 动画帧机会，中位数 | 26 ms | 26 ms |
| 工具事件 → 行完整不透明，中位数 | 245 ms | 26 ms |
| 工具行完整显示，P95 / 最大值 | 249 / 251 ms | 30 / 34 ms |
| 正式 turn/end → completed 状态观察 | 150 ms | 140 ms |

上述工具行指标涵盖 24 次状态。原本已有订阅时 DOM 的速度本就不慢；主要改进在于消除开始订阅的秒级等待，以及首行可读前的淡入。先只修订阅的隔离实验已把订阅降到 18ms，但行完整显示仍约 245ms，证明两处开销独立。原始对照构建与结果分别为 `reports/process-sync/before-app/`、`before.json`、`after-status-only.json`、`after.json`。

这是受控 Host 下的 DOM/动画帧机会测量，**不是用户真实 DSH 与悬浮窗的同时录屏，也不是 GPU 实际呈现帧率**。本轮没有证据支持关闭所有后台节流，因此没有增加常驻后台渲染开销。

## 验证记录

旧任务表此前已移除，本轮在此保留检查项。

- [x] 原生 running 冷会话回归测试：修复前 500ms 内始终未订阅，修复后直接跟进工具与完成；false 不订阅、不冒充完成。
- [x] 旧列表响应覆盖新状态的测试：修复前退回 idle，修复后保留 running；有/无新增工具事件均覆盖。
- [x] 迟到冷历史测试：修复前把新一轮工作误标 finished，修复后保留 working。
- [x] `pnpm test:tool-latency`：未获焦、原生取样开启，12 次工具的状态和正式完成均更新，无页面错误。
- [x] `pnpm test:process-latency`：文本流式、200 片段突发、稳定行身份与最终提交回归通过。
- [x] `pnpm test:optimization`：隐藏/最小化恢复、三通道贴图和设置切换回归通过。
- [x] lint、类型检查、构建及 22 文件 / 210 项单测通过。
- [ ] 用户实际 Desktop 模型任务的同时对照尚未验收；已安装版需要更新到包含本轮构建的版本后才能生效。

复测：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:tool-latency
pnpm test:process-latency
pnpm test:optimization
```

人工验收：连接同一官方 Host，选中相同会话，在已有冷会话里开始一轮正常任务；让 DSH 主窗口获焦，保持悬浮窗详情“过程”页可见。比较工具开始、成功/失败、轮次正式结束三个时点；再测试取消、再次开始及隐藏恢复。审批仍只在用户明确点击后按原通道提交。
