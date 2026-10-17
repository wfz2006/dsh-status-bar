# 自定义玻璃底色与亮度 · 2026-10-18

设置 → 外观提供原生颜色选择器、底色浓度0–100%、亮度50–150%，以及仅恢复这三项的按钮。默认保持`#000000`、10%、100%。修改实时生效，沿用Main本地偏好保存，旧配置自动补默认；不会自动打开取样。

亮度作用于独立背景合成组，文字和亮边不受滤镜影响。关闭真实折射时，窗后像素不可用，因此保留亮度值、禁用亮度滑块并说明；颜色与浓度仍可调。实色降级时保留三项选择，回透明后恢复；审批继续禁用，真实DSH接入仍BLOCKED。

实现：`shared/glass-appearance.ts`负责默认值、输入规范化与填色；`glass-material.tsx/css`隔离背景与文字/亮边；`settings.tsx`提供控件；`desktop-backdrop.tsx`与`backdrop-tone.ts`让自动字色考虑实际染色和亮度。滑块变化不重新订阅/清空取样画布。标准亮度滤镜语义参考[MDN filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/filter)。

验证命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/appearance-acceptance.mjs
python scripts/analyze-glass-appearance.py
node scripts/preferences-acceptance.mjs
node scripts/smoked-glass-acceptance.mjs
python scripts/analyze-smoked-glass.py
```

40项单测通过；lint/typecheck/build通过。两次真实Electron启动验证颜色/浓度/亮度保存与默认关闭取样；旧的手动尺寸/审批保护也通过。颜色选择器测试覆盖与原生输入相同的input/change事件，系统原生调色弹窗中的鼠标选色尚未自动化。

`acceptance.json`记录颜色输入、键盘和真实鼠标拖动滑块、窗口尺寸不变、恢复默认、关闭取样/实色降级的状态；`settings-custom.png`是受控原生背景下的设置样张。只在确认背景为测试拥有的纯灰/条纹后导出图片，不导出用户真实桌面。

`pixel-analysis.json`对真实捕获的纯灰底作对照：50%亮度比约0.497，150%约1.474（高光会截断至255），蓝色30%染色产生实际RGB变化。125%亮度时与位移关闭对照有2552个显著变化像素、406个色散像素，关闭位移后色散为0；证明非默认亮度下折射/色散仍工作。默认10%黑底回归见`../smoked-glass/`。

人工体验：点右上角菜单 → 设置 → 外观，选色后拖动两条滑块；在亮暗底图下观察实色文字与独立亮边；重启确认三项恢复且取样仍关闭；点击恢复默认应回到黑色/10%/100%，主题/置顶等其他设置保持原值。
