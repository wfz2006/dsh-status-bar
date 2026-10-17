# dsh-glass-plugin

Local DSH bundle wrapper for the DSH Glass desktop companion.

## What this is

`dsh-glass-plugin` is the installable shape of DSH Glass for the DSH plugin
market. The market installs umbrella bundles (packages that declare
`dsh.bundle.patch`), so this package declares the bundle patch and mounts a
small host plugin. The Electron app in `apps/desktop` stays a separate process.

## Launcher hand-off

At boot the host plugin waits for the local web server, asks the `connection`
service for the authenticated host URL (`authenticatedUrl(origin)`), and starts
the desktop app with:

```text
electron apps/desktop --dsh-link=<authenticated url>
```

Glass connects to that link on launch, so the user does not paste anything. If
Glass is already running, the second launch hits its single-instance lock: the
existing window is focused and re-connected with the new link.

The link is only passed through the process argument and is never logged; the
plugin prints `[dsh-glass-plugin] Glass desktop companion launched (authenticated
link redacted)`. `apps/desktop` rejects non-loopback links, credentials, hashes
and sub-paths before touching the network.

### Configuration

The bundle patch sets `autoLaunch: true`. To keep the plugin installed but stop
it from starting Glass, override the row config in the profile patch:

```yaml
- id: dsh-glass-plugin
  config:
    autoLaunch: false
```

`electronBinary` can point at a specific electron executable instead of the one
resolved from `apps/desktop` (`createRequire(...)('electron/package.json')`).

## Manual install (development)

The desktop profile can link the package instead of publishing it:

```jsonc
// <profile>/package.json
"dependencies": { "dsh-glass-plugin": "link:D:/codexwork/dsh/dsh-glass-spec/packages/dsh-plugin" },
"dsh": { "profile": { "bundles": [/* ... */ "dsh-glass-plugin"] } }
```

Point a junction/symlink at `node_modules/dsh-glass-plugin` if pnpm did not run,
then restart the app. The bundle shows up in the market as an installed local
plugin. Do not copy this package into another checkout; use `link:` so edits
take effect after a rebuild/restart.
