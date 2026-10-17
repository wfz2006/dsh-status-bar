# Liquid UI v1 重设计审计与执行记录

输入：用户提供并要求执行的 `DSH_Glass_Liquid_UI_Redesign_Spec.md`。

## Phase 0：实际文件和边界

- `apps/desktop/src/main/index.ts`：窗口、安全 IPC、托盘、Mock 生命周期。需迁移展示入口及偏好存储，不改变通信生命周期。
- `apps/desktop/src/main/presentation.ts`：原生 Acrylic、区域裁切、bounds 动画。复用低层材质与连续窗口，增加四形态同步。
- `apps/desktop/src/shared/window.ts` / `api.ts`：几何与窄 API。扩展展示模式/设置；不修改自有 Bridge 协议。
- `apps/desktop/src/renderer/main.tsx` / `style.css`：仍有常驻应用名/Mock 徽章/连接底栏，只有尺寸断点，无独立的 peek/approval；拆为任务视图、审批、设置、边缘交互。
- `apps/desktop/src/renderer/store.ts` / `packages/protocol`：保留 authoritative projection、Session 隔离和断线失效；增加纯展示派生，不制造 Agent 事实。
- `scripts/desktop-smoke.mjs` / `liquid-acceptance.mjs`：旧测试依赖被删除的按钮，需改为四形态、菜单、设置、手动尺寸和异常恢复测试。

## 技术风险与处理

1. 常态去掉 Mock 标签按新用户规范执行；数据源在右键菜单/设置/托盘明确显示，不声称真实连接。
2. 真实 DSH / 审批仍 BLOCKED；审批卡显示多请求与可读详情，但不添加虚假可用按钮或应答通道。
3. Acrylic 不是桌面像素折射；复测亮/暗/复杂受控背景及透明降级，不假报全 DPI 或跨屏验收。
4. 手动尺寸与自动注意事件解耦；已手动缩放时不被后台事件反复覆盖。
5. 显示模式只控制容器，不改变 Todo/运行状态；完成仅从 phase=finished 得到，不从 Todo 百分比推断。

## 执行顺序

- [x] Phase 1：移除界面噪声，迁移右键/托盘入口，启动任务胶囊；见下表及截图。
- [x] Phase 2：纯展示模型与 capsule/peek/expanded/approval，自定义拖动阈值和缩放；见测试及截图。
- [x] Phase 3：明亮珍珠/冰蓝材质、局部阅读承载层、可用降级；限定本机受控背景。
- [x] Phase 4：约 320ms 连续形变、减少动画、悬停与状态反馈；窗口事件采样不等于 FPS。
- [ ] Phase 5：Mock 回归完成，真实 DSH、全 DPI/跨屏/系统生命周期矩阵仍未通过，见下文限制。

## 分阶段交付与复现

本轮以新版用户规范为 UI 目标，旧 MASTER_SPEC 的固定顶栏/底栏布局由新版替代；协议与真实 DSH 接入边界保持原约束。

| 阶段 | 修改与文件职责 | 本轮证据 | 后续最小验证目标 |
| --- | --- | --- | --- |
| 0 审计 | 本文记录窗口/展示/数据边界 | 原始文件清单与风险 | 真实接入前复核官方插件环境 |
| 1 减法 | renderer/task-views、main/window-controller：任务胶囊与菜单迁移 | phase1-capsule.png；菜单项、正常 UI 无品牌与连接底栏断言 | 人工托盘/热键冲突验收 |
| 2 四形态 | shared/view-model、renderer/task-views、approval-card、gestures：内容分级、请求队列、拖动/缩放 | phase2-peek/expanded/approval.png、approval-queue.png；纯函数与实际 Electron 回归 | 全 DPI、多显示器布局矩阵 |
| 3 材质 | renderer/style.css、main/presentation：珍珠冰蓝、局部阅读层、细边缘与三档降级 | native-*.png 为 Windows 受控背景原生合成截图；浏览器截图不代替原生材质证据 | 更多壁纸/显卡/系统透明设置 |
| 4 形变 | presentation：约 320ms 展开/260ms 收起；CSS 渐显、光点与完成反馈 | native-acceptance.json 的真实 bounds 事件时间序列；完成/断线/减少动画断言 | 录屏与呈现帧耗时采集 |
| 5 回归 | desktop-smoke、preferences-acceptance、tests：队列/重连/身份/设置持久化/异常 | acceptance.json、native-acceptance.json、preferences-acceptance.json；28 项单测 | 真实 DSH 与系统级矩阵，仍未完成 |

图片和 JSON 相对目录：`docs/evidence/redesign/`。重设计前的紧凑详情图保留于 `docs/evidence/liquid/compact-default.png`；该旧图只用于视觉前后比较，不代表本轮重跑的结果。

## 本轮检查与已修复边界

- `pnpm lint`、`pnpm typecheck`、`pnpm test`（28 项）、`pnpm build`。
- `node scripts/desktop-smoke.mjs --native`：四形态、实际指针拖动与缩放、菜单回调、设置、会话隔离、断线/重连、双请求、减少动画、长中文/无 Todo、完成收起与断线取消、sandbox。菜单以实际 Electron Menu 回调验收，未宣称系统菜单鼠标逐项实测。
- `node scripts/preferences-acceptance.mjs`：隔离 userData，两次实际启动验证主题/强度、remember-last 与手动尺寸；待审批快照不会覆盖自定义尺寸。
- 独立代码复核发现并修复：目标显示器选错、manual 标记未跨重启保存、离线旧请求触发通知置顶、断线后完成计时器仍收起。新增回归覆盖后三者，跨屏修复仅代码复核，尚无多屏实机验收。
- 动画期间拒绝缩放起手并暂停移动控件点击；指针丢失/取消清理迟发缩放，防止设置返回后被意外标记手动尺寸。

## 材质、性能与剩余限制

Windows 合成截图使用自建亮、暗、复杂背景窗口；另测透明和实色回退。截图工具只截指定测试窗口区域，出现其他窗口遮挡的样本需重拍，不作为合格证据。Acrylic 是系统模糊/透色，边缘仅作高光模拟，没有桌面像素真实折射；主题 auto 跟随系统主题，不检测背景亮度。关闭材质后仍有阅读承载层与实色模式。

JSON 记录真实窗口 resize 时间/尺寸与 Electron 各进程 CPU 百分比/工作集。窗口事件数不等于已呈现帧数，1600ms 短时 CPU 采样不代表长期空闲基准或低端设备性能保证；没有持续全窗 Shader。

真实 Desktop 事件与审批所有权仍 BLOCKED，审批按钮禁用，缺失完整参数时明确提示仅有预览；未添加自动审批或虚构完成结果。全 DPI、多显示器拔插、休眠唤醒、原生托盘/快捷键冲突、低端 GPU 长时负载和安装包尚未验收。本轮不勾选原始规范中这些未完成的综合 DoD。
