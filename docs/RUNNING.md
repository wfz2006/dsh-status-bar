# 运行 DSH Glass 液态玻璃预览

项目：`D:\codexwork\dsh\dsh-glass-spec`。本版为 **Mock 演示**，尚未连接官方 DSH Desktop 的当前任务，真实审批保持禁用。

```powershell
cd D:/codexwork/dsh/dsh-glass-spec
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

也可双击 `启动预览.cmd`。已打开旧版时，从旧窗口的“退出”关闭后重新启动；单实例会让重复启动只恢复原窗口。开发热更新：`pnpm dev`。

## 操作与四种形态

- 默认 300×56 DIP 任务胶囊：状态、当前任务、真实 Todo 步骤数；没有固定品牌、Mock 徽章或底栏。任务名称本身可以包含 DSH Glass。
- 点击胶囊 → 340×168 速览；点击速览内容 → 400×280 详情。待处理入口打开 400×340 审批视图。扩展约 320ms、收起约 260ms，原生窗口自身连续变形。
- 胶囊整体可拖动，移动超过 6px 不触发点击；其他形态顶部细区可拖动。八边/角支持手动缩放，内容重排与内部滚动。手动尺寸不被新请求自动覆盖。
- 右键窗口或托盘菜单：切换形态、置顶、设置、活动、查看 DSH 原窗口、重连、隐藏和退出。Esc 返回/收起，Shift+F10 打开菜单，Ctrl+Shift+G 显示/隐藏；托盘双击恢复。
- 设置提供主题 auto/light/dark、玻璃强度、启动形态、审批自动展开、完成自动收起、动画强度和置顶行为。自动展开/收起默认关闭；完成只依据明确 finished 状态，不依据 Todo 百分比。
- “数据源：Mock 演示 · 真实 DSH 未接入”保留在原生菜单、托盘提示与设置中；调试菜单可重播、断线、乱序、并发审批、长标题/空 Todo、明确完成状态。
- 多请求逐项保留，复制预览按 Session/request/runtime/epoch 匹配。完整参数缺失会明确提示；允许/拒绝始终禁用，不会发送 DSH 决定。

## 材质与本地偏好

默认 Windows Acrylic 加透明窗口，浅色珍珠/冰蓝表面与局部文字承载层；可切换透明和实色降级。没有系统厚边框或外阴影，保留细微光学边缘。使用局部高光和光晕模拟光学质感，**没有采样桌面像素做物理位移折射**，也不自动识别壁纸亮度。自动主题依据系统主题。

偏好存储到 Electron `userData/glass-ui.json`：主题、强度、自动行为、形态、位置/尺寸和手动尺寸标记；不保存对话、工具命令或 WS token。旧 `window.json` 仅迁移位置；默认以胶囊启动，选择“记住上次”后恢复形态与尺寸。原生多屏边界按目标显示器计算；完整多屏实机矩阵仍待验收。

测试可设置绝对路径 `GLASS_USER_DATA_DIR` 使用独立 Profile。自动化自行创建临时 Profile，不要求关闭手工运行的 Glass，也不修改 DSH 安装/Profile。首次运行不开启开机自启。

## 验证

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:desktop
node scripts/preferences-acceptance.mjs
node scripts/desktop-smoke.mjs --native
```

28 项单元测试覆盖协议、桥、投影、Mock 快照与展示模型。Electron 回归实际操作胶囊拖动、四形态、缩放、设置、会话切换、并发队列、重连、完成/断线、减少动画、隐藏/恢复和安全配置。偏好验收使用两次实际启动，确认手动尺寸及设置跨重启保留且不被审批覆盖。

证据集中在 `docs/evidence/redesign/`，包括四形态、设置、断线、双请求、长标题截图、原生受控背景合成截图、窗口尺寸事件时间序列和 Electron 进程 CPU/工作集采样。尺寸事件数不是显示帧率，短时 CPU 数据不是完整性能基准。Playwright 启动器在 Node 24 下仍输出 DEP0190 提示。

## 尚未验收/交付

- 真实 DSH Desktop 观察与审批 owner/允许/拒绝闭环仍 BLOCKED。
- 100/125/150/200% DPI 全矩阵、多显示器拔插、休眠唤醒、全屏覆盖与原生托盘/热键冲突仍需完整手测。
- 更多壁纸、低端 GPU、长时间负载与呈现帧耗时基准尚未覆盖。
- 未交付安装包、磁吸、开机启动、穿透和真实像素折射。

分阶段修改、文件职责、证据与后续目标见 [重设计验收记录](redesign-audit.md)。
