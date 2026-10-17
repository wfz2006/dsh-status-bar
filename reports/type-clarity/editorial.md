# 按角色搭配艺术字体 · 2026-10-18

用户希望标题、小字等分别换上更好看、更有艺术感、各自适合用途的字体。

采用书刊式标题与安静的工具文字。字体规则单独放在`apps/desktop/src/renderer/typography.css`，在原主题后加载；没有改动审批能力、玻璃/亮度/取样、圆角或窗口尺寸。

| 用途 | 字体 | 参数 |
| --- | --- | --- |
| 标题、胶囊标题 | Georgia + Noto Serif SC，回退华文中宋/serif | 500；大标题17px/26px，胶囊15px/24px；字距0.01em |
| 正文、操作按钮 | Segoe UI Variable Text + Noto Sans SC | 沿用当前正文尺度和功能字重 |
| 计数、状态、会话、说明、分组名 | Segoe UI Variable Small + Noto Sans SC | 计数/状态12px、等宽数字；分组字距0.06em |
| 命令、HEX与滑块数值 | Cascadia Mono，回退Consolas | 保持现有字号，真实等宽数字 |

以上字体均在本机已存在，没有下载/安装字体或新增依赖。其他机器缺少字体时依次回退，尚未打包跨机器字体。无伪粗体、描边、文字阴影或额外雾底。

`editorial.json`含实际Chromium CDP字体结果：标题中文为`Noto-Serif-SC-Medium`，西文为`Georgia`；计数字形来自Segoe Variable Small，正文来自Noto Sans SC，代码/数值来自Cascadia。测试等待字体加载完成及受控原生画布完整覆盖后导出10张`editorial-*.png`，覆盖亮暗各五种形态。`editorial-layout/`为顶部无重叠、颜色/按钮和设置键盘回归的8张样张。

验证命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
$env:GLASS_TYPE_LABEL='editorial'
node scripts/type-clarity-acceptance.mjs
$env:GLASS_UI_REPORT='reports/type-clarity/editorial-layout'
node scripts/ui-clarity-acceptance.mjs
node scripts/approval-layout.mjs
```

41项单测及lint/typecheck/build通过。实际字体、亮暗排版、250/320/340 DIP窄审批的底栏与队列身份检查通过。玻璃仍透明且采用当前配色，最终审美感受由用户实际预览确认。
