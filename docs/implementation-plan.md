# DSH Glass 首轮实施计划

依据：用户提供的 README、AGENTS、PROMPT_FOR_CODEX、docs/00–09、TASKS。沿用既有设计，本轮交付 M0 核验报告 + M1 Mock 闭环及必要的 M2 窗口切片。

- [x] 核验本机环境、目标安装及公开源码签名，产出支持矩阵；不修改官方安装/Profile。
- [x] 初始化 strict TypeScript pnpm workspace，协议运行时校验；先测试版本、非法输入、跨会话、旧序号、epoch、断线。
- [x] 实现纯投影 reducer、确定性 Mock 快照/事件源、loopback 鉴权桥；集成测试无令牌、Origin、重连、超大消息、重复客户端。
- [x] Electron main/preload + React/Zustand，三种密度和短窗降级、托盘/恢复、断线提醒；真实审批能力始终 false。原生拖动/托盘恢复完整手测另列待办。
- [x] lint/typecheck/test/build + Playwright Electron 实际启动、尺寸、交互与截图；更新任务证据和运行说明。

关键约束：Mock 显著标记；renderer 不持有 token；禁止自动审批；Todo 整表替换；不同 runtime/session 隔离；重连先原子快照再增量。

审查重点：旧 epoch welcome 回放、重连期间旧增量、短宽窗口隐藏安全提示、空 Todo 误示完成、恶意 Origin/IPC。

实施方式：当前会话直接完成，按可验证功能形成本地小步提交。

## 实施记录与裁定

- 本机有 bundled CLI，故没有额外安装 DSH，也未从 PATH 缺失推断 CLI 不存在。
- 默认采用静态玻璃背景；Acrylic 为显式实验切换，未实测桌面壁纸渲染前不默认开启。
- 拒绝为未验证的所有权实现应答通道；协议先实现只读子集，完整控制留 M4。
- RED→GREEN：协议/Todo 测试、鉴权桥/几何测试；Electron 首次在 340 DIP 因测量扣除边框失败，改为 borderBoxSize 后通过。
- 独立复核发现原型会话键和托盘/renderer 置顶不同步，均先复现失败再修复；回归纳入单元与桌面测试。
- 延迟旧快照可使 Todo 回退的回归测试曾失败，现只在初始/重连同步阶段接受快照。
- DSH 官方 Web probe 真实广播 Session 事件，但人工测试夹具不是 live Agent；生产适配依旧 BLOCKED。
