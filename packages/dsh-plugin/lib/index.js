// DSH bundle entry for the Glass companion.
//
// The desktop app lives in apps/desktop and runs as its own Electron process.
// This host plugin starts it once the local web server is up, handing over the
// authenticated URL through `--dsh-link` so Glass connects without the user
// pasting anything. When Glass is already running, its single-instance lock
// focuses the existing window and re-connects it with the new link.
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

const appDir = fileURLToPath(new URL('../../../apps/desktop/', import.meta.url));
const mainBundle = join(appDir, 'out', 'main', 'index.js');

let child;
let bundleStamp = 0;

function bundleMtime() {
  try { return statSync(mainBundle).mtimeMs; } catch { return 0; }
}

function electronBinary() {
  try {
    const pkg = createRequire(join(appDir, 'package.json')).resolve('electron/package.json');
    const binary = process.platform === 'win32'
      ? join(dirname(pkg), 'dist', 'electron.exe')
      : process.platform === 'darwin'
        ? join(dirname(pkg), 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
        : join(dirname(pkg), 'dist', 'electron');
    return existsSync(binary) ? binary : undefined;
  } catch {
    return undefined;
  }
}

function killChild() {
  const current = child;
  child = undefined;
  if (!current || current.exitCode !== null || current.pid === undefined) return;
  try { current.kill(); } catch { /* already gone */ }
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(current.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

export function apply(ctx, config = {}) {
  if (config.autoLaunch === false) return;
  let launched = false;
  let attempts = 0;
  let timer;
  let watcher;

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const tryLaunch = () => {
    attempts += 1;
    if (attempts > 600) {
      stop();
      console.warn('[dsh-glass-plugin] no web server origin after 150s; Glass was not started');
      return;
    }
    let origin;
    try { origin = ctx.webServer.getOrigin(); } catch { return; }
    let link;
    try { link = ctx.connection.authenticatedUrl(origin); } catch { return; }
    if (!link || !/^https?:\/\//.test(link)) return;

    const binary = config.electronBinary ?? electronBinary();
    if (!binary) {
      stop();
      console.warn('[dsh-glass-plugin] Electron is not built for apps/desktop; skipping Glass launch');
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

  if (typeof ctx.effect === 'function') ctx.effect(() => () => { stop(); if (watcher) clearInterval(watcher); watcher = undefined; killChild(); });
  timer = setInterval(() => { if (!launched) tryLaunch(); }, 250);
  if (config.autoReload !== false) {
    // Rebuild-and-reload loop: when the desktop bundle changes, relaunch the
    // running companion with the current authenticated link. A user-initiated
    // quit leaves `child` empty, so it is never resurrected by a build.
    watcher = setInterval(() => {
      const stamp = bundleMtime();
      if (!child || !stamp || bundleStamp === 0 || stamp === bundleStamp) return;
      bundleStamp = stamp;
      console.info('[dsh-glass-plugin] desktop bundle changed; relaunching Glass');
      killChild();
      tryLaunch();
    }, 1500);
  }
}
