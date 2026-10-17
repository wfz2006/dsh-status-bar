# 审批反馈与展开材质连续性 · 2026-10-18

用户反馈：底部“在DSH原窗口处理”文字突兀，允许/拒绝底色太淡、没有交互，胶囊展开后玻璃效果才补上。

变更：

- 外跳入口收进命令区右侧18px图标，保留“打开DSH”的可访问名称和提示，底部只保留简短预览状态。
- 允许/拒绝采用18%语义底色与36%边缘，悬停26%、按压34%，标签轻微压缩/回弹。实际按钮仍为原生disabled；外层只反馈不可用原因，鼠标/键盘均不会提交、批准、拒绝或改变请求状态。
- 原实现展开时调用`LiquidGlass.lite(true)`，直到约330ms动画结束才恢复三通道；新实现全程三通道，ResizeObserver合并更新局部像素尺寸，约32ms一次，结束时同步刷新。保留原SDF/RGB滤镜引擎，没有拉伸旧胶囊贴图。
- 画布在展开过程中可保留已取样世界坐标中的有效交集，由父级裁剪未覆盖部分；新区域仍等实际授权帧到达。未提前取样目标大框、未扩大ROI、未更改原生助手或Main严格覆盖/裁剪。拖动与普通移动仍缺覆盖就隐藏；隐藏/关闭仍停止取样。

验证：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/approval-feedback-acceptance.mjs
$env:GLASS_MORPH_LABEL='after'
node scripts/morph-optics-probe.mjs
python scripts/analyze-morph-optics.py
node scripts/approval-layout.mjs
node scripts/drag-optics-acceptance.mjs
node scripts/appearance-acceptance.mjs
python scripts/analyze-glass-appearance.py
```

41项单测包含“展开保留交集、拖动仍完整覆盖”的策略回归；lint/typecheck/build通过。`decision-feedback.json`记录亮暗两种受控原生背景的颜色、鼠标/键盘反馈、原生禁用和请求不变；`light-approval.png`、`dark-approval.png`为对应样张。未自动点击外跳图标打开官方DSH。

`morph-before.json`为修改前实测，`morph-after.json`为修改后3次原生变形逐帧状态。比较见`morph-comparison.json`：原来展开期间完整RGB占比0，约330ms结束才出现；现在尺寸开始增长后约40–46ms已有匹配尺寸的完整RGB，展开样本均保留三通道和可见画布，整层隐藏样本为0。实际新区域仍受本地取样与GPU更新时延限制，不能据此宣称全屏刷新率或任意机器零延迟。

窄审批250/320/340 DIP固定底栏、队列身份/滚动、拖动尺寸及实时画面回归通过；自定义颜色/亮度的独立背景合成仍保留。视觉偏好待用户实际体验确认，真实DSH审批仍BLOCKED。
