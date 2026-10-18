// DSH bundle entry for the Glass companion.
//
// The desktop app is its own Electron process. This host plugin starts it once
// the local web server is up, handing over the authenticated URL through
// `--dsh-link` so Glass connects without the user pasting anything. When Glass
// is already running, its single-instance lock focuses the existing window and
// re-connects it with the new link.
//
// Two install shapes have to work:
//
//   - the release tarball, which ships the built app in `app/` and an Electron
//     runtime in `electron/dist/` (self-contained, nothing to build);
//   - a checkout of the repository, where both live outside this package
//     (`apps/desktop/out` and the workspace `electron` dependency).
//
// The child also receives `--launcher-pid`; Glass exits when that host process
// disappears, and disposal kills the spawned tree so the companion follows DSH.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-glass-plugin';
export const inject = ['connection', 'webServer'];

/** Package root: `lib/index.js` -> the directory that holds `package.json`. */
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

/** Electron's binary sits at these relative paths inside a `dist/` directory. */
function electronExecutables() {
  if (process.platform === 'win32') return ['electron.exe'];
  if (process.platform === 'darwin') return [join('Electron.app', 'Contents', 'MacOS', 'Electron')];
  return ['electron'];
}

function firstFile(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The app directory holds `out/main/index.js`. The packaged copy wins, then an
 * explicit override, then the checkout layout used while developing.
 */
function resolveAppDir(config) {
  return firstFile([
    config.appDir,
    process.env.DSH_GLASS_APP,
    join(pluginRoot, 'app'),
    join(pluginRoot, '..', '..', 'apps', 'desktop'),
  ].filter(candidate => typeof candidate === 'string' && existsSync(join(candidate, 'out', 'main', 'index.js'))));
}

function distBinary(distDir) {
  return firstFile(electronExecutables().map(name => join(distDir, name)));
}

function resolveElectron(config, appDir) {
  const explicit = firstFile([config.electronBinary, process.env.DSH_GLASS_ELECTRON].filter(value => typeof value === 'string'));
  if (explicit) return explicit;

  // Release tarball: the runtime travels with the package.
  const bundled = distBinary(join(pluginRoot, 'electron', 'dist'));
  if (bundled) return bundled;

  // Source install: use the `electron` package installed next to the app (the
  // workspace checkout) or next to this package (a registry dependency).
  for (const base of [appDir, pluginRoot]) {
    if (!base) continue;
    try {
      const manifest = createRequire(join(base, 'package.json')).resolve('electron/package.json');
      const binary = distBinary(join(dirname(manifest), 'dist'));
      if (binary) return binary;
    } catch {
      // Not installed this way; try the next base.
    }
  }
  return undefined;
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try { child.kill(); } catch { /* already gone */ }
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

export function apply(ctx, config = {}) {
  if (config.autoLaunch === false) return;
  let child;
  let bundleStamp = 0;
  let launched = false;
  let attempts = 0;
  let timer;
  let watcher;

  const appDir = resolveAppDir(config);
  const mainBundle = appDir ? join(appDir, 'out', 'main', 'index.js') : undefined;

  const bundleMtime = () => {
    if (!mainBundle) return 0;
    try { return statSync(mainBundle).mtimeMs; } catch { return 0; }
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const tryLaunch = () => {
    attempts += 1;
    if (attempts > 600) {
      stop();
      console.warn('[dsh-glass-plugin] no web server origin after 150s; the Glass companion was not started');
      return;
    }
    if (!appDir) {
      stop();
      console.warn(
        '[dsh-glass-plugin] no built desktop app found (looked for app/out/main/index.js and apps/desktop/out/main/index.js); '
        + 'install the release tarball or run `pnpm build` in the repository',
      );
      return;
    }
    let origin;
    try { origin = ctx.webServer.getOrigin(); } catch { return; }
    let link;
    try { link = ctx.connection.authenticatedUrl(origin); } catch { return; }
    if (!link || !/^https?:\/\//.test(link)) return;

    const binary = resolveElectron(config, appDir);
    if (!binary) {
      stop();
      console.warn(
        '[dsh-glass-plugin] no Electron runtime found; install the release tarball (which ships one) or the `electron` package next to the app',
      );
      return;
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const spawned = spawn(binary, [appDir, `--dsh-link=${link}`, `--launcher-pid=${process.pid}`], {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child = spawned;
    spawned.on('exit', () => { if (child === spawned) child = undefined; });
    spawned.unref();
    launched = true;
    bundleStamp = bundleMtime();
    stop();
    console.info('[dsh-glass-plugin] Glass desktop companion launched (authenticated link redacted)');
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      stop();
      if (watcher) clearInterval(watcher);
      watcher = undefined;
      killChild(child);
      child = undefined;
    });
  }
  timer = setInterval(() => { if (!launched) tryLaunch(); }, 250);
  if (config.autoReload !== false) {
    // Rebuild-and-reload loop: when the desktop bundle changes, relaunch the
    // running companion with the current authenticated link. A user-initiated
    // quit leaves `child` empty, so it is never resurrected by a build.
    watcher = setInterval(() => {
      const stamp = bundleMtime();
      if (!child || !stamp || bundleStamp === 0 || stamp === bundleStamp) return;
      bundleStamp = stamp;
      console.info('[dsh-glass-plugin] desktop bundle changed; relaunching the Glass companion');
      killChild(child);
      child = undefined;
      launched = false;
      timer = setInterval(() => { if (!launched) tryLaunch(); }, 250);
    }, 1500);
  }
}
