# ADR 004：通过官方认证 Host 接入 DSH

日期：2026-10-18。目标安装版本：DeepSeek Harness **0.2.1-rc.2**，Windows 文件版本 0.2.1.0。早期资料的 0.2.0-rc.2 标签及根路径 303 认证并非当前独立 operator 合同。

## 决策与证据

从用户主动粘贴的官方本机 Host 根链接取得一次性 token。仅接受 loopback HTTP(S)，由 Main 向同源 `GET /connect?token=…&interactions=answer` 兑换**独立 operator Peer**，手动检查 302、同源 `/api/remote.mux` Location 与 Cookie。Cookie 只留在 Main 内存；不使用浏览器根路径 303 登录态，不共享或读取 Desktop 的认证文件。通过官方 unary RPC 和 `/api/remote.mux` 观察会话及响应请求；不修改安装包、原有 Profile 或 answerer 注册。

已读取本机 `D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/` 的以下源码：

- `dsh-client-connection/lib/index.js:499–538,755–790`：`/connect` 独立 operator 认证；显式 `interactions=answer`，WS 关闭即销毁此 Peer，重新连接必须重新兑换。
- `dsh-api-gateway/lib/types/typert.remote-client.js:1108–1125`：`session/list` 参数 `_request`。
- `dsh-api-gateway/lib/index.js:961–985,1013,1105`：`$events` 检查 `requireInteractions(answer)`；仅 owner answer 客户端收到 waterfall，答复必须属于相同 Peer/clientId/eventId。`$events/result` 的 RPC 返回值是 **void**，仅表示已投递，不是决议确认。
- `dsh-api-session-controller/lib/index.js:1475–1496,1589`：`session/page` 使用只读 source，不 promote；`session/follow` 会 promote。因此只 follow 列表明确 `agentAvailable=true` 的 live 会话。冷历史仅在取得真实 `asOfSeq` 后用 `session/page` 读末尾边界，否则终态保留 unknown，不能把 `turnBoundary.lastTurn` 轮次数字当成完成证明。
- `dsh-agent-loop/lib/index.js:681,790–798`：工具结果关联及 idle/running；空闲不能单独证明任务完成。
- `dsh-user-questions/lib/index.js:170`：continued 问题可继续回答；使用正式 `userQuestions/answer`，不能复用已取消的 Remote Event。
- `dsh-api-workspace-controller/lib/index.js:66`：归档列表与变更。

这替代早期“必须安装插件/独占唯一 answerer 才能接入”的假设。共享 delivery 是官方机制：只订阅、不提交，不会抢答；用户明确点击时，使用当前 generation 的 clientId + eventId 提交。审批审计 ID、tool callId、Remote eventId 分开，不混用。

## 数据与控制边界

源连接信息仅暴露 mode、连接状态、纯 origin、固定错误文案。token/Cookie/eventId 不进入 renderer 投影、偏好、证据或日志；界面的 URL 输入仅为一次性提交。断线清除认证和操作能力，不自动重试授权。

审批同时通过 Main 与 Adapter 校验 runtime/epoch/session/request 身份、pending、完整可核实的工具参数、能力及连接。未知/截断/缺失参数保留只读；不提供始终允许。`$events/result` 仅投递后进入 submitting，必须等待匹配 `approval/decided` 的真实 allowed-once/rejected。其他客户端先处理、断线或 10 秒内没有匹配决议时变为 unavailable、禁用按钮并提示回 DSH 核对；不将超时当作成功。

提问校验题目、选项、单选/多选/自定义文本，禁止跨会话、旧请求和重复提交。有 durable callId 的提问提交后等待官方 userQuestions settled 投影；旧式无 callId 的 ask 没有可核对的持久回执，保留只读。timed wait 取消并不等于问题过期：保留 pending，重新读取权威投影；continued 通过 `userQuestions/answer({agentId,callId,answer})`，仅 boolean true 表示该正式接口确认接收，不能复用取消的 Remote eventId。DSH 自身还会验证运行时 root 所有权，不以历史 parentSessionId 推测 root。

## 验收边界

源码合同、模拟 Host 合同测试、独立 DSH Runtime 夹具、原有 Desktop 用户会话是四种不同证据。前三者不代替最后一种。默认启动为真实源未连接；Mock 仅显式演示或自动化测试使用。实际用户 Desktop 未连接验收前，不宣称其审批或问答闭环已实机通过。
