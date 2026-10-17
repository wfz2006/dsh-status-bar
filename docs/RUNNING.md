# 运行 DSH Glass 开发预览

项目：`D:\codexwork\dsh\dsh-glass-spec`。本版只连接 Mock，不连接官方 DSH 的当前会话。

```powershell
cd D:/codexwork/dsh/dsh-glass-spec
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

也可双击项目里的 `启动预览.cmd`。开发热更新：`pnpm dev`。

## 操作

- 初始 180×54 DIP 胶囊：点击 DSH 内容展开；左侧抓手可拖动，工作台顶部可拖动。
- 胶囊展开/折叠为约 420ms 的原生窗口形变，系统减少动画时立即切换。默认展开约 340×300 DIP。
- 拖拉窗口边缘/角落缩放：为去掉 Windows 额外外框，改用应用自己的拖拉区域。支持 Capsule / Compact / Workspace 三种密度，短窗口降级；不是整体缩小字体。
- `−` 折叠，`×` 隐藏到托盘；托盘双击或 Ctrl+Shift+G 恢复；“退出”真正关闭 Glass。
- 会话下拉选择独立 Todo；审批详情默认收起，展开后查看命令与不可用的操作按钮；“活动与设置”中可重播、断线/重连、注入乱序事件，切换主题和材质。
- 默认不置顶，底部置顶开关由用户开启。
- Mock 播放一次：三项 Todo → 两项 Todo → 只读审批。进度仅表示 Todo 步骤数。
- 审批按钮始终禁用，不会向 DSH 提交任何决定。

## 材质与本地数据

默认启用 Windows 原生 Acrylic + 透明窗口，提供清透/实色降级。已在本机受控背景上通过 Windows 合成截图检查透色与模糊：见 `evidence/liquid/native-acrylic.png`、`native-clear.png`。窗口关闭系统 thick frame/shadow，原生圆角区域与页面轮廓一致，移除旧的页面整圈白描边。

边缘折射感使用局部高光、微色散光晕与展开时的短光流，不采样桌面像素，因此不是对桌面图像做真实位移折射。不同壁纸、显卡和系统透明效果设置仍可能改变 Acrylic 表现，实色模式保证可读性。没有持续运转的全窗 Shader。

窗口几何保存到 Electron `userData/window.json`，不保存原始对话、工具命令或 WS token。主题、置顶本轮为会话内偏好，尚未做持久化。首次运行不注册开机自启，也不更改 DSH 安装或原 Profile。

旧预览的大窗口几何在读取时一次迁移到紧凑尺寸，保留位置；新格式 `presentationVersion=2` 保存用户之后主动调整的尺寸。

## 检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
pnpm test:liquid
```

桌面自动化实际运行 Electron，验证尺寸/会话切换/断线/重连/安全偏好，生成 `docs/evidence/*.png` 和 `desktop-smoke.json`。运行前退出手工打开的 Glass（单实例设计）。首次可能下载 Electron runtime。Playwright 1.56.1 在 Node 24 下有 DEP0190 启动器弃用提示；本项目未接收 shell 命令输入，renderer 无运行错误。

## 手动验收尚待完成

- 自定义右下角实际鼠标缩放已通过自动化；其余拖拽手感、托盘恢复、系统热键冲突、休眠唤醒仍待完整手测。
- 100/125/150/200% DPI 全矩阵、多屏拔插与窗口恢复。
- 受控背景原生 Acrylic 已检查；更多壁纸、低端 GPU、性能测量仍待补齐。
- Desktop 插件正常装载、真实任务进入 Glass、审批单 owner 所有权与实际允许/拒绝闭环。

完整 Windows 安装包、磁吸、跨重启展开尺寸偏好和真实 DSH 模式未交付。下一步见 `integration-matrix.md`。
