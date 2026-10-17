// DSH bundle entry for the Glass companion.
//
// The desktop app lives in apps/desktop and runs as its own Electron process.
// This host plugin starts it once the local web server is up, handing over the
// authenticated URL through `--dsh-link` so Glass connects without the user
// pasting anything. When Glass is already running, its single-instance lock
// focuses the existing window and re-connects it with the new link.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-glass-plugin';
export const inject = ['connection', 'webServer'];

const appDir = fileURLToPath(new URL('../../../apps/desktop/', import.meta.url));

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

export function apply(ctx, config = {}) {
  if (config.autoLaunch === false) return;
  let launched = false;
  let attempts = 0;
  let timer;

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
    const child = spawn(binary, [appDir, `--dsh-link=${link}`], {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child.unref();
    launched = true;
    stop();
    console.info('[dsh-glass-plugin] Glass desktop companion launched (authenticated link redacted)');
  };

  if (typeof ctx.effect === 'function') ctx.effect(() => () => { stop(); });
  timer = setInterval(() => { if (!launched) tryLaunch(); }, 250);
}
