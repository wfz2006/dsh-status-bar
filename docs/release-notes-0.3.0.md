This release adds a second appearance and leaves everything already shipped in place. The classic glass forms
(capsule, peek, task detail, pending requests) are still the default and existing preferences are not switched
automatically. The glass material, the approval rules and the plugin startup path are unchanged.

## Install

```sh
# npm: ~880 kB launcher; the first launch fetches the runtime from the npm registry
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## What changed

- **Whale pool appearance.** A new `appearance` setting (`classic` | `whale-pool`) with its own entry in the
  window menu, next to the classic forms. Collapsed, the pool shows only the whale, the menu and the attention
  badge; clicking the whale expands it into the water sheet.
- **Three layouts, three contours.** `poolLayout` keeps the existing typographies (清流 / 轻舟 / 水笺) and
  `poolContour` sets the water outline (饱满水珠 / 柔角水镜 / 圆头水滴).
- **Introduced once.** The first launch after installing or upgrading to this version shows a short introduction
  unless this feature is already recorded as seen. Choosing either "立即体验" or "暂时保留当前形态", or pressing
  Escape, records it in `glass-ui.json` under `announcements` — separately from the appearance setting, so changing
  other settings never re-triggers it. The introduction can be replayed from settings at any time.
- **Same data, same rules.** The pool renders the existing session projection: no prototype scenes, no fake tasks.
  Task detail, session switching and approvals reuse the existing views and the existing identity checks, and no
  auto-approval path was added. A dropped connection shows the disconnected state, never a finished task.
- **Optics and GPU.** While the pool is shown, desktop sampling is suspended and resumed when returning to the
  classic form or opening settings; the pool's GPU resources are released on unmount and its animation pauses while
  the window is hidden. Reduce-motion and animation-off render the stable state directly.
- **Sizing.** The pool has its own minimum size (220 × 140) and its own size-to-view thresholds, so a small resize
  no longer flips the classic view modes. Switching appearance drops the manual size and re-fits the window, and the
  approval view still keeps its full size.

## Verification

- `pnpm exec vitest run`: 24 files, 221 tests pass (adds `tests/whale-pool.test.ts` and extends
  `tests/window-controller.test.ts` with settings compatibility, the one-time introduction, the independent menu
  entry, material restoration and the pool size guards).
- `pnpm exec tsc --noEmit`, `pnpm exec eslint .` and `pnpm build` are clean.
- `node scripts/whale-pool-acceptance.mjs`: eight groups pass against an isolated Electron profile — fresh install,
  upgrade with old settings, both introduction choices, restart, the three layouts, the disconnected empty state, the
  attention badge, GPU context loss and recovery, and the classic views plus the read-only approval guarantee. Page
  errors: 0.
- `node scripts/desktop-smoke.mjs` runs the classic desktop regression. The always-on-top assertion failed twice
  early in that session and then passed on an unmodified rerun; the environment note is kept and no assertion was
  loosened.

## Not claimed

Real Desktop model sessions and the authorization round trip, physical multi-monitor and DPI switching, long-run
GPU and memory budgets, and the release install path are not covered by this release's verification.
