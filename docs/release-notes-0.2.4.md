Memory optimisations for the sampling path, plus the rename to `dsh-status-bar-plugin`.
Install paths are unchanged.

## Install

```sh
# npm: ~870 kB, fetches the runtime once on first launch
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

Running an older install? `dsh-glass-plugin` is deprecated on the registry and
points here; the release keeps a `dsh-glass-plugin.tgz` asset so the old
`latest/download` URL keeps working.

## What is new in the app

The sampling path stopped rebuilding what it already had:

- The native helper reuses one bitmap, RGBA buffer and previous frame buffer at
  the current size, and releases them when the size changes or sampling stops.
- A frame is only sent when the capture rect, window geometry and every RGBA byte
  are identical — same schedule, same HWND/PID/display-affinity checks, no hashing
  heuristics, no resolution or frame-rate cuts.
- New subscribers, page reloads and appearance changes still coalesce into one
  forced fresh frame, so a static background still paints on first show, on theme
  changes and on restore.
- The main process reuses an exact-size buffer and sends a view of the original
  bytes instead of one whole-frame copy, and zeroes local pixels after the sync IPC.
- The refraction morph reuses the same SVG nodes, updating texture, size and the
  three coefficient paths, and drops the temporary canvas right after the
  displacement map is computed.

Measured with `pnpm test:memory` / `scripts/memory-audit.mjs` on a production build,
same Electron 44.8.0, 150% scaling, `WorkingSetPrivate` summed over the process
group, five-second warm-up and four samples per scene:

| scene | before | after | change |
|:--|--:|--:|--:|
| capsule, not sampling | 288.6 MiB | 275.8 MiB | -4.5% |
| capsule, static background | 370.3 MiB | 248.5 MiB | **-32.9%** |
| expanded, static background | 397.8 MiB | 319.1 MiB | **-19.8%** |
| expanded, background changing every 180 ms | 383.7 MiB | 360.3 MiB | -6.1% |
| expanded after 18 morphs | 692.2 MiB | 627.0 MiB | -9.4% |
| capsule after the same sequence | 599.9 MiB | 623.2 MiB | +3.9% |
| after hiding | 522.8 MiB | 443.4 MiB | -15.2% |

The gain is real for static content and small for constantly changing video-like
backgrounds; the "expand then collapse" sample did not improve. GPU driver reserves
still dominate, so this is not a fixed memory ceiling. Full numbers and method:
`reports/memory-upgrade/README.md`.

**The JavaScript and the native helper must ship together**: the new optional
`frame-force` argument exists only in the rebuilt `RegionCapture.exe`, which this
tarball carries. Mixing an old helper with the new app silently loses the forced
re-sampling on reload.

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.4` | 870 kB packed | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155.3 MB | the same files plus `app/` (411,307 B main bundle + rebuilt helper) and `electron/dist/` (Electron 44.8.0) |
| release `dsh-glass-plugin.tgz` | 155.3 MB | byte-identical compatibility copy for the pre-rename URL |

## Verification

- `pnpm lint`, `pnpm typecheck` clean; `pnpm test` 15 files / 142 tests pass.
- `pnpm test:memory`: 8 groups (clear/frosted × capsule/peek/expanded/approval) —
  input RGBA bytes, SDF textures, RGB coefficients and screenshot SHA-256 identical
  before and after; source buffers zeroed after send.
- The packaged `app/out/main/index.js` in this release is the build from
  `19087a0` (411,307 B), not the 0.2.3 build (410,749 B).

## Requirements

- Windows 11 x64. The refraction samples the screen behind the window, which is a
  Windows-only path here.
- The desktop app is a separate process; it needs a GPU-backed Electron runtime,
  which the release tarball ships.

## Notes

- The plugin bundle is `packages/dsh-status-bar`; `dsh.bundle.patch` mounts one row
  with `autoLaunch: true`.
- Set `autoLaunch: false` in a profile patch to keep it installed but not
  auto-started.
- MIT licensed. The bundled Electron runtime keeps its own license files.
