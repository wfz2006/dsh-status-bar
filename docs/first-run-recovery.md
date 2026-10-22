# 插件首次启动恢复（2026-10-22）

用户提供的记录表明：市场安装的 npm 包是轻量启动器，首次还要下载约 155 MB 的 Electron/桌面运行时；旧下载在网络停顿后长期没有反馈。人工填入 `runtime-0.2.5` 缓存解决的是本机这一轮启动，没有修复其他新用户的下载路径。

本轮已直接核对已安装的 0.2.5 启动器及 Git 中的源码：旧实现只向控制台报告、使用随机临时文件且失败删除，不支持续传、单次下载超时 15 分钟、失败后停止自动尝试。缓存中的 app manifest 为 0.2.5、Electron version 文件为 44.8.0；本轮没有重新执行用户记录中的 155 MB 线上测速，不能把那组 Node/curl 速度当作本轮测量。

## 修复范围

- [x] M5-27 插件首次启动恢复：源码、16 项回归、原生进度 UI、真实 Electron 联调与打包清单核对完成。当前 Git 已不包含旧 `TASKS.md`，按用户要求不恢复该历史文件；本节作为本次任务记录。

按用户明确选择，仅恢复 `packages/dsh-status-bar` 的项目源码/清单/许可证和随包展示资源；其他清理结果保持原样。新增启动修复、测试和本说明，没有恢复此前已清理的历史报告、构建缓存或安装目录。

- 系统 curl 优先，缺失/无法执行时退回 Node；连接/空闲/总时长均有界限，最多三次自动尝试。不会依赖 DSH 是否把 console 日志展示给用户。
- 使用版本固定的 Release 地址。新默认和旧 manifest 中本项目的 `latest` 地址均按当前插件版本解析；显式自定义地址保留，但解压后还要匹配版本。
- `.tgz.part` 和校验元数据保存在版本缓存旁。仅在 URL 指纹和强 ETag/Last-Modified 可核实时续传，使用 If-Range；服务端拒绝续传时重新下载。损坏压缩包不会在每次重试时被反复复用。
- 解压前检查路径/链接，验证版本、app 主入口和 Electron 文件。只有验证后的目录才替换缓存；同版本并发准备通过锁协调。崩溃遗留的已知 staging 目录在持锁后清理。
- Windows 原生 WPF 窗口显示进度、失败原因和重试按钮，不需要先有 Electron。取消/关闭停止本轮准备，保留可验证的已下载部分；再次启动插件时继续。完整缓存直接启动，不闪出准备窗口。
- 插件销毁会取消下载/重试/解压，清理锁与本次 staging；迟到的准备结果不会启动悬浮窗。spawn 错误有可见反馈。保留 `ELECTRON_RUN_AS_NODE` 清理、仅传递当前认证链接的约束。
- GitHub 打包 workflow 按输入 tag checkout，并验证 tag 与 package version 一致，避免把其他版本运行时上传到固定版本下载地址。未在本轮触发远端工作流。

进度文件只存状态、字节数和消息，不存 Host 链接、Cookie 或 token。取样、玻璃材质、审批权限和渲染器行为没有变更。原生进度仅针对 Windows；非 Windows 仍有日志，`showStartupUI: false` 用于明确不需要窗口的部署。

## 本轮验证

原始复现测试使用真实 HTTP 响应并在 64 KiB 后断开。旧实现只请求一次并停住，未在时限内恢复；新实现的系统 curl 使用 Range 续传，再校验/解压并启动。

`tests/plugin-startup.test.ts` 新增 16 项测试，覆盖中断恢复、显式重试、无提前认证、销毁后不启动、缓存命中、父环境 Node 模式、spawn 失败、关闭自动启动、固定版本、错误版本、并发与取消等待者、忽略 Range、Node 续传/空闲超时、缺少校验信息、curl 缺失、损坏包与遗留 staging。全套 21 文件 **187 测试通过**，lint/typecheck/build 通过。

`pnpm test:plugin-startup` 包含两个真实 Windows 检查：

1. 原生 WPF 控件显示进度和中文；失败露出重试按钮，点击产生 retry 命令且保留窗口，取消产生 cancel 并关闭。截图来自测试窗自身的 WPF RenderTargetBitmap，未抓取用户桌面。
2. 临时轻量插件 → 本地下载中断/连续 503 → 可见原生失败窗口 → retry → 64 KiB 起点续传 → 真实 Electron / 生产 renderer → 测试 Host 会话 → 销毁关闭 Electron。失败时没有兑换 Host token，成功后恰好认证一次，原生准备窗口关闭。

完整联调为了避免重复复制/传输 155 MB，使用小型本地归档和文档已有的 `electronBinary` 配置，启动工作区真实 Electron 44.8.0。生产 Main/preload/renderer、原生进度、系统 curl、tar 和 HTTP/WS 均实际执行；没有把虚假的可执行文件当成真实启动成功。测试目录、Electron userData 与测试 Host 独立，不读取或修改用户 DSH Profile。

原始结果与图片在 `.tools/first-run-ui/`、`.tools/first-run-e2e/`；这些是可重新生成的测试产物，不纳入发布包。

```powershell
pnpm lint
pnpm typecheck
pnpm exec vitest run --maxWorkers=1
pnpm build
pnpm test:plugin-startup
cd packages/dsh-status-bar
npm pack --dry-run --ignore-scripts --json
```

打包清单已检查：`lib/download.js`、`runtime.js`、`startup-status.js` 和 `startup-window.ps1` 随轻量 npm 包携带。原生准备窗口不要求目标机器额外安装 npm 依赖。

## 交付边界

本轮仅修改本地源码并构建验证，未推送、未发布 npm/GitHub Release，也未替换当前已安装插件或更改其启用状态。市场上的 0.2.5 在后续发版前仍使用旧下载器，不能因为本机已有完整缓存就认定市场安装已全面修复。真实公网停顿/续传和全新机器安装速度仍需新版本发布后的实网验收；本轮没有重装用户实际插件来代替这项验证。
