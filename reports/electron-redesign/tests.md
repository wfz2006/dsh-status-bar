# 功能与系统验收

## 实际运行的检查

- `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build`。
- `pnpm test:desktop`：实际 Electron 的拖动、四形态、设置、两请求队列/重连、手动尺寸保护、明确完成/断线取消收起、减少动画、安全沙箱。最新一次完整回归通过，renderer errors=0。
- `pnpm test:preferences`：隔离Profile两次启动，记住上次/主题/强度/手动尺寸与新审批不覆盖；通过。
- `pnpm test:approval-layout`：250/320/340 DIP，固定footer、请求1/2身份切换、详情滚动、重连及始终禁用决定；通过。改前此测试在250 DIP失败，证明修复针对实际裁切。
- `node scripts/layout-matrix.mjs`：Electron进程强制1/1.25/1.5 scale，380×250、400×320、560×640 的长命令审批footer与亮/暗无子卡片断言通过；JSON记录实际devicePixelRatio。
- `pnpm test:native-redesign`：12张原生桌面截图、20次录制的展开/收起、长命令详情滚动且footer位置不变、两主题任务子容器透明；通过。

## 测试边界与失败记录

- Windows实际显示设置为150%，进程强制scale测试不等于把Windows显示设置改为100%/125%；系统DPI切换、多屏拔插、休眠唤醒、全屏交互仍待手测。
- 初次并行桌面回归曾遇记忆尺寸断言失败（420期望/61实际）；独立重跑通过，未复现，不能把它宣称已定位修复。后续应在独占前台和多次重启中继续观察原生透明resize。此记录不因成功重跑删除。
- 控制checkbox等待IPC应答才改变的竞态已实际复现并修复为即时反馈/失败回读；完整回归已重跑。
- 原生截图曾被其他前台内容遮挡，失败样本已重拍覆盖；采集只用于受控测试，应用本身不采样桌面。
- 系统原生右键/托盘/热键尚未逐项人工点验。自动化调用的是真实Electron Menu回调，不声称完成系统菜单鼠标验收。
- 所有审批控制仍不可用；身份、失联、参数不全只读验证不等于真实允许/拒绝闭环。真实DSH接入保持BLOCKED。

## 录屏复现

`recordings/morph.mp4`：FFmpeg gdigrab裁切600×510物理像素，对应自建背景覆盖的400×340 DIP测试区域，30Hz录制，无音频；20次原生窗口展开/收起。`recordings/approval-scroll.mp4`：31行Mock预览、完整预览尾标记、正文来回滚动，决策footer不动。原始时序与rAF间隔在native-results.json。（这两个录屏文件未入库，复现参数保留在本节。）

录制程序位于项目忽略目录.tools/media，未安装到全局。复现时用工作区Python：`python -m pip install --target .tools/media imageio-ffmpeg==0.6.0`，或设置GLASS_FFMPEG为本机FFmpeg绝对路径。编码器日志中的30fps是录制采样设置/输出速率，不是应用呈现帧率。
