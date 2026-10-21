# E0：实际渲染路径与问题基线

基线提交：`4d6cdf3`。用户提供的新改进包存于 `docs/references/ui-improvement-v2/`，其中图片是反馈与设计方向，不是本轮运行截图。未执行包内脚本（包内只有 Markdown 与图片）。本轮仍只连接 Mock，真实 DSH Desktop/审批所有权保持 BLOCKED。

## 实际背景路径

1. `apps/desktop/src/main/index.ts` 创建一个 BrowserWindow：transparent=true、frame=false、thickFrame=false、hasShadow=false、roundedCorners=false、resizable=true、背景 #00000000。
2. `main/window-controller.ts` 将旧默认 system/balanced 映射到 presentation 的 acrylic；`main/presentation.ts` 实际调用 `setBackgroundMaterial('acrylic')`，清透/实色时使用 none，并设置透明/实色背景。
3. Windows DWM 提供 Acrylic 合成；`setShape(roundedRegion(...))` 裁切原生区域，CSS 使用相同轮廓。没有原生特效第三方包、没有读取桌面/壁纸图作为渲染纹理。
4. html/body/#root 全透明；主 .glass 有浅色 tint/渐变。其上旧 .peek-main、.task-expanded>.task-heading、.todo.in_progress、.approval-card 使用 --reading；深色主题该 token 为 rgba(20,42,62,.65)。所以即使窗底透明，深蓝子面板仍遮住背景。系统 auto 主题跟随深色时会出现包中截图的深卡片。
5. CSS 高光是轻量覆盖层，没有跨桌面 backdrop-filter；它不会真实折射桌面像素。

## 审批裁切根因（已复现）

旧结构是 approval-view > approval-queue（flex:1/min-height:0/overflow:auto）> approval-card > 命令、详情、安全提示、decision-buttons。大号“打开 DSH”按钮位于 queue 外；决策按钮却在滚动内容内，因此在 250 DIP 高度被裁到下方，需要先滚动才能看到。`node scripts/approval-layout.mjs` 在修改前实际失败：Decision footer must remain fully visible at 250 DIP。

这不是审批 IPC 的错误，而是滚动区边界与操作优先级错误。修复不开放任何真实审批权限。

## 平台与现场

Windows 11 10.0.26300，单显示器实际缩放 150%；Electron 44.8.0 / Chromium 152.0.7977.167。驱动与环境完整值在 `electron-redesign/windows.json`、`display-drivers.json`、`baseline-environment.json`。

注意：启动早期 getGPUFeatureStatus 曾返回 disabled_software，这个 API 只有 GPU 信息初始化后才有意义。后续 await getGPUInfo('complete') 后记录到 hardwareAcceleration=true、gpu_compositing/rasterization/WebGL 均 enabled，见 native-results.json；不能把早期值当作“应用关闭硬件加速”的根因。

实际原生四形态基线：`electron-redesign/screenshots/baseline/busy-{capsule,peek,expanded,approval}.png`（该图集未入库）。原生采集曾被用户前台窗口遮挡；已拒绝这些样本并在用户同意保持前台后重新采集覆盖。采集只用于验收，不进入应用渲染路径。

基线静止胶囊采样 300691ms，60 个 5 秒采样，进程 CPU 百分比之和的算术均值 0.1081、工作集之和均值 547279KB（约534.5MiB）。工作集包含共享页，不是私有内存，也不是显存。采样时有其他桌面任务，不能用于宣称性能排名。
