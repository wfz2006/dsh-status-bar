# 运行 DSH Glass 液态玻璃预览

项目：`D:\codexwork\dsh\dsh-glass-spec`。默认 **Mock 演示**；另提供实验性的 DSH 认证接入（设置面板粘贴官方启动器输出的认证链接）。官方 Desktop 的当前任务与真实审批仍未验收；认证、会话/Todo 观察链已在真实官方 Host（隔离 DSH_HOME）上实装联调，协议侧应答能力由 Fake Host 合同测试覆盖。

```powershell
cd D:/codexwork/dsh/dsh-glass-spec
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

也可双击 `启动预览.cmd`。已打开旧版时，从旧窗口的“退出”关闭后重新启动；单实例会让重复启动只恢复原窗口。开发热更新：`pnpm dev`。

### DSH 认证接入（实验）

设置 → 官方认证地址 → 粘贴启动器输出的认证链接并连接；凭据只留 Main 内存，断线即失效，需重新粘贴。Fake Host 合同测试（`pnpm test`）与真实官方 Host 实装联调（`pnpm test:live`）均覆盖该链路；实装联调要求本机已安装 DSH，使用仓库内隔离 `DSH_HOME`（`.local-dsh-probe/`）与只读探测插件，不读取、不修改用户原 Profile，日志/证据一律不落 token。该路径不代表官方 Desktop 当前任务已联通，真实审批仍未验收。

## 操作与四种形态

- 默认 300×52 DIP 任务胶囊（圆角 18 DIP）：状态、当前任务、真实 Todo 步骤数；没有固定品牌、Mock 徽章或底栏。任务名称本身可以包含 DSH Glass。任务完成时胶囊底色转为绿色高亮并显示「已完成」。胶囊右侧同时显示轮数/步数；速览与详情补充 tok/s、总 token、缓存命中率与上下文占用（来自会话投影，缺失时自动隐藏）。
- 点击胶囊 → 340×168 速览；点击速览内容 → 400×280 详情。有待处理请求时点击胶囊直接打开 400×340 审批视图。扩展约320ms；收起先80ms内容退场、再260ms原生窗口连续变化。
- 胶囊整体可拖动，移动超过 6px 不触发点击；其他形态顶部细区可拖动。八边/角支持手动缩放，内容重排与内部滚动。手动尺寸不被新请求自动覆盖。
- 右键窗口或托盘菜单：切换形态、置顶、设置、活动、查看 DSH 原窗口、重连、隐藏和退出。Esc 返回/收起，Shift+F10 打开菜单，Ctrl+Shift+G 显示/隐藏；托盘双击恢复。
- 设置提供主题 auto/light/dark、玻璃强度、启动形态、审批自动展开、完成自动收起、动画强度和置顶行为。自动展开/收起默认关闭；完成只依据明确 finished 状态，不依据 Todo 百分比。默认置顶为「始终」，窗口启动即尝试开启真实折射与色散（原生取样助手可用且材质非实色时）。
- “数据源：Mock 演示 · 真实 DSH 未接入”保留在原生菜单、托盘提示与设置中；调试菜单可重播、断线、乱序、并发审批、长标题/空 Todo、明确完成状态。
- 多请求逐项保留，使用顶部数字切换；正文独立滚动，底部拒绝/允许一次始终可见。复制预览按 Session/request/runtime/epoch 匹配。完整参数缺失会明确提示；允许/拒绝始终禁用，不会发送 DSH 决定。

## 材质与本地偏好

默认透明原生窗：整面蓝灰染色/渐变已撤销，文字使用实色并加实字重，没有描边或文字阴影。设置新增“真实折射与色散”，每次普通启动默认关闭，开启后只取样本框后方及少量边距，不保存、不上传；隐藏暂停、实色/Acrylic/异常停止。默认主题依据系统主题。

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
pnpm test:approval-layout
node scripts/layout-matrix.mjs
pnpm test:native-redesign
```

32 项单元测试覆盖协议、桥、投影、Mock、展示模型、同源透镜位移和区域帧边界。Electron 回归实际操作胶囊拖动、四形态、缩放、设置、会话切换、并发队列、重连、完成/断线、减少动画、隐藏/恢复和安全配置。偏好验收使用两次实际启动，确认手动尺寸及设置跨重启保留且不被审批覆盖。

用户拒绝旧材质后完成 `experiments/tauri-glass` 原生对照，backdrop位移被系统拒绝。随后用户明确授权限定区域取样，已实装并验证真实输入上的偏折/RGB分离；最新证据见 `reports/desktop-optics/`。正式入口没有迁移。开启折射时系统录屏可能不显示本窗，这是排除自身、防止画面递归的机制。

`pnpm build` / `pnpm dev` 自动用本机 .NET Framework 编译小型区域取样助手，不另装编译器。普通启动必须在“设置 → 真实折射与色散”手动开启。也可显式 `pnpm --filter @glass/desktop exec electron . --desktop-optics` 为本次启动开启；该参数/开关状态不写入偏好。

新增验收：`node scripts/desktop-optics-acceptance.mjs`，以及 Python运行 `scripts/analyze-desktop-optics.py`。图片仅使用受控测试窗口，不导出用户真实桌面。

最新一次集中整改证据在 `reports/electron-redesign/`：同条件原生材质矩阵、12张四形态截图、20次变形与长命令滚动录屏、资源采样和Gate A决策。`docs/evidence/redesign/` 保留功能回归与早期原生样本，不能把旧材质截图当作本轮默认外观。窗口事件数/rAF间隔/录制30Hz均不代表呈现帧率。Playwright启动器在Node24下仍有DEP0190提示。

## 尚未验收/交付

当前材质附带8%中性黑底，文字与高光不随之变暗。可用控件有悬停亮边、按下内侧阴影、键盘焦点；动画关闭/减少时反馈即时显示，禁用审批保持不可操作。详见`reports/interaction-feedback/`。

已按确认的成熟产品方向统一视觉，默认中性内容与单冷蓝强调，状态色按需出现；设置分为外观/行为，开关仍支持label点击和Space。新样张与验证见`reports/refined-ui/`，原玻璃/拖动/审批限制保持。

内部按钮、命令框与提示条已去除背景模糊、默认雾底与外阴影，采用清晰透光、薄功能染色和边缘反光，文字仍为实色；“玻璃强度 → 易读”会增加局部阅读衬底。清透/旧磨砂/实色原生输入对照见`reports/crystal-controls/`。

截图反馈后的细节：顶部操作为内缩图标组，返回入口位于面板标题左侧；详情行支持Tab/Enter展开收起，箭头随展开旋转。已停用露出系统方角的Acrylic对照选项，旧值自动迁为transparent，其余偏好保留。35项单测；参考及原生角像素复测见 `reports/chrome-redesign/`。

最新交互：标题、任务文字和空白区域均可拖动，跨过 6px 阈值才移动；命令仍可选中复制。右上角提供收起与菜单。亮背景主标题/正文纯黑，操作及进度蓝、命令紫、待确认提示琥珀、完成/允许绿、拒绝/错误红；局部控件底色更鲜明，边缘为1.5px内亮边。Windows 移动使用助手的独立 `--position` 模式，仅移动本窗、不采集画面；停止拖动空闲 1.2 秒退出，屏幕取样开关仍独立且默认关闭。详见 `reports/move-size/` 与 `reports/ui-clarity/`；当前单元测试 34 项。

最新细调：胶囊与原生裁剪圆角24 DIP，透明材质黑底10%；内部图标按下70ms响应、松开360ms轻微回弹，按钮命中区域和光学层固定。减少/关闭动画及系统减少动画均关闭弹性位移。验证步骤和亮暗样张见 `reports/motion-polish/`（36项单测）。

设置 → 外观新增“玻璃底色”颜色选择器、“底色浓度”0–100%、“玻璃亮度”50–150%和“恢复默认”。默认黑色/10%/100%，实时预览并自动保存在本地，重启恢复；恢复默认只重置这三项。亮度需要开启“真实折射与色散”，关闭取样时保留亮度值且滑块禁用；实色模式保留三项并禁用，回到透明后恢复；取样现在默认在启动时开启，可在设置中关闭。自动主题按调色、调亮后的窗后画面选字色。验证记录见 `reports/glass-appearance/`，40项单测。

审批区已移除底部长句外跳入口，改为命令区右侧“打开DSH”图标。允许/拒绝底色18%，悬停26%、按压34%，通过外层提供预览反馈和不可提交说明；内部原生button继续disabled，未增加提交接口。展开时保持三通道色散，局部尺寸最多约32ms合并更新，不再整段切lite后补材质；取样画布仅在展开期间保留已有世界像素的可见交集，未扩大取样范围，拖动仍要求完整覆盖。证据见`reports/approval-morph/`（41项单测）。

最新字体/圆角细调：中文优先使用本机Noto Sans SC，西文使用准确的Segoe UI Variable Text名称，标题Medium、小字号适当增大、次要文字对比增强，不给文字加描边/阴影/透明度。胶囊圆角18 DIP，大框20 DIP，CSS/原生裁剪/折射继承一致。亮暗对照和CDP实际字体报告在`reports/type-clarity/`；41单测及窄审批回归通过。本轮未安装或打包字体，缺少这些系统字体时仍回退Microsoft YaHei UI。

字体进一步按用途搭配：标题Georgia/Noto Serif SC（17px，胶囊15px），正文Segoe UI Variable Text/Noto Sans SC，小字Segoe UI Variable Small，代码与数值Cascadia Mono；圆角同步收紧为胶囊18/大框20 DIP。独立角色表在`renderer/typography.css`，本轮使用已有系统字体，没有安装或打包字体。实际字体与亮暗样张见`reports/type-clarity/editorial.md`。

- 真实 DSH Desktop 观察与审批 owner/允许/拒绝闭环仍 BLOCKED。
- 100/125/150/200% DPI 全矩阵、多显示器拔插、休眠唤醒、全屏覆盖与原生托盘/热键冲突仍需完整手测。
- 更多壁纸、低端 GPU、长时间负载与呈现帧耗时基准尚未覆盖。
- 未交付安装包、磁吸、开机启动、穿透。

分阶段修改、文件职责、证据与后续目标见 [重设计验收记录](redesign-audit.md)。
