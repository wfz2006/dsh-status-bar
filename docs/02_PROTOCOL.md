# 02 — DSH Glass 本地通信协议（项目自定义，不是 DSH 原生 API）

**重要**：本文的 `glass.*`、`session.*`、`approval.*` 消息均为本项目**自定义传输协议**。不可将其当成 DSH 官方事件名或现成接口。DSH 原始事件在 Adapter 内转换。

## 1. 传输规范

- 默认 transport：单机 `ws://127.0.0.1:<ephemeralPort>`，端口由系统分配；Windows 用户目录或 Main-Bridge 已认证本地 IPC 传递地址和认证 token，永不暴露给 renderer。
- Bridge 限制可接入客户端、请求来源、最大 payload（建议默认 256 KiB；工具详情应按需分页）、并发与每秒消息频率；超过限制断开连接并记审计日志（脱敏）。
- 统一 envelope：`protocolVersion`, `messageId`, `kind`, `sentAt`, `runtimeId`, `epoch`, `payload`；命令响应额外 `correlationId`。
- `epoch` 是 Bridge 生命周期/源会话投影代数（启动及不可恢复重置时变化），与 source 的 `seq` 分离。
- 所有事件源数据都必须通过 Zod schema 校验并转换成 ViewModel；不能把 Cordis 运行时引用序列化到 UI。

## 2. JSON envelope 样例

```json
{
  "protocolVersion": 1,
  "messageId": "msg-48",
  "kind": "session.todo.snapshot",
  "sentAt": "2026-10-17T01:00:00.000Z",
  "runtimeId": "runtime-local-a",
  "epoch": "epoch-b138",
  "payload": {
    "sessionId": "s-001",
    "sourceSeq": 181,
    "todos": [
      { "content": "分析性能瓶颈", "status": "completed" },
      { "content": "优化 Tiling 参数", "status": "in_progress" },
      { "content": "执行回归测试", "status": "pending" }
    ]
  }
}
```

该样例是**Mock 数据**。

## 3. 参考类型（实现时必须以 Zod schema 为唯一运行时校验来源）

```typescript
type ConnectionState =
  | 'connecting' | 'connected' | 'reconnecting'
  | 'disconnected' | 'incompatible';

type TransportCapabilities = {
  observeSessions: boolean;
  observeTodos: boolean;
  observeTools: boolean;
  respondApproval: boolean;
  respondQuestion: boolean;
  supportsNativeAcrylic?: boolean; // 由桌面客户端能力汇报
};

type Todo = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

type SessionView = {
  runtimeId: string;
  sessionId: string;
  workspaceLabel?: string;
  title?: string;
  connectionState: ConnectionState;
  agentStatus: 'running' | 'idle' | 'unknown';
  phase: 'working' | 'waiting-approval' | 'waiting-question'
    | 'finished' | 'limit-reached' | 'error' | 'cancelled' | 'archived' | 'unknown';
  todos: Todo[];
  lastEventAt?: string;
  lastSourceSeq?: number;
};

type ApprovalView = {
  requestId: string;
  runtimeId: string;
  sessionId: string;
  toolName: string;
  callId?: string;
  reason?: string;
  commandPreview?: string;   // 安全脱敏后，由已验证源提供
  displayDetails: 'complete' | 'partial' | 'unknown';
  status: 'pending' | 'submitting' | 'allowed-once'
    | 'rejected' | 'cancelled' | 'unavailable' | 'expired';
  actionable: boolean;
  createdAt: string;
  sourceEpoch: string;
};

type UserQuestionView = {
  requestId: string;
  runtimeId: string;
  sessionId: string;
  questions: Array<{
    id: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
    allowCustom?: boolean;
  }>;
  actionable: boolean;
};
```

`ApprovalView.actionable` 只能由 Bridge 的已验证所有权与请求有效性状态计算，UI 不得自行设 true。

## 4. 消息清单

| kind | 方向 | payload 关键字段 | 说明 |
|---|---|---|---|
| `glass.hello` | desktop→bridge | protocolVersion, clientNonce | 握手，认证通过后获取能力 |
| `glass.welcome` | bridge→desktop | runtimeId, epoch, capabilities | 版本和能力确认 |
| `glass.heartbeat` | 双向 | monotonic counter | 存活检测；时钟不作排序依据 |
| `glass.snapshot.request` | desktop→bridge | reason | 首连/断层时取全量 |
| `glass.snapshot` | bridge→desktop | sessions, approvals, questions, lastSeq map | 原子投影快照 |
| `session.updated` | bridge→desktop | sessionId, sourceSeq, fields | 顺序状态更新 |
| `session.todo.snapshot` | bridge→desktop | sessionId, sourceSeq, todos | 整表替换 |
| `session.tool.activity` | bridge→desktop | sessionId, sourceSeq, toolName, callId, summary | 脱敏工具事件 |
| `session.note` | bridge→desktop | sessionId, note {id, kind, text, sourceSeq} | 思考/正文转录，追加去重 |
| `approval.requested` | bridge→desktop | ApprovalView | 待审批/仅观察状态 |
| `approval.respond` | desktop→bridge | requestId, sessionId, epoch, decision | 用户意图，不直接代表批准成功 |
| `approval.ack` | bridge→desktop | correlationId, requestId, status, outcome? | 实际结果/不可用状态 |
| `approval.resolved` | bridge→desktop | requestId, outcome | 异步请求结束（来源验证） |
| `question.requested` | bridge→desktop | UserQuestionView | DSH 提问 |
| `question.respond` | desktop→bridge | requestId, answers | 结构化回答意图 |
| `glass.error` | bridge→desktop | code, correlationId?, safeMessage | 安全错误解释 |

## 5. 初始同步与重连算法

1. Renderer 通过受限 preload 请求连接；Main 负责 token 握手。
2. Bridge 返回 `glass.welcome`；校验协议版本与已验证 capabilities。
3. Client 发出 `glass.snapshot.request`；收到 `glass.snapshot` 后**原子替换**本地 runtime 投影。
4. 只接收当前 epoch 和 runtimeId 匹配的增量。按 Session+源序号去重；**只有源头提供完整连续的 Session 事件流时**才可以将序号 gap 视为丢消息并触发重拉快照。如果只订阅 `todo/write` 等过滤后的事件，非连续序号是正常现象，必须改用独立的传输连续序号或按需重拉快照。
5. 如果底层 DSH 事件不是连续序号，Adapter 必须提供单调本地序号与可恢复语义，不能伪称原生 `seq`。
6. 断线立刻将全部审批置为不可操作、状态标为 stale；丢弃所有本地未发送意图，重连后不得自动重发“允许”。
7. 重连后从 authoritative pending set 重建请求队列；已经结束/失去所有权的审批不能出现为 actionable。

## 6. 审批事务约定

客户端提交：

```json
{
  "protocolVersion": 1,
  "messageId": "msg-approve-123",
  "kind": "approval.respond",
  "sentAt": "2026-10-17T01:00:03.000Z",
  "runtimeId": "runtime-local-a",
  "epoch": "epoch-b138",
  "payload": {
    "sessionId": "s-001",
    "requestId": "approval-009",
    "decision": "allowed-once",
    "clientCommandId": "client-cmd-91"
  }
}
```

- 这里的 `requestId` 是 DSH Adapter 映射过来的**真实审批请求身份**，不同于 `callId`；不能混用。
- 用户点击后 UI 立刻禁用按钮，进入 `submitting`；Bridge 校验所有权/有效性/幂等键/来源会话/epoch。
- `approval.ack status='accepted'` 只代表 Bridge 已接受意图，**不是 DSH 已允许**。只有官方 answerer 回调已完成并证实 outcome 后才能发送 `resolved`。
- 桥接端处理失败须返回 `rejected-by-bridge`（协议错误含义，不等同于 DSH `rejected`），不得伪造 `allowed-once`。
- 客户端超时后显示“状态未确认，请在 DSH 中核实”；绝不自动重试允许请求。允许请求在任何条件下都不得跨 epoch 重放。

## 7. 显示和隐私

- `commandPreview` 是 UI 摘要，不作为批准操作的唯一信息来源；若不完整，必须有按需读取的完整、可验证详情入口或禁用审批并跳转 DSH。
- 工具调用/参数在日志、缓存、WebSocket 和通知中执行最小化及脱敏；不应在通知预览显示环境变量密钥。
- 大型日志限制长度并裁剪，以受控主动请求加载详情。

## 8. 版本协商

当前开发协议 `protocolVersion = 1`。主版本不一致时 `ConnectionState='incompatible'`，禁止控制操作但允许显示可识别错误。协议字段做向前兼容时新增可选字段；更改含义必须升版本。

## 9. 当前实际实现子集（更新于 2026-10-18）

`SessionNote.streaming?: boolean` 是向前兼容的显示标记：`true` 表示本次连接收到的实时生成前缀；`false` 表示该行已由权威 `assistant/message` 替换，保留本地行 ID 防止详情折叠和重复入场；缺省为普通持久记录。实时前缀仍限制2000字符、每会话最多60行，不持久化，不用于工具参数、审批或问答授权。前缀的 `sourceSeq=startedAfterSeq+1` 只用于相对排序，不是持久事件的序号声明；正式消息替换时改用实际事件seq。官方 `assistant-stream.revision/index` 与本地投影版本独立处理；序列缺口丢弃前缀，重连使用官方快照恢复，不拼接不完整后缀。

`packages/protocol/src/index.ts` 的 Zod 是运行时定义。实现 welcome/snapshot/heartbeat、session.updated/todo.snapshot/tool.activity/note、approval.requested/resolved、question.requested/resolved 与用户回答请求。会话阶段区分运行、等待审批/问题、完成、达到输出上限、失败、取消、归档和未知；idle 或未知终止原因不推断成功。Mock Adapter 保持回答能力关闭；DSH 的连接能力也不使任意请求可操作，Main 与 Adapter 还会校验 runtime/epoch/session/request、参数完整性、当前 owner delivery 和重复提交。

客户端握手使用受认证 WS 的精简控制帧 `{kind:'glass.hello',protocolVersion:1,clientNonce}`；快照请求为 `{kind:'glass.snapshot.request',reason}`。这些**控制帧没有服务端事件 envelope**；token 仅在 Main 的 Authorization header，renderer 无 WS/凭据。服务端事件使用本文标准 envelope。

快照包含 `sessions`、`approvals`、`questions`，每个 Session 内含 `lastSourceSeq`、最多 100 个 `activities` 与最多 60 条转录摘要。Session 显示值 title/workspaceLabel/activities 缺失时使用 Adapter 显式默认值，不透传原生对象。

初始/重连：hello → welcome → snapshot.request → snapshot，快照仅在连接同步阶段接受；已连接后不接受迟到的旧快照。正常刷新需重新进入同步阶段。过滤事件序号跳号正常，不推断丢包；旧/重复序号、不同 runtime/epoch 拒收。重连保留旧内容并标 stale，收到新快照后原子替换。

本机 Bridge 以 loopback 和单客户端传递最小投影，不暴露 DSH Cookie/token。适配器由 Main 使用用户提供的根认证 URL token 换取官方 `/connect?interactions=answer` operator Cookie，再通过 HTTP RPC 与 `remote.mux` 订阅状态。`$events/result` 返回 void 只代表投递；审批等待匹配 `approval/decided`，问题等待 durable settled 投影，超时则 unavailable。合同测试已验证这些规则；真实模型审批/问答与官方 Desktop 用户任务仍未验收。

## 10. 独立的桌面光学IPC（不进入DSH协议）

现有 `glass:settings` 的本地窗口偏好新增 `tintColor`（六位十六进制色，默认`#000000`）、`tintOpacity`（整数0–100，默认10）、`brightness`（整数50–150，默认100）。Main验证颜色格式、拒绝非有限数字并限幅，旧配置补默认值，沿用本地JSON保存。它们不进入Bridge或DSH事件协议，也不会启用屏幕取样。亮度只调整玻璃背景合成组；文字与亮边独立。

窗口偏好的旧`material: acrylic`只作向后兼容输入；规范化为`transparent`，避免已证实的系统Acrylic方角。未新增renderer权限或原生窗口句柄接口，DSH协议与审批能力不变。

已有 `glass:move` 仍仅接受 x/y。Windows Main 转为物理坐标，通过固定本窗 HWND/PID 的助手 `--position` 模式移动并等待确认；原生 SWP_NOSIZE 避免 DPI 尺寸回写增长。此模式不取样，空闲退出，隐藏/最小化/关闭停止；不提供 renderer 指定 HWND 的能力。

用户明确授权后新增：`getOpticsState`、`setOpticsEnabled(boolean)`、`subscribeOpticsState`、`subscribeOpticsFrame`。仅受信主frame可调用；renderer不能指定取样HWND、PID或矩形。普通启动在原生助手可用且非实色材质时默认开启，可在本次运行关闭；该开关不持久化。隐藏暂停、显示恢复，退出或切换实色停止。

Main给助手固定本窗HWND/本进程PID；助手校验owner、可见性与WDA_EXCLUDEFROMCAPTURE，读取物理矩形加24 DIP（最多48物理px）边距。私有管道为40字节DSHG头+定长RGBA；移动后取样不覆盖当前窗才发送DSHS跳帧。Main再次验证长度/边距，并仅在完整覆盖时重投影、裁剪到当前窗每侧最多48物理px。单向`subscribeOpticsPosition`在移动/缩放时通知当前物理矩形，画布按世界坐标调整，无覆盖即隐藏旧纹理。单帧24MiB上限、单帧在途，主窗隐藏/关闭/异常停止。帧只在Main→本窗renderer本地IPC内传递，不经Bridge/WS，不写文件或网络，不包含审批授权能力。

## 11. 本地业务投影 IPC（2026-10-21）

这层只压缩 Main 已接受的 `Projection`，不修改 Host/Bridge 帧、认证、审批身份校验或 `GlassAPI` 的返回类型。`glass:state` 内部返回 `{kind:'snapshot',revision,projection}`；preload 解包后，`getState()` 和订阅仍提供完整 `Projection`。

`glass:update` 使用快照或 `{kind:'delta',revision,baseRevision,fields,sessions,removed,seen}`。`sessions` 只包含发生变化的会话，`removed` 删除会话；请求数组改变时整体替换，绝不合成请求权限。`seen` 追加尾部 ID，失去重叠时整体替换。传输 revision 独立于 DSH 事件 seq，严格按 baseRevision 衔接；丢帧时先让界面 stale、请求不可操作，再重新获取完整基线。重复/迟到消息忽略；换 runtime/epoch、显示隐藏窗口及每 300 次更新发送完整基线。隐藏期间保留 Main 最新投影，不主动推送业务更新。

preload 在结构化克隆后复用字段完全相同的 Todo、活动与摘要对象，以减少 React 无效工作；不以对象身份判断审批授权。renderer 无额外 Node/文件/网络权限。

Adapter 每种请求保留最多 100 条已结束历史，未结束请求不因历史增长被裁掉；投影的 100 项请求窗口优先保留未结束项。工具参数摘要按会话最多 256 项，当前待审批调用另行保护；会话删除、断线会清理相关缓存。真实 turn 边界让遗留请求 unavailable；历史 follow 快照原子回放，只发布最终状态，不能因中间历史终态撤销当前 delivery，也不能恢复已结束请求的操作权。

Host 实时物理通道以 15 秒 Ping/下一周期存活检查检测半开连接；正常流量也可证明连接仍活着。单会话 audit 子流结束会撤销其请求并在会话列表确认仍可用后重新订阅，不关闭其他子流。列表暂时失败以 10–60 秒退避重试；认证失败或关键子流结束仍断线，禁止自动重放一次性 token。
