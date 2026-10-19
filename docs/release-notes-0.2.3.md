Renames the plugin to match the repository and the product. Same app, same
behaviour — a new package id.

## What changed

| before | after |
|:--|:--|
| npm `dsh-glass-plugin` | npm **`dsh-status-bar-plugin`** |
| bundle row id `dsh-glass-plugin` | **`dsh-status-bar-plugin`** |
| package directory `packages/dsh-plugin` | **`packages/dsh-status-bar`** |
| release asset `dsh-glass-plugin.tgz` | **`dsh-status-bar.tgz`** |
| cache `%LOCALAPPDATA%\dsh-glass-plugin` | **`%LOCALAPPDATA%\dsh-status-bar`** |
| env `DSH_GLASS_APP`, `DSH_GLASS_ELECTRON`, `DSH_GLASS_RUNTIME`, `DSH_GLASS_RUNTIME_URL` | **`DSH_STATUS_BAR_*`** (the old names still work as fallbacks) |
| log prefix `[dsh-glass-plugin]` | **`[dsh-status-bar]`** |

The app itself is the same build as 0.2.2 (streamed process updates, approval
face without the accent bar). The desktop window still shows **DSH Status Bar**.

## Install

```sh
# npm: ~870 kB, fetches the runtime once on first launch
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

The npm package no longer hardcodes the download URL in `lib/`: it reads
`dsh.statusBar.runtime` from its own manifest, so a version pins its own tarball.

## Migrating from `dsh-glass-plugin`

```sh
dsh plugin --profile web remove dsh-glass-plugin
dsh plugin --profile web add dsh-status-bar-plugin-plugin
```

Then drop the old row override (if any) from the profile patch and restart DSH.
The old package stays on the registry and is marked deprecated.

This release also carries a second copy of the tarball under the old asset name
(`dsh-glass-plugin.tgz`), so profiles still running 0.2.1/0.2.2 keep resolving
`releases/latest/download/dsh-glass-plugin.tgz` instead of getting a 404.

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.3` | 870 kB packed / 880 kB unpacked | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155.3 MB packed / 388.5 MB unpacked | the same files plus `app/` and `electron/dist/` (Electron 44.8.0) |

## Verification

- `pnpm lint`, `pnpm typecheck`: clean.
- `pnpm test`: 15 files, 142 tests.
- Fresh npm install of the published package downloads the runtime, unpacks it to
  `runtime-0.2.3` and launches the companion with the authenticated link.
- MIT licensed. The bundled Electron runtime keeps its own license files.
