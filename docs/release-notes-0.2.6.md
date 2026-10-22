A stalled first-run download is now visible, resumable and recoverable. This release also pins the runtime
address to the plugin version and gives long capsule titles a banner instead of a hard clip.

## Install

```sh
# npm: ~840 kB launcher, fetches the ~155 MB runtime once on first launch
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## Why this release exists

The market install is a light launcher: the first launch still has to fetch the Electron runtime. The old
downloader only wrote to the DSH console, used a random temp file, allowed itself one 15-minute window and
never resumed. When the transfer stalled, the capsule simply never appeared — no window, no error, nothing a
user could act on. That is exactly the report this release answers (`docs/first-run-recovery.md`).

## What changed

**Downloading**

- The system `curl` is preferred, with bounded connect, idle and total time; Node is the fallback when `curl`
  is missing or unusable. Up to three automatic attempts.
- `.tgz.part` plus its metadata live next to the version cache, so a partial transfer survives a restart.
- Resume uses `If-Range` only when the URL fingerprint and a strong `ETag`/`Last-Modified` can be verified;
  if the server refuses the range, the file is fetched again instead of being stitched together blindly.
- A corrupt archive is never silently reused on the next attempt.

**Unpacking**

- Paths and links are checked, then the plugin version, the app entry and the Electron binary, before a
  verified directory replaces the cache.
- Preparing the same version concurrently is serialised by a lock; known staging leftovers from an earlier
  crash are cleaned while holding it.
- Only a verified directory is ever promoted, so a half-written cache cannot masquerade as ready.

**Telling the user**

- Windows gets a native WPF progress window — progress, the failure reason and a retry button — that does not
  need Electron to exist yet.
- Closing or cancelling stops this preparation, keeps the verifiable part of the download and continues on the
  next launch. A complete cache starts directly, without flashing the preparation window.
- Progress state holds only a status, byte counts and a message: no Host link, cookie or token.

**Lifecycle**

- Disposing the plugin cancels download, retries and unpacking, clears the lock and this run's staging, and a
  late preparation result cannot launch the capsule afterwards. Spawn failures now surface visibly.
- `showStartupUI: false` keeps the log-only behaviour for deployments that do not want a window.

**Addressing**

- The default runtime URL is pinned to the running plugin version; older manifests that still point at
  `latest/download/...` are resolved to the same pinned version. An explicit custom URL is honoured, but the
  unpacked archive must still match the plugin version.
- The release workflow checks out the requested tag and rejects a tag whose `package.json` version differs,
  so a bundle can no longer be attached to the wrong fixed-version address.

**Ul**

- A capsule title that genuinely overflows now scrolls as a banner (duplicate copy for a seamless loop), pauses
  while hovered or focused, respects `prefers-reduced-motion` and the animation setting, and returns to
  static text when it fits. While the session is working the characters keep the reading wave, capped at 32
  characters so long titles stay readable.
- Refreshed intro screenshots and a new optics comparison card.

## Verification

- `npx eslint .` clean, `npx tsc --noEmit` clean, `vitest run --maxWorkers=1` **21 files / 189 tests** pass.
- `tests/plugin-startup.test.ts` adds 16 tests: interrupted transfer recovery, explicit retry, no premature
  authentication, nothing launches after disposal, cache hit, parent Node-mode environment, spawn failure,
  auto-start off, pinned and mismatched versions, concurrent and cancelled waiters, server ignoring `Range`,
  Node resume and idle timeout, missing validators, missing `curl`, corrupt archive, leftover staging.
- `pnpm test:plugin-startup` runs two real Windows checks: the native WPF control renders progress and the
  retry/cancel commands, and a temporary light plugin walks interruption → repeated 503 → visible failure
  window → retry → resume from the 64 KiB mark → real Electron and production renderer → dispose.
- The packaged main bundle for 0.2.6 is 424,469 B (0.2.5 was 424,443 B).

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.6` | 840 kB packed | `lib/` (incl. `download.js`, `runtime.js`, `startup-status.js`, `startup-window.ps1`), `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155 MB | the same files plus `app/` and `electron/dist/` (Electron 44.8.0) |
| release `dsh-glass-plugin.tgz` | 155 MB | compatibility copy for the pre-rename URL |

The bundle is attached by the `release-bundle` workflow, which builds it on `windows-latest` and checks the
tag against the plugin version.

## Requirements

- Windows 11 x64 for the desktop companion and for the native progress window; other platforms keep the
  log-only startup path.
- The first launcher that needs a runtime still requires network access to the release asset.

## Notes

- The plugin bundle is `packages/dsh-status-bar`; `dsh.bundle.patch` mounts one row with `autoLaunch: true`.
  Set `autoLaunch: false` in a profile patch to keep it installed but not auto-started.
- MIT licensed. The bundled Electron runtime keeps its own license files.
- The real-network stall and resume path, and a fresh-machine install speed, still need acceptance against
  this release; the local tests simulate a 64 KiB interruption rather than the original transfer.
