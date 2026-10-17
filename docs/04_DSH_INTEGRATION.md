# 04 — DeepSeek Harness 接入规范与验证清单

> 依据 2026-10-17 可查询的官方文档制定。**接口在 DSH Developer/Public Preview 阶段仍可能变化**。Codex 必须在目标安装版本中再验证一遍。

## A. 已经由官方资料证实的能力

| 范围 | 官方行为 | 我们怎么用 | 重要限制 |
|---|---|---|---|
| Cordis 插件 | 插件可 `apply(ctx)` 并按 Profile 的 patch/bundle 装载 | 编写 adapter 插件 | 目标 Profile 必须真正加载，不能仅依赖文件存在 |
| `session/event` | 已持久化 Session 事件通过该 Cordis 事件广播 | 观察持久记录；检查 `event.type` | `turn/*`、`tool/call`、`todo/write` 是持久事件类型，不是都各有 Cordis 同名广播 |
| `todo/write` | 当前 Agent Session 的完整 Todo 列表，最近一次写入整体覆盖 | Todo Store 每次直接替换 | Todo Item 只有 `content`, `status`，**没有官方稳定 ID** |
| `agent/status` | 可观察 Agent 状态；具体签名须核对本机源码 | 辅助显示运行/空闲 | 不能仅凭它推断审批或模型仍在思考 |
| `approval/request` | waterfall，仅一个拥有者答复；缺省 fail-closed | 在符合所有权条件下接管一次请求 | 审批请求不携带工具完整 args，关联 `callId` |
| 审批 Outcome | `allowed-once`, `rejected`, `cancelled`, `unavailable` | 必须按官方值处理 | `allowed-once` 才是单次放行；其余均不放行 |
| `user-questions/request` | waterfall，回答结构化问题 | 可选的人类问题输入通道 | 其所有权同样要验证，不可和 approval 混为一谈 |
| DSH Desktop Profile | Electron 托管 `$DSH_HOME/profiles/desktop` | 通过官方内置插件管理能力加载插件 | CLI 不能随意启动/修改保留 profile；生产 Host 是 Desktop 私有实现 |

核对来源见 [09_SOURCES.md](09_SOURCES.md)。

## B. 尚未证实，必须通过 SPIKE 检查的内容

1. 官方 DSH Desktop 当前目标版本是否允许正常安装和激活 DSH Glass Adapter，并与 Desktop 自己会话共享运行时。
2. 插件能否在**不干扰现有官方 answerer**的前提下，合法委托或接管审批；是否需要特殊配置（且配置是否有可维护的公开接口）。
3. `approval/asked`/`approval/decided` 审计信息怎样与真实 pending 生命周期对应；仅审计事件并不足以变成可操作审批。
4. 是否存在可用且受支持的 Session 列表、会话完整快照、工作区/标题获取方式；没有则只展示得到保证的数据。
5. `agent/status`、`session/event` 精确处理函数签名、事件来源 seq 与 sessionId 的获取方式；必须从已安装版本类型定义核对。
6. 官方 Desktop 关闭/隐藏窗口后的实际 Runtime 生命周期，Bridge 是否应与 Profile Host 共生命周期。
7. 使用官方 Web Profile 的正确插件加载、通信与认证路径是否与 Desktop 不同。

## C. 可行性 SPIKE 实验顺序

### SPIKE-01：获取本机真实环境

记录 Windows build、Node/pnpm、安装的是官方 DSH Desktop 还是第三方 fork、其版本、DSH CLI 是否存在，以及 DSH Home/Profile 的实际位置。**禁止读取并打印凭证、会话敏感内容**。

### SPIKE-02：官方 Web Profile 插件加载

在 DSH 源码 checkout 按官方教程创建最小插件：

```typescript
import type { Context } from '@deepseek-ai/cordis';

export const name = 'dsh-glass-probe';
export function apply(_ctx: Context) {
  console.info('[dsh-glass] probe loaded');
}
```

`cordis.yml`（绝对路径替换成真实路径）：

```yaml
- insert:
    - id: dsh-glass-probe
      name: '/absolute/path/to/dsh-glass-probe.ts'
```

从官方源码 checkout 根目录运行：

```bash
pnpm install
pnpm run build
pnpm dsh web --patch ./path/to/cordis.yml
```

`pnpm run build` 在已经构建的 checkout 下可跳过；根据目标版本文档修正路径和命令。通过标准：**真实 Harness 加载插件并写入加载日志，卸载时相关 listener 被清除**。

### SPIKE-03：真实 session/event 观察

在 Spike 插件中基于**安装目标源码里的精确类型签名**注册 `ctx.on('session/event', ...)`，只记录 `session id + event.type + seq` 等最小元数据，并创建一段真正的 DSH 会话操作。验证 Todo 整表替换，观察工具调用可用数据。

这里故意不提供臆测的回调形参代码，Codex 必须直接查目标代码和官方事件 reference 后写出可编译实现。

### SPIKE-04：Desktop 插件装载

通过官方 Desktop 内置 Plugins UI，在隔离试验 Profile 中按官方安装方式安装/启用 probe 插件。只用合法的插件管理入口，不手动改 `app.asar`、签名目录或上游打包核心。记录能否运行、依赖冲突、插件管理恢复方式。

注意：2026-10-12 有 GitHub Discussion 指出 Desktop 0.2.0-rc.2 本地 `link:` 插件和某些 host peerDependencies 组合可能出现模块解析问题；这是**问题反馈，不是所有版本都存在**。遇到此现象先核验当前版本和官方解决情况，不要暴力修改安装文件。

### SPIKE-05：审批能力验证（最关键）

在独立测试会话使用一个确定可触发审批的**无害命令**（如 echo/查看工作目录，按该版本真实审批策略配置）。记录：

- 原 UI 现有审批的 owner 是什么，谁注册了 answerer。
- 插件能够观察到哪些 audit events 和 live request。
- 如果通过插件回答，原 UI 是否同步消失、是否只触发一次真实审批。
- `cancelled/unavailable` 的行为及 AbortSignal 生命周期。
- 必须通过 code review 证明安全所有权（单 answerer/显式委派）；如果没有，不要启用 `respondApproval`。

验收等级：

- `OBSERVE_PASS`：看到真实请求、只读状态正确。
- `CONTROL_PASS`：在已验证单 owner 模式下，本机人工允许/拒绝能产生 DSH 官方真实 outcome，原 UI 不竞争；跨会话不可混淆。
- `BLOCKED`：只能读、不能合法回答；保持只读，不尝试中间人改造。

### SPIKE-06：结构化问题

验证 `user-questions/request` 的数据结构及有效性：`questions` 数组、可选选项、多选、自定义文本、回答结果等。先做单问题，再做多问题。若原 UI ownership 未明，不启用响应。

## D. 运行模式与安装策略

### Web Profile（开发期优先）

可通过官方教程 `--patch` 快速加载 probe 或 Bundle。真实 release 应改为受管理 bundle 方式，按照官方 `package.json` 的 `dsh.bundle.patch` 配置而不是永远依赖临时 overlay。

**最小 Bundle 参考**（以官方教程为准，安装命令随目标版本变化）：

```json
{
  "name": "dsh-glass-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

```yaml
- insert:
    - id: dsh-glass-adapter
      name: dsh-glass-adapter
```

这一份是**安装结构示例**，仍需补实际模块导出、注入服务与插件权限配置。

### Desktop Profile（正式目标）

官方 Electron Desktop 管理 `profiles/desktop` 与宿主运行时，不应通过普通 CLI 强制装配 Desktop。必须实际验证官方插件管理 UI 的行为。若不可用，先发 observe-compatible Beta，界面清晰显示支持矩阵；不要承诺“所有官方 Desktop 都支持悬浮审批”。

## E. 集成安全要求

- 插件不全量外发对话上下文，仅发 ViewModel 和最小安全摘要。
- 与 bridge 握手通过前，不能接受本机审批意图。
- `approval/request` 不包含完整工具参数：按 `callId` 与真实 `tool/call` 关联，参数可能缺失；缺失时 UI 提醒并保守禁用高风险操作。
- `approval/asked` 和 `approval/decided` 为**审计**，不可等同有权回答的 live request。
- App 停止时对 pending 决策做到 abort/安全终止，不能隐式允许。
- 避免让 UI 虚假的“允许”先于 DSH 官方结果出现。

## F. 必交验证产物

至少生成：

- `docs/integration-matrix.md`：DSH 版本 × Profile × observe/control/question 能力。
- `docs/local-source-signatures.md`：目标版本的事件与方法签名、源码定位。
- `tests/integration/dsh-probe.test.ts`（或同等证据）。
- `tests/integration/approval-ownership.test.ts`（真实通道不通则 skip 并明确 BLOCKED）。
