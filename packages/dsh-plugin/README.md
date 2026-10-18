# dsh-glass-plugin

DSH bundle for **DSH Status Bar** — a floating glass status bar for DeepSeek Harness.

## What it does

The plugin mounts one host row in DSH. At boot it waits for the local web server,
asks the `connection` service for the authenticated host URL
(`connection.authenticatedUrl(origin)`), and starts the desktop app with that link:

```text
electron <app dir> --dsh-link=<authenticated url> --launcher-pid=<host pid>
```

Glass connects with that link on launch, so nothing has to be pasted. The link
travels only in the process arguments and is never logged — the plugin prints
`[dsh-glass-plugin] Glass desktop companion launched (authenticated link redacted)`.
The app rejects non-loopback links, credentials, hashes and sub-paths before it
touches the network. `--launcher-pid` makes the companion exit when the DSH
process it belongs to disappears; disposing the plugin kills the spawned tree.

If Glass is already running, the second launch hits its single-instance lock: the
existing window is focused and re-connected with the new link.

## Install

From npm, from the plugin market (once listed), or straight from the release
tarball:

```sh
# npm: ~1.6 MB, fetches the 155 MB runtime once on first launch
dsh plugin --profile web add dsh-glass-plugin

# release tarball: 155 MB, self-contained, nothing downloaded later
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-glass-plugin.tgz
```

Both end up as the same companion: the built desktop app plus an Electron
runtime. The tarball carries them; the npm package downloads the very same
tarball the first time DSH starts it (progress goes to the host log, roughly
`[dsh-glass-plugin] downloading the Glass runtime: 40% of 155 MB`) and unpacks it
into a per-version cache — `%LOCALAPPDATA%\dsh-glass-plugin\runtime-<version>` on
Windows, `~/.cache/dsh-glass-plugin/runtime-<version>` elsewhere. Later launches
reuse that cache, so the download happens once per version.

> `dsh-glass-plugin@0.2.0` on the registry is the earlier self-contained build
> (388 MB unpacked, runtime included). `0.2.1` and later are the light build
> described here; prefer them.

### From a checkout (development)

The desktop profile can link the package instead of installing it:

```jsonc
// <profile>/package.json
"dependencies": { "dsh-glass-plugin": "link:D:/codexwork/dsh/dsh-glass-spec/packages/dsh-plugin" },
"dsh": { "profile": { "bundles": [/* ... */ "dsh-glass-plugin"] } }
```

In a checkout the plugin uses `apps/desktop/out` as the app directory and the
workspace `electron` package, so run `pnpm build` first. Point a junction or
symlink at `node_modules/dsh-glass-plugin` if pnpm did not run, then restart DSH.

## Configuration

The bundle patch sets `autoLaunch: true`. To keep the plugin installed but stop it
from starting Glass, override the row config in the profile patch:

```yaml
- id: dsh-glass-plugin
  config:
    autoLaunch: false
```

Other overrides, all optional:

| key | meaning |
|:--|:--|
| `appDir` | directory holding `out/main/index.js` |
| `electronBinary` | path to an Electron executable |
| `autoReload` | relaunch the companion when the desktop bundle changes (default `true`) |

`DSH_GLASS_APP` and `DSH_GLASS_ELECTRON` do the same two paths through the environment.

## Requirements

- Windows 11 x64 (the glass refraction reads the screen behind the window).
- The desktop app is a separate Electron process; it needs a GPU-backed Electron
  runtime, which the release tarball provides.

## License

MIT. The bundled Electron runtime keeps its own license files
(`electron/dist/LICENSE`, `LICENSES.chromium.html`).
