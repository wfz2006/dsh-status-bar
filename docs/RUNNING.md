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
- 拖拉系统窗口边缘缩放。支持 Capsule / Compact / Workspace 三种密度，短窗口降级；不是整体缩小字体。
- `−` 折叠，`×` 隐藏到托盘；托盘双击或 Ctrl+Shift+G 恢复；“退出”真正关闭 Glass。
- 会话下拉选择独立 Todo；“开发预览控制”可重播、断线/重连、注入乱序事件，切换主题和系统材质。
- 默认不置顶，底部置顶开关由用户开启。
- Mock 播放一次：三项 Todo → 两项 Todo → 只读审批。进度仅表示 Todo 步骤数。
- 审批按钮始终禁用，不会向 DSH 提交任何决定。

## 材质与本地数据

默认可读的静态玻璃背景。系统 Acrylic 为可选试验项；程序可调用 Electron API，但未完成不同壁纸/驱动上的原生材质视觉验收，不能把 CSS 渐变称为系统桌面模糊。

窗口几何保存到 Electron `userData/window.json`，不保存原始对话、工具命令或 WS token。主题、置顶本轮为会话内偏好，尚未做持久化。首次运行不注册开机自启，也不更改 DSH 安装或原 Profile。

## 检查

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
```

桌面自动化实际运行 Electron，验证尺寸/会话切换/断线/重连/安全偏好，生成 `docs/evidence/*.png` 和 `desktop-smoke.json`。运行前退出手工打开的 Glass（单实例设计）。首次可能下载 Electron runtime。Playwright 1.56.1 在 Node 24 下有 DEP0190 启动器弃用提示；本项目未接收 shell 命令输入，renderer 无运行错误。

## 手动验收尚待完成

- 真正的鼠标拖拽/边缘缩放手感、托盘恢复、系统热键冲突、休眠唤醒。
- 100/125/150/200% DPI 全矩阵、多屏拔插与窗口恢复。
- 原生 Acrylic 的壁纸透射、低端 GPU、性能测量。
- Desktop 插件正常装载、真实任务进入 Glass、审批单 owner 所有权与实际允许/拒绝闭环。

完整 Windows 安装包、磁吸、跨重启展开尺寸偏好和真实 DSH 模式未交付。下一步见 `integration-matrix.md`。
