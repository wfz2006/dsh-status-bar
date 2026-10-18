# 过程实时显示延迟修复 · 2026-10-18

根因：旧版调用 `session/follow` 时未传 `assistantStream:true`，也未处理 `assistant-stream` item。DSH 在生成过程中发布的text/reasoning delta因而未进入悬浮窗；界面只在 `assistant/message` 整段持久化后得到文本。固定16ms的Main投影合并不是主要等待来源，本次保留它以限制高频IPC。

## 变更

- `packages/adapters/dsh/src/assistant-preview.ts`：独立、按会话隔离的短文本前缀累积器，验证revision与chunk index，忽略重复，缺口丢弃，支持压缩/原始重连快照、block-end校正、Agent生命周期重置及同Agent多轮连续revision。
- Adapter：在已确认live的会话上开启实时流；合成显示用notes，不把前缀写入持久Session记录。正式消息使用实际事件seq与文本替换，沿用已显示块的行ID；断开、移除、轮次结束或attempt放弃时清理相应前缀。
- Protocol/UI：新增可选 `SessionNote.streaming`。生成中明确标注；完成保留已打开的详情，实时行及其完成替换不等待入场淡入，其他现有动效保留。文本变化后同步滚动渐隐。
- 提取既有FakeHost为 `tests/helpers/dsh-host.ts`，由合同测试与Electron验收共享官方格式，避免两套测试服务器行为漂移。新增 `pnpm test:process-latency`。

前缀每块最多2000字符、每会话最多60块，不保留工具参数片段。审批/问答仍只由原有匹配delivery及权威决议控制。玻璃材质、屏幕取样、轮步统计、窗口尺寸和16ms Main合并保持原设置。

## 验证与结果

1. 首先新增“正式消息尚未到达时显示思考前缀”Host合同回归；旧实现500ms超时，文本仍undefined。修复后通过。另用多轮回归发现首次实现错误清空revision的问题，观察第二轮停在旧文字，修正为仅清理active前缀、保留Agent revision后通过。
2. 142单测、15文件通过；`pnpm lint`、`pnpm typecheck`通过。
3. 桌面main/preload/renderer构建通过。`pnpm build`最初在写入运行中的 `apps/desktop/native/RegionCapture.exe` 时被Windows拒绝。本轮未改该C#源码，也未结束用户窗口；使用相同CSC选项编译到临时独立EXE成功（7680字节）。因此不声称原路径全量构建命令通过。
4. `pnpm test:experience`、`pnpm test:motion`通过。审批布局首次两次运行在“等待两项模拟请求”超时：Mock第二项由第8个1800ms定时器在14.4秒发送，原测试15秒截止且默认轮询间隔可达1秒。将验收脚本改为20秒预算/100ms轮询，保留全部两项队列和身份/失效断言，复测通过（250/320/340 DIP布局、队列选择、重连、fail-closed）。
5. `acceptance.json`：受控loopback Host发出20次片段，走实际WebSocket→Adapter→投影→Main IPC→React，全部在正式持久消息前出现在页面。Date.now跨同机进程测量至DOM变化及下一次requestAnimationFrame回调；帧回调延迟中位27ms、P95 33ms、最大40ms。每次opacity=1、入场animation=none。200片段突发推送保留全部200字符；结束放弃只删除实时前缀，已持久行保留。
6. 正式提交后只有一行，文本与seq来自权威消息，原有详情保持open，行ID不变，不重播入场。页面异常为空。

这些数字是当前机器上的合成Host回放，**不是用户当前DSH窗口与悬浮窗的同步录像，也不是GPU实际呈现耗时**。原版只等正式消息的行为由失败合同测试证明，没有虚构优化前的毫秒数。新会话已由现有`api-session/added`即时跟随，经合同测试确认，不提高十秒列表轮询频率。

`stream-settled.png`是受控背景下的renderer截图，只用于检查行状态和详情，不是原生桌面实拍。

## 本机官方合同依据（只读）

均为 `D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/<package>/lib/index.js`，版本0.2.1-rc.2：

| 包 | 行与用途 | SHA256 |
| --- | --- | --- |
| dsh-api-session-controller | 1297累积基线；1546订阅开关；1573快照；1604流消息；1658线格式；2980新Agent可用性 | A9801ACB577B03053C5D5A3191FF555C5F1D791D0ACDDEC113BEA4511E33B386 |
| dsh-agent-loop | 354实时attempt；1080广播；1156持久化后settle | CF57E3ECD487AC5C2553455AAA5CEF2C6FB41E6BD61BE5AA455675D1D7193033 |
| dsh-llm | 954块组装；1150压缩；1250展开 | D18D8AE4C8D961E628708C1E4698E09716A0EBB80E55A672E0BDE1029BEC1155 |

## 人工复核与运行范围

从仓库构建的新版桌面端重启后，连接原DSH，展开“过程”，开始一轮会产生思考/回复的任务：生成过程中应连续看到前缀和“生成中”，完成后同一行变“已完成”，手动展开详情应保持。再开始第二轮、切换会话并断开重连，确认前缀不串会话、不残留。真实模型任务和当前用户DSH的并排视觉验收尚未执行。

本次修复通过源代码提交交付；没有替换DSH已安装插件的运行包，也没有发布GitHub Release/npm版本。若实际运行的是已安装插件，其原有运行包仍需在后续更新时带入本次构建。
