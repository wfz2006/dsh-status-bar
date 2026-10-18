# 窗口落位与随 DSH 退出（2026-10-18 晚）

## 现象

- 胶囊/速览窗口默认落在屏幕最上方（`y = workArea.y + 80`），紧贴 DSH 顶栏，视觉上过于靠上。
- 通过启动器插件拉起的 Glass 在 DSH 退出后仍留在桌面。

## 修复

- `apps/desktop/src/main/index.ts` 的 `position()`：静止位置改为 `y = max(area.y + 96, area.y + area.height - 420)`，即右下象限、给 360px 的大窗留出成长空间。
  - 旧 `window.json` 中落在顶部 160px 内的位置做一次性迁移：写入 `window-placement.json` 标记后不再干预，用户之后手动拖到顶部会被尊重。
  - `window.json` 本身只读不写，旧文件保持原样。
- 启动器协议新增 `--launcher-pid=<pid>`（`apps/desktop/src/shared/launch.ts` 的 `launcherPidFromArgs`，仅接受正十进制 pid）：
  - `packages/dsh-plugin/lib/index.js` 启动子进程时带入 `--launcher-pid=${process.pid}`；插件 dispose 时 `child.kill()` 并在 Windows 上执行 `taskkill /pid <pid> /t /f` 清理进程树。
  - Glass 每 3s 用 `process.kill(pid, 0)` 检查宿主；仅在 `ESRCH` 时 `app.quit()`，避免权限错误误杀。
  - 第二实例（插件重新拉起时）会通过 argv 里的新 `--launcher-pid` 重定向看门狗，避免旧 pid 立即触发退出。

## 验证（隔离 Electron，`ui-lifecycle-check.mjs`）

| 检查 | 结果 |
| --- | --- |
| 全新 profile 落位 | `y=492`，工作区 `912` 高（旧默认 `y=80`） |
| 旧顶部位置迁移 | `{x:640,y:60}` → `y=492`，x 保留 |
| 迁移标记 | `window-placement.json` 写入成功 |
| 旧 `window.json` | 仍为 `{x:640,y:60}`，未被改写 |
| 宿主退出 | 杀掉 launcher 进程后窗口在 9s 内关闭 |

lint 0、typecheck 0、13 文件 123 测试全过。

## 限制

- 插件代码在 DSH 启动时加载，需重启 DSH 才会带上 `--launcher-pid` 与关闭联动。
- 手动直接启动 Glass（不经插件）时没有 `--launcher-pid`，行为不变。
