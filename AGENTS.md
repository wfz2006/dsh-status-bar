# AGENTS.md — DSH Glass Codex 工程指令

你是此仓库的实现工程师，需严格遵守本文，优先保证可验证、可测试和安全失败，而非快速堆砌 UI。

## 0. 当前任务起点

- 本仓库最初只含规格文档。**从 `TASKS.md` 的 M0 开始**；一次只推进一个可验证里程碑。
- 开发第一步：读取 `README.md`、`docs/04_DSH_INTEGRATION.md`、`docs/06_EXECUTION_PLAN.md`、`TASKS.md`。
- 检测 Windows/Node/pnpm/DSH Desktop/CLI 环境与实际安装路径；版本写进 `docs/09_SOURCES.md` 的“本地验证记录”节。
- 如无法访问 DSH 源码或运行环境，使用 Mock Adapter 推进窗口/UI，但将真实接入标记 `BLOCKED`；**不得把 Mock 宣称为真实联通**。

## 1. 设计红线

1. 不更改官方 DSH 已安装应用、签名资源、Profile 数据或配置，除非用户明确授权且已提供恢复措施。
2. 不采集或上传用户的模型密钥、命令环境变量、全量聊天内容；默认仅做最小数据传输。
3. 不擅自添加“始终允许”或自动审批功能。唯有真实 `allowed-once` 才是授权成功。
4. `approval/request` 是 **waterfall**；未经实证不能旁路监听并抢占 Desktop 原有回答者。
5. 未验证 UI 所属 Session/Agent/请求身份之前，禁用审批按钮；断线/撤销/超时均 **fail closed**。
6. Todo 使用**整表快照**和**会话范围**，不能把同一个列表当作多个 Agent 共用。
7. DSH 事件签名来自目标版本源码与官方生成文档；自定义事件类型与 DSH 原生类型严格隔离。
8. Electron `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`；renderer 不直接访问 Node、文件系统或 WS token。
9. 不实现隐蔽后台进程、键盘记录、全局任意窗口抓取、未经授权端口服务。
10. 未经确认，不向用户或仓库文档声称已验证真实 DSH Desktop 审批功能。

## 2. 实施策略

- Monorepo：`apps/desktop`、`packages/protocol`、`packages/bridge`、`packages/adapters/mock`、`packages/adapters/dsh`。
- 所有网络帧进来后先 schema 验证，再交给 Store；UI 不解析原始 DSH 事件。
- Bridge 和 Adapter 不导入 React/Electron 渲染依赖；window API 通过窄 preload 暴露。
- 业务行为由纯函数和状态机实现；测试覆盖乱序、重连、重复点击、跨 Session 误路由。
- 可见 UI 文案中文优先；代码标识符、类型及关键日志使用英文。
- 为新增公共协议结构添加对应测试与 `docs/02_PROTOCOL.md` 更新。
- 视觉层优先 CSS/系统材质；性能预算无法达到时自动降级，不能掩盖错误或降低审批可读性。

## 3. 每个任务的 Definition of Done

- 实际代码/配置可运行，`pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（在脚本创建后）；未通过要标出根因。
- 新行为配最小单元或集成测试；涉及窗口与审批需提供手动验证步骤。
- 修改 `TASKS.md` 中对应项 `[ ] → [x]`，附一行验证证据；阻塞项仍保持 `[ ]` 并注明阻塞因素。
- 不将测试失败改成空断言；不使用 `any` 掩盖缺陷；不将鉴权检查删除以“先跑通”。
- 形成简短变更报告：新增文件、已验证能力、未验证能力、下一步。

## 4. 决策优先级

安全 > 数据正确性 > 主功能可用性 > 用户可控性 > 性能 > 液态玻璃炫技。

遇到 DSH 官方文档与本规格冲突：以**目标版本源码和可复现测试**为准，更新相应文档并给出证据；切勿硬套此文档的假设。

## 5. 禁止“假实现”

- 不能只播放循环进度动画冒充 Agent 工作；无状态时显示“尚无会话”或“未连接”。
- 不能用假按钮点击后修改 UI 状态来冒充已审批；必须等待 DSH 决议事件或明确 ACK。
- 不能以抓取网页 DOM 代替受控的正式接口，除非另行形成 ADR、明确风险并取得用户同意。
