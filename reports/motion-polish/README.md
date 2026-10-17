# 胶囊与动效细调 · 2026-10-17

本轮用户要求：胶囊圆角稍小、10%黑底、更加灵动的交互、可安装Taste技能。

- 胶囊 CSS 与原生裁剪圆角均为24 DIP（原胶囊28），大面板仍26。
- 黑色染色单独为10%，位于折射层之上、文字和亮边之下；无新增模糊。
- 按下70ms响应，内部图标缩至86%，360ms柔和回弹。实运行采样峰值约102%，最终回到100%。按钮命中区域、光学层及窗口不跟随缩放。文字按钮、提示箭头、详情箭头与开关具有对应反馈。
- 减少/关闭动画与系统减少动画均取消弹性位移；开关和展开箭头仍即时表达真实状态。真实审批未接入，允许/拒绝继续禁用。

参考：[Linear 的液态玻璃触感细节](https://linear.app/now/linear-liquid-glass)、[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)。采用轻微响应、有限回弹的方向；没有复制其整套材质或宣称达到同等实现。

Taste来源：[Leonxlnx/taste-skill 的 soft-skill](https://github.com/Leonxlnx/taste-skill/tree/f624f37a8c650b9cc550253104925efe4c8de246/skills/soft-skill)。通过Codex skill-installer固定到该提交，仅安装技能文件至 `C:/Users/wfz/.codex/skills/taste-soft-motion`，未执行仓库安装脚本或新增产品依赖。本轮使用其自定义回弹和内部动势建议；网站巨幅留白、强模糊、布局随机化等不适用于用户当前的紧凑悬浮窗，未采用。

验证命令：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node scripts/interaction-feedback-acceptance.mjs
node scripts/drag-optics-acceptance.mjs
node scripts/smoked-glass-acceptance.mjs
python scripts/analyze-smoked-glass.py
# PowerShell
$env:GLASS_UI_REPORT='reports/motion-polish/ui'
node scripts/ui-clarity-acceptance.mjs
```

证据：`../interaction-feedback/acceptance.json`含按下/回弹逐帧轨迹；`../drag-optics/acceptance.json`含完整动画下四次真实拖动；`../smoked-glass/`含受控原生灰色输入及10%染色对照，像素比约0.898、文字opacity=1。`ui/`包含亮暗两种受控背景下的速览、展开、审批、设置共8张样张。

一次完整动画拖动测试走到点击验证时，已超过Mock定时7.2秒的审批事件，原脚本仍假设无待处理请求，导致期待速览而实际进入审批。已在该段测试前重启Mock并确认队列为空；产品“有待处理则打开审批”的行为保留。另修复新增文字动效包装被旧提示条span自动外边距影响的问题，加入左对齐断言。

36项单测通过；lint/typecheck/build通过。功能与光学层回归见上述机器证据；最终视觉偏好仍以用户实际体验为准。
