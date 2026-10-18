# 审批卡标题、决策图标与自动返回（2026-10-18 晚）

## 反馈与根因

1. 审批大窗左上角空：标题区在 `.approval-view` 的滚动流里，长命令把 header 顶出视口，看起来像空白。
2. 点「允许」后变黑框且不返回：请求结束后仍停在 `approval` 模式，只剩一张空壳审批页；窗口不收缩，视觉上就是一块黑色矩形。
3. 缺少 DSH 审批框里的关键信息：reason 被折叠进 details，标题区只有一个 h1。
4. 允许/拒绝按钮只有文字：DSH 审批框带小图标。

## 修改

- `apps/desktop/src/renderer/approval-card.tsx`
  - header 改为 `.approval-headline`：`shield` 图标徽章 + h1「需要你的确认」+ `.approval-summary`（`request.reason`，缺失时退回工具名）+ 队列计数；会话标题独立一行。
  - 允许/拒绝（含只读预览按钮）加 `check` / `x` 图标。
- `apps/desktop/src/renderer/icon.tsx`
  - 新增 `shield`、`check`、`x` 三个图标。
- `apps/desktop/src/renderer/style.css`
  - `.approval-view` 改为固定 header / 滚动 body / 固定 footer 的 flex 列；`.approval-mark` 琥珀徽章、摘要两行截断、决策按钮图标排布。
- `apps/desktop/src/main/window-controller.ts`
  - 进入审批模式时记下来源视图（`approvalReturn`）与「确实出现过待处理请求」（`approvalSawRequest`）；
  - 请求全部结束后自动回到来源视图（默认 `peek`），不再停在空审批页；
  - 手动打开空审批页不会触发返回。

## 验证（隔离 Electron + Mock，`ui-approval-check.mjs`）

| 检查 | 结果 |
| --- | --- |
| 标题头 | mode=approval、h1「需要你的确认」、shield 图标存在、标题 top=18px（不再被卷走） |
| 摘要 | `.approval-summary` 有内容（Mock 文案） |
| 决策图标 | 两个按钮各带一个 `.ui-icon` |
| 固定布局 | `.approval-view` overflow=hidden，body 独立滚动 |
| 自动返回 | 请求清空后 mode=capsule，审批卡为 0 |

lint 0、typecheck 0、13 文件 123 测试全过；截图 `evidence-real/approval-header.png`、`approval-return.png`。

## 限制

- 本轮用 Mock 状态转换验证「请求清空后自动返回」；真实 DSH 审批卡片的 reason 文本此前已在真实 agent 审批链路中验证过（「运行 PowerShell 写入工作区外文件」），本次未重复跑真实 Host。
