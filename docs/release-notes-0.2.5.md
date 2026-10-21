修复一轮外部核对报告确认的问题，把主进程到界面的投影改成增量传输，并把仓库收成「项目本体 + 读者需要的文档」。

## 修掉的问题

| 编号 | 问题 | 处理 |
|:--|:--|:--|
| BUG-01 | 审批与提问混排时入口和计数算错 | 审批与提问各自独立计数，1+1、2+1 两种混合队列都已按真实按钮断言 |
| BUG-02 | 忽略「自动展开」开关，强制展开 | 去掉旁路，回到原状态机执行用户偏好 |
| BUG-03 | 新请求覆盖手动尺寸 | 保留 manual 标记、形态和已接受的原生尺寸，150% DPI 以系统接受值为基线 |
| BUG-04 | 通知置顶被提前返回跳过 | 置顶先于提前返回执行，并避免重复系统调用 |
| BUG-05 | 一次列表失败就断线 | 实时流继续接收；列表 10–60 秒退避、单次在途；401/403 仍断线 |
| BUG-06 | 跨轮残留的旧请求 | `turn/start`、`turn/end` 关闭遗留请求且不代发决定；历史回放恢复最终 phase 后才发布 |
| BUG-07 | 命令值里混入凭据 | 除敏感键外过滤 `Authorization: Basic/Bearer`、常见 token/env/CLI 参数与 URL userinfo；脱敏预览不具备完整参数审批资格 |
| BUG-08 | 重载把一次性认证链接重放 | 只重载 renderer，Main 的认证与订阅保持不变 |
| BUG-09 | 旧式问题被假确认 | 没有 durable `callId` 的问题保持只读、拒绝投递；`void` 不等于 answered |
| BUG-10 | 长驻 Map 只增不减 | 工具摘要每会话 256 项、已结束请求每类最多 100 条、删会话/断线即清理；用结构化比较替代整段 JSON 指纹 |
| BUG-11 | 半开 WebSocket 察觉不到 | 15 秒 Ping + 存活检查，流量/Pong 都算活；audit 子流结束后先撤请求再按列表恢复 |
| DOC-01 | 文档与实现漂移 | 更正尺寸、启动数据源、默认取样、插件启动器与测试数 |
| CODE-01 | 本机硬编码路径 | 改为环境变量、标准安装目录、已保存路径与用户选择的 exe |

另外：异步提问的回答在会话删除或连接更换后，迟到的 RPC 结果不会再被标成 answered；跨会话缓存用分层 Map，带冒号的 ID 不会误清别的会话。

## 性能与内存

- **增量投影**：Main → preload 只发变化的会话，保留全量基线、周期全量刷新与 revision 衔接；缺帧时界面先标 stale、审批不可操作，Main 侧业务校验不变。
- **隐藏窗口不再推送业务投影**，显示时发最新完整状态，Main 仍跟进请求生命周期。
- 过程行按实际显示字段 memo，Todo 跨 IPC 复用同一对象；长标题逐字动画上限 32 字符，完整文本仍保留；入场动画结束后不再保留 fill effect。
- 没有降低磨砂取样分辨率，也没有减少 RGB 通道或在展开期间停用折射。

## 测试

`pnpm test`：**20 个文件 / 171 个用例**（上一版 15 / 142）。新增 `tests/host-transport.test.ts`、`tests/projection-channel.test.ts`、`tests/report-regressions.test.ts`、`tests/retention.test.ts`、`tests/window-controller.test.ts`。`npx eslint .`、`pnpm typecheck` 干净。

## 仓库瘦身

只保留项目本体与读者需要的文档：删掉 `reports/`（270 个文件 / 13.5 MB 的历轮验收截图与 JSON）、`docs/evidence/`（2.5 MB 证据截图与上游摘录）、`docs/references/`、`docs/superpowers/`、`TASKS.md`、`PROMPT_FOR_CODEX.md`、`docs/README_SPEC.md` 以及旧版发布说明；README 用到的 6 张截图移到 `docs/images/`。

结果：**498 个跟踪文件 / 18.6 MB → 189 个 / 2.68 MB**。验收脚本仍会把新证据写到本机 `reports/`（已加入 `.gitignore`，不入库）。

## 安装

```sh
# npm：870 kB，首次启动自取 155 MB 运行时
dsh plugin --profile web add dsh-status-bar-plugin

# 自包含 tarball：155 MB，一次装完，运行期不再联网
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## 行为与要求

- 胶囊 288×50 DIP，点开进入速览与详情；有待审批时打开审批面孔。
- 折射（约 13 物理像素偏折 + RGB 色散）默认关闭，在设置里打开；只读取窗后那一小条，不保存、不上传。
- 审批绝不自动放行：点击才发决定，卡片只在收到匹配的 `approval/decided` 后确认。
- Windows 11 x64；桌面端是独立进程，需要 GPU 加速的 Electron 运行时（tarball 自带，npm 包首次启动下载）。
- MIT 许可；内置 Electron 运行时保留其自身许可证文件。
