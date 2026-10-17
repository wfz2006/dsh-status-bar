# Edge 新标签页材质移植

用户指定参考：`D:/workb/DSHwoek/edge-liquid-glass-newtab`。只读该项目，未修改其已有的 `tests/sync-writer-ownership.test.js` 脏改动。本轮按用户明确的新方向执行，取代此前 Gate A 等待评价的样式方向；未迁移技术栈。

## 实际移植

- 原 `js/liquid-glass.js`：SDF内部透镜、边缘法线、三路RGB位移/色散、最长240px位移图、60项LRU缓存、局部像素 `feImage` 和独立裁剪层。
- 最终 operation 玻璃参数：低透明渐变、clear/balanced/readable底色 .025/.07/.12、方向性内高光与细轮廓；移除上一版文字的描字轮廓。
- DSH适配只有专用光学surface选择器、React init/dispose清理、变形时lite/结束恢复。文字与按钮在光学层上方，不参与折射；固定审批footer、业务协议与权限不变。
- 不复制壁纸、纹理或新标签页布局，不添加桌面截图背景，也不引入后台屏幕采样。

源引擎SHA256：`B9C1623A2EA5D7C67660B53185A14875E31A503C8C84901F0BA501B6175E153A`。副本：`apps/desktop/src/renderer/vendor/edge-liquid-glass.js`；完整MIT版权声明同目录 `edge-liquid-glass.LICENSE`，Copyright(c)2026 wfz2006。

## 验证与边界

`pnpm test`31项通过（含中心不平移、内部可见位移、取样不越界、图像分辨率上限）。`scripts/material-port-acceptance.mjs --dom-only` 实际在Electron里验证四形态局部像素贴图、defs无累积、三路色散、预设切换与solid清理恢复，并用自建DOM条纹进行零位移/正常位移像素对照。它只证明网页自身背景可折射。

原生采集出现前台遮挡，已经拒绝并删除这些样本；没有将其中的像素差异认定为桌面折射成功。采集脚本现使用实际Win32矩形、DPI aware和WindowFromPoint遮挡校验，再调用截图技能的区域截图工具。用户同意保持前台后已补测：native-peek.png、native-peek-zero-map.png、native-approval.png、native-dark-peek.png。原生对照4929个像素有差异，主要集中于边界；不能由此证明背景斜线真实位移。网页自有背景对照63742像素不同，证明页面内滤镜确实工作。

初次桌面自动化曾出现置顶断言失败，连测试进程中新建普通不透明窗也返回false；随后独立的普通Electron进程置顶返回true，前台测试期间最新完整桌面回归通过（renderer errors=0）。保留这段失败历史，不将其归因于某条CSS或声称定位了系统原因。审批固定footer独立测试通过。

**没有证据证明该SVG滤镜已经扭曲其他应用/桌面的像素。** 新标签页有同一网页内的壁纸，桌面透明窗没有这份backdrop。相同引擎和外观参数不等于相同跨应用光学能力。若需要完全一致的窗后位移，还需明确选择原生光学后端或用户授权的限定区域采样，当前未添加任何采样服务。

复现：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`node scripts/material-port-acceptance.mjs --dom-only`；原生窗口在前台时运行无dom-only参数的脚本。本轮上述代码检查、两项DOM像素/几何单测、固定footer和完整Electron回归通过。独立复核未发现生命周期/defs泄漏/点击隔离问题。未重跑十分钟性能采样，不沿用上一版数字声称新GPU效果更快。
