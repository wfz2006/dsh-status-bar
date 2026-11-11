The whale pool now responds when you drag it, and the whale keeps its place while the window opens near a screen edge. This update also adds five notification sounds and improves the classic glass peek and the docked whale orb.

## What changed

- **Whale pool.** The water follows the direction and speed of a drag, then settles after a gentle sway. The whale and its bubbles have a reserved area in each of the three layouts, so the task text stays readable when the pool opens or the window is small.
- **Opening near an edge.** The floating whale settles at the drop point before expanding, including when clicked immediately after release. The window is positioned in one step. The whale stays at its starting position until it begins to swim, turns toward the destination when needed, then turns back as it reaches the task panel.
- **Edge docking.** The collapsed whale pool can dock as a small water orb. When you drag a docked orb back onto the desktop and release it, the appearance expands at the drop position.
- **Classic glass.** Dragging the peek view shifts the reflection slightly and settles at the drop position.
- **Notification sounds.** Choose from 经典双音, 水滴, 玻璃风铃, 木琴 and 电子脉冲 under **Settings → Window → 任务提醒**. The two preview buttons play the sounds for task completion and requests that need attention.

We tested drag, release and immediate click at all four edges and four corners on Windows 11 at 150% display scaling. All 16 native window trials opened in one resize.

## Install on Windows 11 x64

Use the self-contained GitHub bundle in a terminal with the DSH CLI installed, then restart DSH.

```powershell
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/download/v0.4.1/dsh-status-bar.tgz
```
