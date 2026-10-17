# dsh-glass-plugin

Local DSH bundle wrapper for the DSH Glass desktop companion.

## What this is

`dsh-glass-plugin` is the installable shape of DSH Glass for the DSH plugin
market. The market installs umbrella bundles (packages that declare
`dsh.bundle.patch`), so this package declares the bundle patch and mounts an
inert host plugin. The Electron app in `apps/desktop` stays a separate process.

The plugin currently does nothing except log one line at boot. The next step
for this package is the launcher hook: start (or focus) the Glass desktop app
and hand it the current Host authentication link, so users no longer paste the
link by hand.

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
