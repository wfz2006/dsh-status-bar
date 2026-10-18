# 小鲸鱼元素

素材参考：DeepSeek 官方仓库 [DeepSeek-LLM/images/logo.svg](https://github.com/deepseek-ai/DeepSeek-LLM/blob/main/images/logo.svg)，2026-10-18 在线核对。实现复用项目已有的 `renderer/whale-mark.ts` 矢量轮廓；未增加外部字体、图片服务或运行时请求。

- 胶囊左侧：鲸鱼 + 原状态角标；仅 running/starting 游动并吐泡泡，completed 单次招呼，断线静止。
- DSH 转录：消息类型使用鲸鱼头像；思考、用户输入和工具仍保留各自图标。
- 无转录、无 Todo、无活动：紧凑鲸鱼插画，保留真实空状态文字。
- 设置标题：小鲸鱼签名。
- 减少/关闭动画与系统减少动画均停用新增动效；装饰不接管点击、拖动或键盘焦点。

运行 `node scripts/whale-acceptance.mjs` 验证真实 Electron 的状态标签、拖动尺寸、点击展开、减少动画、空会话与断线停止。`--native` 可额外执行原生合成截图，本次尝试被前台遮挡保护拒绝，不计作原生视觉验收。

`renderer-*.png` 是注入受控浅色背景的渲染器排版预览，仅用于检查鲸鱼与文字尺寸，不证明窗后真实折射。

手动检查：启动后拖动胶囊；点击鲸鱼展开；切到无过程的会话；在设置中将动画设为减少，确认鲸鱼停止摆动；断开连接时确认状态角标仍可识别。
