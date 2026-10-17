# 拖动不增长回归

2026-10-17，当前 Windows 150% DPI。旧 Electron `setBounds` 移动路径以及直接 `setPosition` 均复现宽度随连续移动增长；12 次移动可从 341 增至 353 DIP。此前拖动验收仅断言位置与新画面，漏查尺寸。

改用固定本窗 HWND/PID 的原生 `SetWindowPos`，指定 `SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE`。Main 只提交安全位置，等待应答；单请求在途，空闲 1.2 秒退出。隐藏、最小化、关闭停止，最小化期间拒收新移动。助手 `--position` 分支不进入屏幕取样代码；不增加屏幕授权范围。

`node scripts/move-size-acceptance.mjs` 检查四形态各 80 次移动：每步页面 viewport 固定，前后 Win32 物理宽高一致，见 acceptance.json。Electron 的 DIP bounds 可能因物理位置取整差 1 DIP，验收以原生尺寸及真实 viewport 为准。`scripts/drag-optics-acceptance.mjs` 另在实际指针持续按下的每一步断言 viewport 不变，并检查位置、实时取样、文字选择及点击行为。其他 DPI/多屏矩阵尚未覆盖。
