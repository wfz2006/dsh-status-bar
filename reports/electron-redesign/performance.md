# 资源与形变测量

方法：`node scripts/resource-sample.mjs baseline 300` 与 `node scripts/resource-sample.mjs after 600`，隔离Profile，有限Mock流结束后前5分钟静止胶囊，每5秒采集一次app.getAppMetrics；后5分钟包含20次peek/capsule切换。完整原始数据baseline-resources.json、after-resources.json，摘要performance-summary.json。

- 基线实际300.69秒；候选持续601.16秒，前5分钟用于静止采样，10分钟内renderer pageerror为0，未退出/崩溃。
- CPU为各进程API百分比之和再求均值；工作集含共享页，不等于私有内存或显存。基线均值约0.1081 / 534.45MiB，候选约0.0178 / 414.76MiB。
- 当时还有其他桌面工作及其他测试进程，采样并非独占机器基准。资源候选构建早于最后胶囊任务/数量文案及设置即时反馈，不能据此宣称最终版性能提升或保证。
- native-results.json记录20次完整展开/收起的等待时间与rAF间隔。等待包括测试轮询与IPC；录制并行会影响调度。FFmpeg录制30Hz并不是应用呈现帧率；rAF间隔也不直接代表显示掉帧。未测量实际呈现FPS、GPU占用或功耗。
- GPU初始化后hardwareAcceleration=true、gpu_compositing/rasterization enabled；启动早期basic值不用于判断关闭硬件加速。
- 没有全窗口持续Shader，运行时只有状态小光点的低幅动画；支持减少动画/关闭、透明/实色降级。

剩余：独占机器重复基准、Windows ETW/PresentMon等呈现追踪、低端GPU、前后台/全屏/系统透明设置矩阵。录屏是用户评价形变的证据，不能用“有20次状态切换”代替顺滑评价。
