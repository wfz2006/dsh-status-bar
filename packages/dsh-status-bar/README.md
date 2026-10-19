# dsh-status-bar

DSH bundle for **DSH Status Bar** — a floating glass status bar for DeepSeek Harness.
The npm name and the bundle row id are `dsh-status-bar-plugin`. npm already hosts an unrelated `dsh-statusbar`, so the registry rejects the shorter name as too similar.

## What it does

The plugin mounts one host row in DSH. At boot it waits for the local web server,
asks the `connection` service for the authenticated host URL
(`connection.authenticatedUrl(origin)`), and starts the desktop app with that link:

```text
electron <app dir> --dsh-link=<authenticated url> --launcher-pid=<host pid>
```

The companion connects with that link on launch, so nothing has to be pasted. The
link travels only in the process arguments and is never logged — the plugin prints
`[dsh-status-bar] Glass desktop companion launched (authenticated link redacted)`.
The app rejects non-loopback links, credentials, hashes and sub-paths before it
touches the network. `--launcher-pid` makes the companion exit when the DSH
process it belongs to disappears; disposing the plugin kills the spawned tree.

If the companion is already running, the second launch hits its single-instance
lock: the existing window is focused and re-connected with the new link.

## Install

From npm, from the plugin market (once listed), or straight from the release
tarball:

```sh
# npm: ~870 kB, fetches the 155 MB runtime once on first launch
dsh plugin --profile web add dsh-status-bar-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz
```

Both end up as the same companion: the built desktop app plus an Electron
runtime. The tarball carries them; the npm package reads the download URL from its
own manifest (`dsh.statusBar.runtime`), fetches that tarball the first time DSH
starts it — progress goes to the host log, roughly
`[dsh-status-bar] downloading the Glass runtime: 40% of 155 MB` — and unpacks it
into a per-version cache: `%LOCALAPPDATA%\dsh-status-bar\runtime-<version>` on
Windows, `~/.cache/dsh-status-bar/runtime-<version>` elsewhere. Later launches
reuse that cache, so the download happens once per version.

> Renamed in 0.2.3. The old package id was `dsh-glass-plugin`; it still resolves
> to the same app, but new installs should use `dsh-status-bar-plugin`.

### From a checkout (development)

The desktop profile can link the package instead of installing it:

```jsonc
// <profile>/package.json
"dependencies": { "dsh-status-bar-plugin": "link:D:/codexwork/dsh/dsh-glass-spec/packages/dsh-status-bar" },
"dsh": { "profile": { "bundles": [/* ... */ "dsh-status-bar-plugin"] } }
```

In a checkout the plugin uses `apps/desktop/out` as the app directory and the
workspace `electron` package, so run `pnpm build` first. Point a junction or
symlink at `node_modules/dsh-status-bar-plugin` if pnpm did not run, then restart DSH.

## Configuration

The bundle patch sets `autoLaunch: true`. To keep the plugin installed but stop it
from launching the companion, override the row config in the profile patch:

```yaml
- id: dsh-status-bar-plugin
  config:
    autoLaunch: false
```

Other overrides, all optional:

| key | meaning |
|:--|:--|
| `appDir` | directory holding `out/main/index.js` |
| `electronBinary` | path to an Electron executable |
| `runtimeDir` | where the downloaded runtime is cached |
| `downloadUrl` | override the runtime tarball URL |
| `autoReload` | relaunch the companion when the desktop bundle changes (default `true`) |

The same settings are available through the environment:
`DSH_STATUS_BAR_APP`, `DSH_STATUS_BAR_ELECTRON`, `DSH_STATUS_BAR_RUNTIME`,
`DSH_STATUS_BAR_RUNTIME_URL`. The pre-0.2.3 names (`DSH_GLASS_*`) still work as
fallbacks.

## Requirements

- Windows 11 x64 (the glass refraction reads the screen behind the window).
- The desktop app is a separate Electron process; it needs a GPU-backed Electron
  runtime, which the release tarball provides.

## License

MIT. The bundled Electron runtime keeps its own license files
(`electron/dist/LICENSE`, `LICENSES.chromium.html`).
