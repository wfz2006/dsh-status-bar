# 中性黑底色：5%微调至8%

2026-10-17，先按用户要求给清玻璃增加5%黑底，随后按“深一点点”反馈微调至8%。`glass-tint`位于透镜上方、文字和亮边下方，当前背景为rgba(0,0,0,.08)，不设置窗口整体opacity、不加模糊、不改变取样范围；实色降级不叠加此层。

`node scripts/smoked-glass-acceptance.mjs` 使用逐像素确认的自有原生灰色背景，对照开启/隐藏黑底；验证填色、无模糊、文字/根容器opacity保持1及实色降级。当前空白区像素亮度比见`pixel-analysis.json`，应约0.92；旧5%样张保留。35单测、lint/typecheck/build通过。
