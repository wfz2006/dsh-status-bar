# 目标版本接口核验

日期：2026-10-17。核验了本机 **0.2.0-rc.2 安装包中的 JavaScript 实现**。未修改 ASAR；通过已安装 Electron 的只读 ASAR 文件 API 检查。安装包声明的 `.d.ts` 文件未随包提供，不能声称本地类型编译已通过。

证据文件 `docs/evidence/installed-signatures.json` 保存包名、版本、精确文件路径、SHA-256 和选定代码片段；不会读取用户聊天、模型配置或凭据。复现脚本：`scripts/probe-installed.cjs`，需要以官方 Electron 的 Node 模式运行。

| 位置（相对 `D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/`） | 本地已确认行为 |
|---|---|
| `dsh-session/lib/index.js`，`append(type,data,...opts)` | `seq` 取当前 log 长度；`callbackArgs=[this,event]`，先 `log.push(event)` 后发布 `session/event`，监听参数为 `(session,event)` |
| `dsh-session/lib/index.js`，SessionStore | `create(id,options)` → prepare/enter/announce；用于隔离 Web 夹具 |
| `dsh-tool-todo/lib/index.js` | `exec.agent.session.append('todo/write',{todos})`；statuses=pending/in_progress/completed；每次携带完整列表 |
| `dsh-user-approval/lib/index.js` | `ctx.waterfall(scopeTarget(req.agent,req.agent),'approval/request',req, fallbackUnavailable)`；异常/未知 outcome 归一为 unavailable，abort→cancelled |
| `dsh-user-questions/lib/index.js` | 独立 `user-questions/request` waterfall；无 answerer 为 NO_PROVIDER，不与 approval 合并 |

安装包尚不能反向给出可靠上游 commit；**安装包版本与上游 master 不等价**。同时查询的公开源码快照为：

`1517a4dbca0a2789ff1d41ba439600f8547d23fa`（2026-10-17 的 master 查询结果）。

可复核的官方签名：

```typescript
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
'approval/request'(this: Scoped<Agent>, req: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
'user-questions/request'(this: Scoped<Agent>, request: AskUserQuestionRequestEvent,
  next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>
```

上述类型文本来源是[官方 Session 文档](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/docs/subsystems/session.md)、[审批文档](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/docs/subsystems/approval.md)、[提问文档](https://github.com/deepseek-ai/deepseek-harness/blob/1517a4dbca0a2789ff1d41ba439600f8547d23fa/docs/subsystems/user-questions.md)。在本机直接验证了 Session 的实际回调，但没有注册或测试审批回答者。

## 仍缺少的证据

1. 官方 Desktop 插件管理器在隔离 Profile 中安装并启用正常发布 bundle。
2. Desktop 当前 UI 的 answerer 与 Agent 所有权绑定及显式委派。
3. 真实模型任务进入 Glass 的事件、初始状态快照、重连、后台生命周期。
4. 跨进程 Adapter 服务、只读权限鉴权及进程退出恢复。

当前 `packages/adapters/dsh/src/index.ts` 仅提供明确的 BLOCKED 能力描述；`probe/` 是可复现诊断插件，不是生产 DSH Adapter。
