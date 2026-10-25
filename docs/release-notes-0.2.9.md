This release is a weight and latency pass: the desktop bundles are about 57% smaller, the Main → preload stream
sends only what changed, tool steps and completions stop lagging the DSH window, and the capsule got a drag
response. The glass material, approval rules and the plugin startup path are unchanged.

## Install

```sh
# npm: ~880 kB launcher; the first launch fetches the runtime from the npm registry
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

## What changed

- **Smaller bundles.** Main, preload and renderer are minified in production. Renderer CSS stays unminified on
  purpose: the minifier folds `scale` into `transform`, which broke the native drag acceptance that reads the
  computed `scale` (it reported `scale: none`).
- **Cheaper startup.** `@glass/protocol/initial-projection` exposes an initial-state factory only, so the renderer
  no longer pulls Zod and the whole protocol schema just to build an empty state. Main-side validation is unchanged.
- **Incremental projection.** A known session now sends only changed fields; the transcript sends changed lines by
  position, preserving order, duplicate IDs, deletions and empty lists. Unchanged todos are not resent. Full
  snapshots, revision checks, missing-frame recovery, the every-300-updates full refresh and the approval checks
  are all still there.
- **Native visibility.** Main publishes `WindowState.visible`. Hiding or minimising stops the material size
  observer, removes the SVG filter and clears the engine texture cache; restoring rebuilds with the same
  parameters. This exists because a hidden transparent window still reports `document.hidden === false` here.
- **Process sync latency.** Four causes fixed: a cold session that was already running still waited for the
  10-second `session/list` (the native `api-session/status` signal now enables `follow()` immediately), stale list
  responses could overwrite newer live state (list rows now carry object identity plus a local revision), a late
  `session/page` from a cold read could overwrite a fresh run, and tool rows kept a 260 ms fade-in after arriving
  in the DOM. Completion is still taken from the real `turn/end` reason — `api-session/status(false)` only means
  idle and is never treated as completed.
- **Review fixes.** Question drafts are keyed by full request identity, so switching between queued questions no
  longer clears answers; request IDs such as `constructor` / `toString` / `__proto__` no longer collide with
  inherited object properties; new sessions are stored as explicit data properties instead of going through the
  prototype setter; hiding the capsule clears `data-drag` via the native visibility signal; the process/step tabs
  support arrow keys plus Home/End with a single Tab stop, and lists/inputs have visible focus rings; copying shows
  a short "copied" / "copy failed" confirmation isolated by request.
- **Drag response.** Press compresses the content and answers the grab; dragging moves the native window directly,
  tilts the whale with the direction at up to ~14°, lags content by at most 4.8 DIP and shifts the highlight with
  speed; releasing fast gives a bounded damped rebound (≤14 DIP, 560 ms) that ends exactly on the drop point, with
  no free glide. Regrabbing mid-rebound interrupts it. Reduced or disabled animations keep direct dragging with the
  new motion off. The glass filter layer is never transformed, so the RGB refraction is untouched.

## Measurements

- Build output: 1,419.53 kB → 606.79 kB (−57.3%); renderer JS 876.98 kB → 294.67 kB (−66.4%); Main JS 424.47 kB
  → 214.37 kB; preload 6.45 kB → 4.26 kB. Electron's own `dist` is unchanged, so the full install is not 57%
  smaller.
- Streaming, 100 sessions / 1,000 todos / 360 updates: incremental-only frames 63,299,201 → 205,601 bytes
  (−99.7%), structured-clone round trip 436.8 → 175.2 ms; with the production every-300-updates refresh
  80,847,140 → 17,928,800 bytes (−77.8%), 524.5 → 265.4 ms. This is a synthetic codec benchmark, not task latency
  or frame rate.
- Memory: the idle capsule and the renderer JS heap went down (JS heap 5.80 → 4.72 MiB); expanded, dynamic
  background and post-morph process trees measured *higher*, mostly in the GPU process. No claim of an overall RAM
  win is made.
- `test:process-latency`: 20 streaming prefixes and a 200-fragment burst all rendered; median DOM/animation-frame
  opportunity 25 ms, P95 33 ms (not GPU presentation time).
- Native drag acceptance: capsule stays 290×44 DIP, release path x=370→380→369→370, whale tilt ~9.3°, grab scale
  1.16, glass surface `transform: none`, RGB filter URL preserved, sampled across 10 distinct positions.

## Verification

- `npx eslint .` clean, `npx tsc --noEmit` clean, `vitest run --maxWorkers=1` **23 files / 214 tests** pass.
- `test:optimization` (three native hide/restore and minimise/restore rounds, identical textures and RGB channels),
  `test:performance`, `test:memory`, `test:process-latency`, `test:review-ui` and the native motion/experience
  suites pass.

## Known limits

- The legacy `test:desktop` script still fails: it looks for `.todo` on the default process page while those nodes
  render on the steps page (expects 2, gets 0). The pre-optimisation build fails on the same line; the script was
  not weakened, and the evidence is in `reports/optimization/legacy-smoke-before.txt` (not committed).
- `drag-optics-acceptance.mjs` still fails its background-pixel-difference assertion; the window movement and size
  checks pass but the sampled pixels do not reach the threshold. It is not claimed as an optics pass, and the
  assertion was not relaxed.
- Cross-monitor DPI and the subjective feel of the new drag still need a human check.

## Artifacts

| artifact | size | contents |
|:--|--:|:--|
| npm `dsh-status-bar-plugin@0.2.9` | 879,344 B packed | `lib/`, `cordis.patch.yml`, `assets/`, `screenshots.json`, `README.md`, `LICENSE` |
| npm `dsh-status-bar-runtime@0.2.9` | 161,820,727 B packed | `app/`, `electron/dist/`, `LICENSE` |
| release `dsh-status-bar.tgz` | 155 MB | the launcher plus `app/` and `electron/dist/` (fallback and offline install) |
| release `dsh-glass-plugin.tgz` | 155 MB | compatibility copy for the pre-rename URL |

## Notes

- Windows 11 x64 for the companion and the native preparation window.
- The release workflow refuses a tag whose `packages/dsh-status-bar/package.json` version differs, and the runtime
  package version must match the plugin version for the archive to be accepted.
- Nothing changed in the installed DSH, the user profile or the plugin runtime cache during this work.
