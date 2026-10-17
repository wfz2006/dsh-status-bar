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
    | 'finished' | 'error' | 'unknown';
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
