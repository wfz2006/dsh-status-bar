# Electron 一次集中整改：基线

详见 [现状根因](../visual-baseline.md)。基线源版本 `4d6cdf3`；UI 业务仍为只读 Mock。

- 正常任务的深色子卡片来自深色 --reading 覆层。
- Acrylic 能透色但抹掉受控背景细线；透明 none 能保留细线与空间层次。
- 决策按钮位于滚动请求卡片内，在250 DIP实际被裁。
- 原生形变由 main/presentation 连续 setBounds 驱动，与 React 内容渐显独立；旧模式切换还会在 stop() 时发布一次“新模式/旧尺寸/idle”的中间状态。

前图：screenshots/baseline；后图：screenshots 直接目录。只有 Windows 原生区域捕获作为材质证据；旧浏览器截图不参与材质判断。
