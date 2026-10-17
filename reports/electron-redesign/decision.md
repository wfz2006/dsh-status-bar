# Gate A / Gate B 决策

**当前结论：用户明确拒绝移植结果，Gate A 失败。Gate B 已启动并完成 Tauri 2 Release 原生材质探针；未证明更优，正式技术栈未迁移。** 2026-10-17 最新实机结果见 `../native-compositor/README.md`。以下评分表保留历史；不再等待用户对已拒绝版本补评分。

随后：用户明确批准限定区域取样，在现有Electron中实现真实输入驱动的SDF/RGB光学效果，见 `../desktop-optics/README.md`。技术验证不替代用户对新版外观的评价，不重写旧版本失败结论。

本轮只做一次Electron集中整改。已经实现单块玻璃、显式材质对照、固定审批操作栏、请求切换和连续形变，并提供实际Windows截图/录屏/资源记录。所有真实审批功能仍BLOCKED，不伪造成功。

## 必须由用户评价的视觉项

规范要求总分≥85/100，透明与轻薄≥20/25、单块一致性≥17/20，并得到用户认可。不能用编程Agent自评分替代。

| 项目 | 最高分 | 用户评价 |
| --- | ---: | --- |
| 透明与轻薄 | 25 | 待评价 |
| 单块一致性 | 20 | 待评价 |
| 轮廓精细 | 15 | 待评价 |
| 极简组织 | 15 | 待评价 |
| 连续形变 | 15 | 待评价录屏 |
| 多背景可读 | 10 | 待评价 |

建议先看 screenshots/busy-peek.png、light-approval.png、dark-peek.png 与 recordings/morph.mp4、approval-scroll.mp4；before对应screenshots/baseline。

## 不能算作已通过的项目

- Windows全DPI/多屏/托盘/休眠原生矩阵及透明resize偶发几何问题仍待复核；见tests.md。
- 字形边缘保护不等于自动感知桌面背景。没有真实像素折射或焦散。
- 程序事件/录屏采样不能证明所有显示帧均无掉帧；视觉判定仍需用户查看录屏。若观察到明显残影/闪跳，同样视为Gate A失败。
- 真实DSH观察/控制不在本轮已交付范围。

如果用户仍评价“一般”或明确拒绝：本轮不再修改CSS参数，下一步新建 `experiments/tauri-glass/`，使用相同Mock内容、字体、尺寸、背景和DPI，完成T1透明/T2Acrylic/T3光学边缘与本轮Electron的真机对照。不得预设Tauri更优；Gate B明显胜出且功能/性能无阻断，再请用户批准正式迁移。Electron保留可回滚。

依据：`docs/references/ui-improvement-v2/DSH_Glass_UI_Improvement_And_Stack_Decision.md` 第6、8、9节。
