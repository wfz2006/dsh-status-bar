This release refines the classic glass capsule and extends the whale-pool appearance. Edge docking, a
reorganised settings panel, fourteen whale looks, four capsule motion presets and the context-usage hint are
new. The classic forms remain the default, existing preferences are kept, and the approval rules, the
glass-material sampling model and the plugin startup path are unchanged.

## Install

The self-contained tarball is the 0.4.0 install path (155 MB, nothing downloaded later):

```sh
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

The npm launcher `dsh-status-bar-plugin` was not published for this release and still resolves to 0.3.0 on the
npm registry. Existing 0.3.0 npm installs keep their version-pinned runtime download and are not upgraded by
this release; use the tarball above to get 0.4.0.

## What changed

- **Edge docking.** Dragging the capsule to a screen edge and releasing collapses it into a small whale orb;
  clicking the orb expands the capsule back inward along the docked side. The geometry lives in the new
  `apps/desktop/src/shared/edge-dock.ts`, and the switch is under **Settings → Window → 靠边自动收纳**.
- **Fourteen whale looks.** The original blue whale plus thirteen new SVG skins (星愿, 青海波, 樱吹雪,
  青瓷金继, 夏夜祭, 南瓜魔女, 糖果骷髅, 深海磷光, 珊瑚日落, 墨金漆器, 琉璃棱彩, 羊毛毡, 叠纸月船)
  are selectable under **Settings → Appearance** and shared by both the classic and whale-pool forms.
- **Capsule motion presets.** Four presets — 经典掠光, 字光落印, 流银巡航, 鲸游潮汐 — each with a live
  preview of both the running and the completed state. Motion can be full, reduced or off; reduced and off
  render the stable state directly.
- **Context-usage hint.** Hovering the usage ring in peek shows estimated context use, the window limit and
  the estimated remaining tokens. `sessionStatsSchema` gains an optional
  `context: { projectedTokens, windowTokens }` object; older snapshots that only carry `contextPercent`
  still work. No new auto-approval path was added and a dropped connection still shows the disconnected
  state.
- **Reorganised settings and drag focus.** The settings panel now groups appearance, motion and window
  options, and the peek keeps focus and position stable while being dragged.
- **Optics.** Real refraction samples only the area behind the floating window plus a small margin and
  pauses when the window is hidden; the sampling bounds are shared in `apps/desktop/src/shared/desktop-optics.ts`.
- **Homepage.** A rewritten README with ten screenshots covering the capsule, peek, detail, edge dock, the
  three pool layouts, the whale looks and the motion presets.

## Verification

- `pnpm exec vitest run`: 24 files, 231 tests pass (extends window-controller, desktop-optics, drag-motion,
  window, view-model and dsh-host-contract coverage).
- `pnpm exec tsc --noEmit`, `pnpm exec eslint .` and `pnpm build` are clean.
- Manual checks on an isolated Electron profile with Mock data: peek drag focus, the context-usage hint,
  edge docking and expansion, the three pool layouts, whale-look and capsule-motion selection, plus the
  homepage screenshots. Environment: Windows x64 build 26300, Node 24.15.0, pnpm 12.4.1, Electron 44.8.0.

## Not claimed

Real Desktop model sessions and the authorization round trip, physical multi-monitor and DPI switching,
long-run GPU and memory budgets, and the release install path are not covered by this release's verification.
