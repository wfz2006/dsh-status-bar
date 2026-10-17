# ADR 004：通过官方认证 Host 接入 DSH

日期：2026-10-18。目标安装版本：DeepSeek Harness 0.2.0-rc.2；`app.asar` 内 `dsh-desktop-host` CLI 实测 0.2.1-rc.2（认证/RPC/`remote.mux` 路径未变，2026-10-18 实装联调复测）。

## 决策与证据

从用户主动粘贴的官方本机 Host 根链接建立连接。认证 GET 仅接受本机 HTTP(S)，手动检查 303 与同源 Location，Cookie 只留在 Main 内存。通过官方 unary RPC 和 `/api/remote.mux` 观察会话及响应请求；不修改安装包、原有 Profile 或 answerer 注册。

已读取本机 `D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/` 的以下源码：

- `dsh-client-connection/lib/index.js:388–410`：token 到 Cookie 的认证。
- `dsh-api-gateway/lib/types/typert.remote-client.js:1108–1125`：`session/list` 参数 `_request`。
- `dsh-api-gateway/lib/index.js:809–947`：`$events` pending 重放、共享 delivery、世代 clientId、result 和取消。
- `dsh-api-session-controller/lib/index.js:1521–1524,2899–2910`：follow 冷会话会恢复 Agent，因此只 follow 列表确认已活跃的会话；历史只读投影。
- `dsh-agent-loop/lib/index.js:681,790–798`：工具结果关联及 idle/running；空闲不能单独证明任务完成。
- `dsh-user-questions/lib/index.js:170`：continued 问题可继续回答；使用正式 `userQuestions/answer`，不能复用已取消的 Remote Event。
- `dsh-api-workspace-controller/lib/index.js:66`：归档列表与变更。

这替代早期“必须安装插件/独占唯一 answerer 才能接入”的假设。共享 delivery 是官方机制：只订阅、不提交，不会抢答；用户明确点击时，使用当前 generation 的 clientId + eventId 提交。审批审计 ID、tool callId、Remote eventId 分开，不混用。

## 数据与控制边界

源连接信息仅暴露 mode、连接状态、纯 origin、固定错误文案。token/Cookie/eventId 不进入 renderer 投影、偏好、证据或日志；界面的 URL 输入仅为一次性提交。断线清除认证和操作能力，不自动重试授权。

审批同时通过 Main 与 Adapter 校验 runtime/epoch/session/request 身份、pending、完整可核实的工具参数、能力及连接。未知/截断/缺失参数保留只读；不提供始终允许。响应必须等待官方确认，不靠点击修改本地状态伪造通过。

提问校验题目、选项、单选/多选/自定义文本，禁止跨会话、旧请求和重复提交。失效 delivery 不可继续提交；continued 只走官方仍有效的 root 请求接口。

## 验收边界

源码合同、模拟 Host 合同测试、独立 DSH Runtime 夹具、原有 Desktop 用户会话是四种不同证据。前三者不代替最后一种。默认启动为真实源未连接；Mock 仅显式演示或自动化测试使用。实际用户 Desktop 未连接验收前，不宣称其审批或问答闭环已实机通过。
