# 05 — 安全、测试与质量验收

## 1. 风险模型

受保护资产：用户工作区文件、DSH 工具执行权限、审批意图、Token 和凭证、Session/项目的归属关系、显示内容的真实性。

可能风险：

1. 本机其他进程连接 Bridge 伪造审批指令。
2. Renderer XSS 将外部工具文本当作 HTML 执行，窃取 token 或主动提交审批。
3. 一条真实请求被错误归入另一会话，发生跨会话批准。
4. 两个 UI 同时回答同一 DSH 审批，产生非确定性所有权。
5. 网络/桥接断开后老请求仍可点，或者客户端重连后重放“允许”。
6. 滥用工具命令摘要隐藏危险标志/路径，导致用户误批准。
7. DSH Desktop 更新后私有 API 变动，Glass 显示假实时数据。
8. 过度背景动画导致性能、热量和风扇负担。

## 2. 强制安全控制

### 鉴权/IPC

- 只绑定 loopback，令牌随机生成、限制生命周期、仅由 Main 持有。
- 对 WS Upgrade 校验可信来源（Origin 若存在）、本机连接和一次性握手；浏览器环境中的跨站 WS 连接不得复用凭据。
- 支持客户端 capability 权限隔离；默认观察，只有 `respondApproval` 且通过服务端二次校验才允许提交。
- 消息 Schema 校验、防重放 clientCommandId、大小和频率限制。
- Electron `webPreferences` 使用最小权限：`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`；禁用不受信任的导航/新窗口/任意外部协议，校验 IPC sender 来源。

### 审批

- fail-closed：`cancelled`、`unavailable`、unknown、过期、断线，均不能批准。
- 明确语义：Bridge 已收到命令 ≠ DSH 已批准。
- 授权须由真实用户点击触发；不得默认聚焦“允许”。
- 绑定真实 requestId、source epoch、runtimeId、sessionId、调用所有权；校验请求未撤销。
- 多次点击同一 requestId，服务端最多向官方 answerer 应答一次；并发请求互不混淆。
- 参数展示必须遵循 DSH 已经发出的工具调用，不合成假参数；必要时强制回到官方 UI。

### 隐私

- 日志不输出完整命令的所有 env、API Key、OAuth token、cookie、Authorization header 等。
- Renderer 默认只接收脱敏 Preview；不得把完整会话存放在配置文件或崩溃日志。
- 由用户显式触发“复制命令/详情”才允许写剪贴板；不能上传分析遥测。
- 个人项目名可能含私密信息，通知预览可配置只显示“某任务需要审批”。

## 3. 测试工具建议

- 单元测试：Vitest + Zod schemas + 纯状态 reducer。
- 组件测试：React Testing Library、键盘导航测试。
- Windows 桌面集成：Playwright Electron 或适合 Electron 版本的自动化方案 + 手工 OS 行为验证。
- Mock 工具：可确定性地发事件，支持断线、延迟、重复、乱序、跨 Session、巨大日志、空列表。
- 集成：单独创建 DSH Web/Desktop 安全测试会话。不得在真实敏感工作项目上跑带写入效果的审批测试。

## 4. P0 场景测试矩阵

| ID | 输入/场景 | 必须达到的结果 |
|---|---|---|
| T-01 | 首次启动，DSH 未运行 | “未连接/尚无会话”，不能出现假进度 |
| T-02 | Todo 完整写入 A,B,C，之后只写 A,C | B 立即消失，不残留 |
| T-03 | 两个 Session 同名 Todo | 互相独立；切换时不串数据 |
| T-04 | 多个 Todo 同时 `in_progress` | 全部正确展示，不强行选择唯一项目 |
| T-05 | Todo 全 `completed`，Agent 仍工作 | Todo 标记完成，不能误判整个运行已结束 |
| T-06 | 先收到较新 `sourceSeq`，后收到旧值 | 旧值不会覆盖新值 |
| T-07 | 序号出现 gap / epoch 改变 | 重新取快照；交互临时禁用 |
| T-08 | DSH Bridge 断开/休眠 | 状态标 stale；审批按钮即时禁用 |
| T-09 | 收到审批但 control capability=false | 只读卡片；显示“在 DSH 中处理” |
| T-10 | 允许一次后实际 outcome 未确认 | UI 只显示提交中或未确认，不显示已批准 |
| T-11 | 重复点击允许 / 多窗口发同一意图 | 只执行一次或被拒绝重复，绝不多次放行 |
| T-12 | `cancelled/unavailable` 之后点击 | 后端拒绝，UI 提示请求已失效 |
| T-13 | Session A 请求，Session B 窗口误发 | Bridge 拒绝，不能影响 A/B 工具 |
| T-14 | 连接陌生本机进程，不带 token | 连接拒绝，审批不能提交 |
| T-15 | 用户输入脚本/HTML 注入文本 | 被安全当作文本显示，不执行 |
| T-16 | 无法查到完整工具参数 | 明示详情不完整；不能误标为安全操作 |
| T-17 | Glass 退出后重启 | 位置/尺寸合理恢复；旧审批不自动提交 |
| T-18 | DPI/外接屏变更 | 窗口始终可见，不超出安全 workArea |
| T-19 | Windows 11 Acrylic 不可用 | CSS 降级，无黑屏透明失效 |
| T-20 | 卸载 DSH Adapter / DSH 更新 | Glass 进入兼容性/未连接状态，禁用交互 |

## 5. 控制能力最终端到端测试

必须在真实 DSH 目标版本上执行：

- E2E-A：触发单个真实待批请求，Glass 允许一次；等待官方 `approval/decided`，验证工具**只执行一次**。
- E2E-B：触发真实待批请求，Glass 拒绝；验证工具未执行。
- E2E-C：Glass 收到请求后断连、重启、回到主 UI；证明不会发生自动批准，DSH 有明确可恢复路径。
- E2E-D：Desktop 内置 UI 同时打开时，原 UI 和 Glass 不竞争、不出现两个有效 decision。
- E2E-E：撤销中的请求与 Glass 点击发生竞态时，系统 fail closed。

其中任何测试不通过，`respondApproval` 标记 false，发布说明不能宣称支持桌面审批。

## 6. 质量/性能门槛

记录**真实测量结果**（指标需在开发机上实测）：

- 进程空闲/活跃 CPU、工作集内存、GPU 使用、悬浮窗重绘频率。
- 页面最小尺寸下文字可读、拖拽时没有卡死/布局爆炸。
- WebSocket 高频事件（例如每秒数十条）时使用合批 UI 更新，仍可正常操作审批。
- 防通知风暴，避免因工具调用产生大量 Toast。
- Windows 缩放和工作区多屏。对原生材质+窗口透明组合提供截图/手动确认记录。

## 7. 测试记录模板

```text
Build:
OS + DPI:
DSH version + profile:
DSH source commit:
Glass version:
Scenario ID:
Prerequisites:
Steps:
Expected:
Actual:
Evidence path:
Pass/Fail/Blocked:
```
