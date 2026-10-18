First release that can be installed as a DSH plugin, without building anything.

## Install

```sh
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-glass-plugin.tgz
```

Restart DSH afterwards. The plugin waits for the local web server, asks `connection` for the authenticated URL and starts the desktop companion with `--dsh-link=<url> --launcher-pid=<pid>`, so the link is handed over instead of pasted. Glass exits when that DSH process goes away; disabling the bundle kills the spawned window tree.

If you would rather build it yourself, `pnpm install && pnpm build` in a checkout still works — the launcher also resolves `apps/desktop` and the workspace `electron` package.

## What is in the tarball

| part | size (unpacked) |
|:--|--:|
| `app/` — main bundle, renderer, preload, `RegionCapture.exe` | 1.3 MB |
| `electron/dist/` — Electron 44.8.0 runtime | 386 MB |
| `lib/`, `cordis.patch.yml`, `screenshots.json`, `assets/`, `LICENSE` | ~750 KB |

Nothing is compiled or downloaded at install time.

## Requirements

- Windows 11 x64. The refraction samples the screen behind the window, which is a Windows-only path here.
- The desktop app is a separate process; it needs a GPU-backed Electron runtime, which this tarball ships.

## Behaviour

- Capsule 288×50 DIP, click to expand into the peek and detail views; pending approvals open the approval face.
- Glass refraction (≈13 physical px deflection with RGB dispersion) is **off by default**; enable it in settings. It reads only the strip behind the window, stores nothing and uploads nothing.
- Approvals are never auto-accepted: a click sends the decision, and the card only confirms after DSH returns the matching `approval/decided` receipt.
- 132 unit tests, type check and lint pass at this commit (`pnpm test`, `pnpm typecheck`, `pnpm lint`).

## Notes

- The plugin bundle is `packages/dsh-plugin`; `dsh.bundle.patch` mounts one row with `autoLaunch: true`.
- Set `autoLaunch: false` in a profile patch to keep it installed but not auto-started.
- MIT licensed. The bundled Electron runtime keeps its own license files.
