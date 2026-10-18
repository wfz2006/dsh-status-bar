# 保留功能与材质的性能优化 — 2026-10-18

## 实现

- React 只在跨越实际布局断点时更新布局状态，不再为每个像素尺寸变化重渲染整个界面。原生形变与光学层的尺寸观察器仍按实际像素工作。
- `deriveTask` 缓存到投影/所选会话变化时；材质组件仅对实际光学属性变化重渲染，底色、亮度、强度、主题、磨砂与形变变化仍正常生效。
- RGBA 使用原缓冲区的 `Uint8ClampedArray` 视图，消除 renderer 每帧一次完整像素复制；包含非零 byteOffset 的单测验证字节一致。SharedArrayBuffer 输入保留兼容复制路径。
- 缓存 Canvas 2D context；只有几何/覆盖状态变化时重设取样位置，只有文字配色档位变化时重写主题属性。继续处理每一个到达帧。

未改变取样区域、采样调度、分辨率、SDF 位移图、RGB 色散、原生窗口曲线、业务协议或审批权限。

## 优化前后：同一本机各两轮

使用 `node scripts/performance-audit.mjs before/after`（标签实际各传一个参数）。仪器安装在隔离 Mock Electron 内：React 提交计数、RGBA 构造复制计数、Canvas 绘制次数、主题属性写入次数与 CDP CPU 时间。光学输入来自真实限定区域取样助手。

| 测量场景/指标 | 优化前均值 | 优化后均值 |
| --- | ---: | ---: |
| 六次形态切换：React 提交 | 99.5 | 42.5（减少 57%） |
| 30 次移动：React 提交 | 31 | 9（减少 71%） |
| 展开静止 2 秒：额外 RGBA 复制 | 61.87 MB | 0 |
| 展开静止 2 秒：主题属性重复写入 | 37.5 | 0 |
| 展开静止 2 秒：实际 Canvas 输入绘制数 | 37.5 | 38 |
| 展开静止 2 秒：renderer TaskDuration | 344.94 ms | 316.00 ms（约减少 8%） |

四份记录的光学贴图 SHA-256 完全一致，三路 RGB 位移系数均为 `20 / 19.14 / 18.28`。隐藏阶段四轮均为零取样绘制。

这是局部 CPU 工作量/临时分配的测量，不是屏幕呈现帧率。移动阶段 renderer 总任务时间没有稳定下降；主进程 CPU 样本也有波动，因此不声称整体 CPU 或 FPS 提升。JS heap 的短样本受 GC 时机影响，不用于声明常驻内存下降。消除的只是这一处 renderer RGBA 复制，Electron IPC 与 Canvas 必要的内部复制仍存在。

原始数据：`before.json`、`before-2.json`、`after.json`、`after-2.json`；均值及光学/帧数断言：`comparison.json`。

## 功能验证

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / Desktop 构建；14 文件、131 单测，包含原像素/偏移视图回归。
- `pnpm test:performance`：真实助手输入与 Canvas 抽样字节匹配；调色/亮度更新；实际尺寸档位与世界坐标；展开全程保留 3 路 RGB，结束时贴图尺寸正确；隐藏/恢复、实色/透明、显式停止生命周期。
- 亮/暗自动文字切换使用 renderer 受控帧，避免 Windows 显示亲和性连同测试背景窗一起排除导致输入不确定；这部分不冒充真实桌面颜色切换验收。
- `pnpm test:experience` / `pnpm test:approval-layout` / `pnpm test:motion` / `node scripts/whale-acceptance.mjs`：会话键盘、统计、长标题、审批固定底栏、减少动画、拖动与鲸鱼交互通过。
- 首次并行执行全套检查时，单测进程曾非零退出且未报告断言明细；定向光学测试及全量 verbose 复跑通过。未据此修改业务或系统配置。

手动复核：连续拖动与展开窗口；修改玻璃底色/亮度/主题；来回切换会话和审批；隐藏后重新显示，确认背景持续更新且关闭折射后立即停止。真实 DSH Desktop 审批联调与完整 DPI/GPU 矩阵未因本轮 UI 优化获得新的验收结论。
