# 悬浮窗边缘细化 · 2026-10-18

本次只调整外轮廓的绘制与裁剪。保留胶囊 15px / 面板 20px 圆角、窗口尺寸、文字、底色、取样频率、折射色散参数与展开时序。

## 实现

- 将渐变遮罩描边和多重 inset shadow 合并成一条 1.25 DIP SVG 渐变描边。路径向内偏移 .8 DIP，圆角同步扣除偏移，保留半透明抗锯齿过渡；清除 refined-theme 中重复的描边覆盖。
- clear/frosted 窗口的整数原生裁剪在水平方向留 1.25 DIP 抗锯齿余量，由 Chromium 负责可见轮廓。solid/acrylic 仍用严格裁剪，避免原生实底泄漏。窗口矩形范围和命中操作不变。
- 不添加滤镜、逐帧脚本或 ResizeObserver；保留材质 memo 与完成状态的有限亮边反馈。
- 修正仅用于验收的 capture-owned-window.ps1：使用线程 DPI 上下文取得真实物理坐标，保留截图前后窗口所有权检查并恢复上下文。PowerShell 进程 DPI 已初始化时，原来的进程级 API 不能可靠切换坐标。

## 本轮证据

| 检查 | 结果 |
| --- | --- |
| 当前 Windows 144 DPI / 150%：288×44 胶囊、400×360 面板 | 实际 GetWindowRgn 与 renderer alpha 逐像素比较，均无被裁掉的半透明像素，四角 alpha=0 |
| 100%、125%、200% Electron 强制缩放 | 胶囊 288×64、面板 400×360，8 项形态/缩放组合（含当前150%）均通过几何、alpha 覆盖及透明四角断言 |
| 基线 | 150% 展开轮廓有 24 个低 alpha 像素被裁掉；修正后为 0。基线胶囊本来就是 0，主要改善其描边叠加观感 |
| lint / typecheck / build | 通过 |
| 单元测试 | 14 文件、132 测试通过，包含透明裁剪余量的边界与覆盖测试 |
| motion / approval-layout / performance acceptance | 全部通过；审批250/320/340高度、断线失效、RGB三通道、当前位置取样、隐藏恢复等保留 |

`before-*-renderer.png` 和 `after-*-renderer.png` 为 renderer 透明截图，不能代替桌面合成效果。`before.json`、`after.json` 与 `*-shape.json` 留存本轮窗口尺寸和实际原生 region；`scale-100.json`、`scale-125.json`、`scale-200.json` 为缩放测试。强制缩放测试并未切换 Windows 系统 DPI；测试胶囊用64 DIP高度避开物理最小窗口高度的舍入干扰。当前实际150%测试仍覆盖原有44 DIP胶囊。

原生截图重试见 `native-after.json`：胶囊被遮挡检查拒绝，展开截图在捕获后失去焦点而被拒绝。本轮没有合格的原生桌面截图，不把 renderer 预览或 region 几何检查称作原生视觉验收通过。

## 复现与人工验收

```powershell
pnpm build
node scripts/edge-acceptance.mjs after
node scripts/edge-acceptance.mjs scale-125 --scale=1.25
# 保持测试窗口前台时才尝试桌面截图；失败样本不采纳。
node scripts/edge-acceptance.mjs native-after --native
```

运行应用，在浅色、深色及复杂桌面上分别查看胶囊、展开面板和设置页的四角与顶边；拖动、调整大小并反复展开收起，确认没有白色阶梯、双线、方形实底或闪现。触发任务完成，确认边缘短暂亮起，关闭动画及系统减少动态效果设置仍有效。当前本轮尚未完成这组人工桌面视觉验收。

设计实现对照：[MDN SVG rect](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/rect)、[shape-rendering](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/shape-rendering)。坐标依据：[Electron screen](https://www.electronjs.org/docs/latest/api/screen/)、[Microsoft SetThreadDpiAwarenessContext](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext)。
