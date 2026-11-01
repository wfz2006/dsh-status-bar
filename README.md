# DSH Status Bar

![DSH Status Bar 发布卡](docs/images/release-card.png)

> **让 DSH（DeepSeek Harness）的任务进度，安静地陪在桌面上。**

选择熟悉的液态玻璃，或让小鲸鱼带着一片水域陪你工作。任务进度和需要你决定的事，都可以在桌面上随时查看。它是看板和传话筒，决定权始终在你手里。

📖 **原版玻璃图文介绍**：[介绍.html](介绍.html)（下载后可用浏览器打开；长图见 [介绍.png](介绍.png)）

---

## 📖 这是什么？（30 秒版）

你让 DSH 干活的时候，是不是总得反复切窗口看「跑完没」？**DSH Status Bar** 是一个桌面悬浮窗：任务跑到哪、下一步是什么、有没有事等你拍板，瞟一眼就能看到。可以选择原版玻璃，也可以切换到鲸鱼水池。

Windows 11 优先，Electron 实现，单实例常驻，不注册托盘图标、不占任务栏。

## 🐋 鲸鱼水池：给小鲸鱼一片自己的水域

**0.3.0 新增可选外观。** 安静时是一只会动的小鲸鱼；点击后，它游过的水痕铺开成任务面板，水下光影留在水体里。面板展示当前会话的任务进度；需要确认时会有提示，详情、会话切换和待处理请求仍使用原来的界面与校验。

| 清流 | 轻舟 | 水笺 |
|:--:|:--:|:--:|
| ![鲸鱼水池清流排版](docs/images/pool-clear.png) | ![鲸鱼水池轻舟排版](docs/images/pool-stream.png) | ![鲸鱼水池水笺排版](docs/images/pool-letter.png) |
| 纵向排列，清晰舒展 | 横向排列，轻快紧凑 | 居中标题，安静柔和 |

> 图片来自本地开发预览，使用演示数据；实际内容取决于当前连接和会话状态。

在 **设置 → 外观形态** 或窗口菜单中选择「鲸鱼水池」，再按喜好选择清流、轻舟、水笺三种排版，以及饱满水珠、柔角水镜、圆头水滴三种轮廓。切换外观时会重新适配窗口尺寸。

首次安装或首次更新到包含此功能的版本时，会出现一次介绍：可以立即体验，也可以保留当前形态。原版玻璃仍是默认选项，已有偏好不会自动切换；以后可在设置中重新查看介绍。

![鲸鱼水池首次介绍](docs/images/first-install-intro.png)

水池使用现有会话数据，不会用演示任务冒充真实工作；断线会显示断线状态。审批依旧需要用户明确操作并等待正式回执。更多实现与验证边界见 [鲸鱼水池说明](docs/whale-pool-form.md) 和 [0.3.0 发布说明](docs/release-notes-0.3.0.md)。

## 🫧 原版玻璃：从小胶囊到审批台

| | |
|:--|:--|
| ![胶囊](docs/images/capsule.png)<br>**胶囊 · 平时**：小鲸鱼标志 + 一行任务名 + 「3 轮 · 42 步」的小字进度。小到可以贴着屏幕边缘安静待着。 | ![速览](docs/images/peek.png)<br>**速览 · 瞟一眼**：会话转录（思考 / DSH / 你）、当前步骤，外加吞吐与缓存这些小仪表。 |
| ![详情](docs/images/expanded.png)<br>**紧凑详情 · 看全程**：「过程 / 步骤」双标签，思考、工具调用、消息一条条排开，谁已完成谁已发送一目了然。 | ![审批](docs/images/approval.png)<br>**独立审批 · 拍板时**：「需要你的确认 2 项」，命令先预览再点「拒绝 / 允许一次」，拿不准还能跳回 DSH 原窗口处理。 |

胶囊 288×44 DIP 起，点击长大成速览，再点进入详情；有请求待处理时点击可打开审批视图。自动展开由设置控制，默认关闭，手动尺寸不会被新请求覆盖。扩展约 320ms，收起先 80ms 内容退场、再 260ms 原生窗口连续变化。

## 📖 这块玻璃是「真」玻璃

普通悬浮窗只是把背景涂白假装透明；这块玻璃是真的会「看穿」它背后的东西——只取窗后一小块画面（**不保存、不上传**），再用同一套透镜把它折射出来：窗后内容被压弯约 **13 个物理像素**，边缘还带着一丝丝彩虹（RGB 色散）。

![折射对照](docs/images/comparison.png)

> 对照实验（本次实测）：左「零位移」，右「开启折射与 RGB 色散」。拿真实窗后条纹做的实测，不是效果图。

普通启动时，只要原生取样助手可用且材质非实色，这项能力默认**开启**；设置中的“真实折射与色散”可为本次运行关闭它。隐藏窗口时暂停，显示后恢复；关闭取样或退出程序时停止。范围仅限本窗后方与最多 48 个物理像素边距，不保存、不上传。

![设置](docs/images/settings.png)

## 📖 定下的死规矩：按钮永远是你按的

玻璃只是传话筒，不是代理人：

- 审批必须等 DSH 回了正式「已决定」才算数，**绝不抢答**；
- 断线、过期、撤销、参数看不懂？那就只读展示，**绝不自动放行**——任何一次批准都来自你明确的一次点击；
- 连不上就明说连不上，不装作一切正常。

## 📊 数字小卡片

| 2 | 3 × 3 | 13 px | 0 |
|:--:|:--:|:--:|:--:|
| 可选外观：原版玻璃 / 鲸鱼水池 | 水池排版 × 轮廓 | 真实折射偏折（实测物理像素） | 次自动放行（永远是 0） |

## 🚀 快速开始

要求：Windows 11 x64、Node.js、pnpm（`packageManager: pnpm@12.4.1`）。

```powershell
pnpm install
pnpm build
pnpm start
```

也可以直接双击 `启动预览.cmd`。开发热更新用 `pnpm dev`。普通启动为 **DSH 数据源、尚未连接**；Mock 仅从调试菜单显式开启，自动化夹具使用 `GLASS_SMOKE=1`。连接真实 DSH 见下。

### 装成 DSH 插件（推荐）

不用自己 `pnpm build`：插件带上构建好的桌面端和 Electron 运行时，装上就能开。开启 DSH 时它会自己把官方认证链接交给玻璃，不用再手动粘贴。

```powershell
# npm 包约 880 kB，首次启动获取约 155 MB 运行时（缓存到版本目录）
dsh plugin --profile web add dsh-status-bar-plugin

# 或者自包含 tarball：155 MB 一次装完，运行期不再联网
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

装好后重启 DSH，玻璃会跟着启动；不想要它自动开，就在 profile 补丁里写 `- id: dsh-status-bar-plugin` + `config: { autoLaunch: false }`。细节见 [packages/dsh-status-bar/README.md](packages/dsh-status-bar/README.md)。

隐藏窗口后按 `Ctrl+Shift+G` 恢复；退出悬浮窗后，在 DSH 任意会话输入 `/status-bar` 即可重新打开。这个命令不保存或重放认证 token，只会在需要时向当前 DSH 取一条新链接。

### 连接真实 DSH（实验）

设置 → 官方认证地址 → 粘贴 DSH 启动器输出的认证链接并连接。凭据只留在 Main 内存，断线即失效、不落盘。

```powershell
pnpm test:live   # 隔离 DSH_HOME 下的真实 Host 联调（需要本机已安装 DSH）
```

真实官方 Desktop 的当前任务与真实审批仍未验收，状态以 [支持矩阵](docs/integration-matrix.md) 与 [ADR 004](docs/adr/004-authenticated-host.md) 为准。

## 🛠️ 技术积木

| 组件 | 说明 |
|:--|:--|
| Electron 44 + electron-vite 6 | 悬浮窗本体（`apps/desktop`） |
| React 19 + Zustand 5 | 界面与状态管理 |
| TypeScript（strict） | 全套类型约束 |
| 自研工作包 | `protocol` / `bridge` / `adapters/dsh` / `adapters/mock` / `dsh-status-bar` |
| Vitest + Playwright | 单元测试 + 桌面实测脚本 |
| ws | 本地 WebSocket 通信 |

## 📁 项目结构

```
apps/desktop          Electron 悬浮窗（main / renderer / shared + 光学取样助手）
packages/protocol     自研本地协议与数据类型
packages/bridge       宿主桥接
packages/adapters     dsh（真实 Host）/ mock（演示数据源）
packages/dsh-status-bar  DSH 插件（bundle：启动桌面端并把认证链接交过去）
tests                 单元测试
scripts               构建、验收、截图与联调脚本
docs                  产品 / 架构 / 协议 / 安全 / 决策文档，界面截图在 docs/images
```

## 📚 文档索引

- [鲸鱼水池](docs/whale-pool-form.md) ｜ [0.3.0 发布说明](docs/release-notes-0.3.0.md)：新外观、首次介绍与验证范围
- [运行与验收](docs/RUNNING.md)：怎么跑、怎么验、当前材质与偏好
- [性能与轻量化实测](docs/performance-optimization.md)：代码体积、流式传输、两轮内存对照及未解决的 GPU 开销
- [工具过程同步延迟修复](docs/process-sync-latency.md)：消除冷会话轮询等待、旧响应覆盖及工具行淡入延迟
- [代码审查与交互细节修复](docs/review-ui-2026-10-25.md)：请求草稿、特殊 ID、键盘导航、复制反馈与生产动效
- [产品边界与验收条件](docs/00_PRODUCT_PRD.md)
- [总体架构](docs/01_ARCHITECTURE.md) ｜ [自定义本地协议](docs/02_PROTOCOL.md) ｜ [状态模型](docs/08_STATE_MODEL.md)
- [DSH 集成与已验证接口](docs/04_DSH_INTEGRATION.md) ｜ [安全测试](docs/05_SECURITY_TESTING.md)
- [决策记录](docs/07_DECISIONS.md) ｜ [执行计划](docs/06_EXECUTION_PLAN.md)
- [开发规格](DSH_GLASS_MASTER_SPEC.md) ｜ [UI 重设计规范](DSH_Glass_Liquid_UI_Redesign_Spec.md) ｜ [变更记录](docs/release-notes-0.2.5.md)
- 界面截图见 `docs/images/`；验收脚本会把新证据写到本机 `reports/`（不入库）

## 📌 当前状态

- 原版玻璃保留任务胶囊、速览、紧凑详情和独立审批；鲸鱼水池作为独立外观可选，排版与轮廓偏好本地保存。
- 150% DPI 下拖动「窗口自己越长越大」的 bug 已修复：移动只挪位置，不再改动尺寸。
- 真实折射与 RGB 色散已用真实窗后条纹实测（13 px 偏折），隐藏 / 停用 / 实色 / 异常退出均有回归；正式入口仍为 Electron。
- 审批只在收到匹配的 `approval/decided` 后确认；提问只在权威回执后确认；无法验证的参数保持只读。
- 仍有未验区域：真实用户 Desktop 任务、模型驱动的审批/提问尚未完成实机闭环，见 [ADR 004](docs/adr/004-authenticated-host.md)。

## 说明

- 主要服务 Windows 11 x64；macOS / Linux 暂不承诺。
- 不替代 DSH 本体：不写代理模型、会话引擎、工具运行器。
- 本项目以 [MIT License](LICENSE) 开源；引用或二次分发请保留版权声明。
