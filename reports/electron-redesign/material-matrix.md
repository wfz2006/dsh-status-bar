# E1：同条件材质矩阵

脚本：`node scripts/visual-baseline.mjs`。在修改前构建运行，12 张受控桌面原生截图，位于 screenshots/baseline/{A,B,C,D}-{light,dark,busy}.png；同一实际窗口尺寸400×340 DIP、同一审批内容（含旧裁切）、同一150%显示缩放。

| 方案 | 实际改动 | 从截图可观察的结果 |
| --- | --- | --- |
| A | 原实现、浅色主题、原生 Acrylic、原 reading 覆层 | 透色但背景细线消失，内部仍有多块面板 |
| B | none 透明原生窗；主填充降到 .045；移除任务/审批大卡片；无光学边缘 | 背景斜线清晰可见，亮背景可读；浅色文字方案遇深背景时不够清楚 |
| C | B 的内容结构加原生 Acrylic | 子卡片消失，但背景细线仍被系统模糊掉 |
| D | B 加细轮廓与轻光学覆盖 | 背景层次与B相同，轮廓可辨；单用透明不能保证所有背景对比度 |

本轮选择 D 的 substrate 方向：system 设为推荐薄透（native none），显式保留 acrylic 对照与 solid。删除任务子卡片，文字使用随字形的细反色描边/阴影保护对比，不增加大面积灰白遮罩。主题仍由系统/用户选择，没有基于桌面像素检测明暗，也不声称真实折射。

改后12张截图测试 light/dark/busy 的四形态。深背景用dark主题，其他用light。对任意动态画面自动选择文字颜色仍未实现，应由主题/实色降级保证极端情况。截图中没有视觉目标图贴图或桌面采样背景。

API边界参考：[Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)、[透明窗口限制](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)。官方明确提示透明可缩放窗口有平台限制；本机成功的几何测试不能替代其他显卡/Windows组合验收。
