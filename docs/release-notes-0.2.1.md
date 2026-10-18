Adds an npm install path. The plugin is now on the registry, so the desktop
companion can be added with a package name instead of a 155 MB tarball URL.

## Install

```sh
# npm: 870 kB, fetches the runtime once on first launch
dsh plugin --profile web add dsh-glass-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-glass-plugin.tgz
```

Restart DSH afterwards. The plugin waits for the local web server, asks
`connection` for the authenticated URL and starts the desktop companion with
`--dsh-link=<url> --launcher-pid=<pid>`, so the link is handed over instead of
pasted. Glass exits when that DSH process goes away; disabling the bundle kills
the spawned window tree.

## What changed in the launcher

- A third install shape: the npm package ships only `lib/`, `cordis.patch.yml`,
  `assets/`, docs and `LICENSE`. On first launch the plugin downloads this
  release's tarball, unpacks `app/` and `electron/dist/` into a per-version cache
  and starts the companion from there.
  - Cache: `%LOCALAPPDATA%\dsh-glass-plugin\runtime-<version>` on Windows,
    `~/.cache/dsh-glass-plugin/runtime-<version>` elsewhere. One download per
    version; later launches reuse it.
  - Progress is logged (`[dsh-glass-plugin] downloading the Glass runtime: 40% of 155 MB`).
  - Overrides: `runtimeDir`, `downloadUrl` in the row config, or `DSH_GLASS_RUNTIME`
    / `DSH_GLASS_RUNTIME_URL` in the environment.
- Waiting for the runtime no longer eats the 150 s web-server budget: the clock
  only runs once both halves of the companion are on disk.
- The tarball install and the checkout install resolve exactly as before.

## What is in each artifact

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-glass-plugin@0.2.1` | 870 kB packed / 880 kB unpacked | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-glass-plugin.tgz` | 155.3 MB packed / 388.5 MB unpacked | the same files plus `app/` (1.3 MB) and `electron/dist/` (Electron 44.8.0, 386 MB) |

The npm package downloads the release tarball, so both paths end up with the
identical app and runtime.

## Requirements

- Windows 11 x64. The refraction samples the screen behind the window, which is a
  Windows-only path here.
- The desktop app is a separate process; it needs a GPU-backed Electron runtime,
  which the release tarball ships.

## Behaviour

- Capsule 288×50 DIP, click to expand into the peek and detail views; pending
  approvals open the approval face.
- Glass refraction (≈13 physical px deflection with RGB dispersion) is **off by
  default**; enable it in settings. It reads only the strip behind the window,
  stores nothing and uploads nothing.
- Approvals are never auto-accepted: a click sends the decision, and the card only
  confirms after DSH returns the matching `approval/decided` receipt.
- 132 unit tests, type check and lint pass at this commit (`pnpm test`,
  `pnpm typecheck`, `pnpm lint`).

## Notes

- The plugin bundle is `packages/dsh-plugin`; `dsh.bundle.patch` mounts one row
  with `autoLaunch: true`.
- Set `autoLaunch: false` in a profile patch to keep it installed but not
  auto-started.
- MIT licensed. The bundled Electron runtime keeps its own license files.
