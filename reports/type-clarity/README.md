# 文字清晰度与收小圆角 · 2026-10-18

用户要求文字更清晰、与玻璃协调，并继续收小窗口圆角。

已通过本机字体清单及实际Chromium字体检查确认：旧的`Segoe UI Variable`写法在当前组合中落到了`MicrosoftYaHeiUI-Bold`，中英文字形均偏厚。改为`Segoe UI Variable Text`、`Noto Sans SC`、`Microsoft YaHei UI`的回退链，实际标题中文使用`Noto-Sans-SC-Medium`，西文使用`Segoe-UI-Variable-Text-Semibold`。没有下载/安装系统字体或新增产品依赖；其他机器缺字时仍有系统回退，尚未保证跨机器字体一致。

- 标题16px/500，胶囊14px/500；步骤计数12px、命令13px、设置标签13px、说明文字11px。保留紧凑布局、功能色与等宽命令。
- 浅色次要文字由`#35383f`加深到`#20242a`；深色由`#c1c4cc`提亮至`#d2d5dc`。正文浅色仍纯黑，深色仍近白。
- 文字继续无描边、无阴影、无滤镜且opacity=1；没有给玻璃增加雾底。悬停时按钮文字保持原位，图标/按压回弹保留。
- 胶囊24→20 DIP，大框26→22 DIP；原生roundedRegion和CSS半径同步，继承给折射层和亮边。

证据：`before.json`/`after.json`含CDP实际使用的字体与计算样式；`before-*.png`/`after-*.png`为本轮前后亮暗四形态样张，`layout/`为布局/颜色断言样张。图片仅来自已验证的测试拥有背景。捕获前等待字体与完整可见画布，避免将中间透明帧误作外观验收。

验证：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
$env:GLASS_TYPE_LABEL='after'
node scripts/type-clarity-acceptance.mjs
$env:GLASS_UI_REPORT='reports/type-clarity/layout'
node scripts/ui-clarity-acceptance.mjs
node scripts/approval-layout.mjs
$env:GLASS_MORPH_LABEL='after-type'
node scripts/morph-optics-probe.mjs
```

41项单测、lint/typecheck/build通过；亮暗8种形态实际字体、无文字特效、20/22px圆角与布局检查通过；250/320/340 DIP窄审批底栏及队列仍稳定。展开追踪`../approval-morph/morph-after-type.json`中三次均保持RGB和画布可见，匹配尺寸的折射约34–46ms出现，没有因圆角变化恢复旧等待策略。清晰度与协调感属于视觉偏好，最终以用户本机实际使用为准；未宣称改变Windows透明窗口的底层字体光栅化。
