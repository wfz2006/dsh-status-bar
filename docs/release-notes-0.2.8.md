The 155 MB runtime now comes from the npm registry instead of a GitHub release asset, which is roughly two
orders of magnitude faster on networks where GitHub throttles or stalls. The release asset stays as a fallback.

## Install

```sh
# npm: ~840 kB launcher; the first launch fetches the runtime from the npm registry
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## Why

A first run on this machine sustained ~40 KiB/s from `releases/download`, so preparing the runtime took the
better part of an hour, and the network repeatedly reset the connection. The same machine pulls from
`registry.npmjs.org` at ~3.9 MB/s — about a hundred times faster — because the registry is served from a CDN.

So the prebuilt runtime is now published as its own npm package, `dsh-status-bar-runtime`, and the light
launcher advertises that tarball address in `dsh.statusBar.runtime`.

## What changed

- New `scripts/pack-runtime-release.mjs`: stages `app/` + `electron/` + `LICENSE` as `dsh-status-bar-runtime`,
  packing from the same staging directory the self-contained bundle uses, so both artifacts always describe the
  same build. `--publish` uploads it.
- `dsh-status-bar-plugin` now advertises
  `https://registry.npmjs.org/dsh-status-bar-runtime/-/dsh-status-bar-runtime-<version>.tgz`; the address is
  version-pinned, so a plugin upgrade never silently reuses an older runtime.
- `runtimeUrls()` returns the primary source plus the GitHub release asset as a fallback. If the registry is
  unreachable, the launcher says so in the preparation window and continues with the release asset instead of
  giving up. An explicitly configured `downloadUrl` / `DSH_STATUS_BAR_RUNTIME_URL` is still used alone.
- The unpacked archive is validated exactly as before: the runtime package version, the app entry and the
  Electron binary must all match the plugin version, otherwise the cache is rejected.

## Verification

- `npx eslint .` clean, `npx tsc --noEmit` clean, `vitest run --maxWorkers=1` **21 files / 191 tests** pass.
- New test asserts the advertised npm URL wins, the release asset is the second candidate, and an explicit
  address disables the fallback list.
- `dsh-status-bar-runtime@0.2.8` published: **82 files, 161,951,448 B** packed, `app/` + `electron/dist/`
  (Electron 44.8.0).
- Measured from this machine: npm registry tarball throughput ~3.9 MB/s versus ~40 KiB/s from the release asset.

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.8` | 840 kB packed | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| npm `dsh-status-bar-runtime@0.2.8` | 162 MB packed | `app/`, `electron/dist/`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155 MB | the launcher plus `app/` and `electron/dist/` (fallback and offline install) |
| release `dsh-glass-plugin.tgz` | 155 MB | compatibility copy for the pre-rename URL |

## Notes

- Windows 11 x64 for the companion and the native preparation window.
- Interrupted preparations still resume from the verifiable byte offset on the next launch.
- The release workflow refuses a tag whose `packages/dsh-status-bar/package.json` version differs, and the runtime
  package version must match the plugin version for the archive to be accepted.
- MIT licensed. The bundled Electron runtime keeps its own license files.
