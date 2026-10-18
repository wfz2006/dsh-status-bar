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

From the plugin market (once listed), or directly from the release tarball:

```sh
dsh plugin --profile web add https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-glass-plugin.tgz
```

The tarball is self-contained: it ships the built desktop app in `app/` and the
Electron runtime in `electron/dist/`, so nothing is compiled or downloaded at
install time.

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
