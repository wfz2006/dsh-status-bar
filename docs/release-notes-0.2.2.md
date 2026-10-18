Rebuilds the companion against the current main branch. The install paths did not
change — the app inside the tarball is just newer.

## Install

```sh
# npm: ~870 kB, fetches the runtime once on first launch
dsh plugin --profile web add dsh-glass-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-glass-plugin.tgz
```

## What is new in the app

- **Process updates stream in.** The DSH adapter used to wait for a completed
  message before it published a task update; it now forwards assistant process
  events as they arrive, so the capsule reflects what the session is doing
  instead of jumping when the turn ends
  (`packages/adapters/dsh/src/assistant-preview.ts`, `+92` lines, wired through
  `packages/adapters/dsh/src/index.ts` and `packages/protocol/src/index.ts`).
- **Approval face keeps the glass fill.** The accent bar on the approval reason
  is gone; the card keeps the translucent fill so long reasons read as part of the
  same surface (`apps/desktop/src/renderer/style.css`).
- 142 unit tests, type check and lint pass at this commit (15 files; `pnpm test`,
  `pnpm typecheck`, `pnpm lint`).

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-glass-plugin@0.2.2` | 870 kB packed / 880 kB unpacked | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-glass-plugin.tgz` | 155.3 MB packed / 388.5 MB unpacked | the same files plus `app/` (new build, 410,749 B main bundle) and `electron/dist/` (Electron 44.8.0) |

The npm package downloads this release's tarball on first launch and caches it in
`%LOCALAPPDATA%\dsh-glass-plugin\runtime-0.2.2` (`~/.cache/dsh-glass-plugin/runtime-0.2.2`
elsewhere), so the download happens once per version.

## Behaviour

- Capsule 288×50 DIP, click to expand into the peek and detail views; pending
  approvals open the approval face.
- Glass refraction (≈13 physical px deflection with RGB dispersion) is **off by
  default**; enable it in settings. It reads only the strip behind the window,
  stores nothing and uploads nothing.
- Approvals are never auto-accepted: a click sends the decision, and the card only
  confirms after DSH returns the matching `approval/decided` receipt.

## Requirements

- Windows 11 x64. The refraction samples the screen behind the window, which is a
  Windows-only path here.
- The desktop app is a separate process; it needs a GPU-backed Electron runtime,
  which the release tarball ships.

## Notes

- The plugin bundle is `packages/dsh-plugin`; `dsh.bundle.patch` mounts one row
  with `autoLaunch: true`.
- `dsh-glass-plugin@0.2.0` on the registry is the earlier self-contained build
  (388 MB unpacked); `0.2.1` and later are the light build.
- MIT licensed. The bundled Electron runtime keeps its own license files.
