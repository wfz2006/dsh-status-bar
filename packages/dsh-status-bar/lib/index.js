// DSH bundle entry for the Glass companion.
//
// The desktop app is its own Electron process. This host plugin starts it once
// the local web server is up, handing over the authenticated URL through
// `--dsh-link` so Glass connects without the user pasting anything. When Glass
// is already running, its single-instance lock focuses the existing window and
// re-connects it with the new link.
//
// Three install shapes have to work:
//
//   - the release tarball, which ships the built app in `app/` and an Electron
//     runtime in `electron/dist/` (self-contained, nothing to build);
//   - the npm package, which ships only this plugin and fetches the same
//     tarball once into a cache directory on first launch;
//   - a checkout of the repository, where both live outside this package
//     (`apps/desktop/out` and the workspace `electron` dependency).
//
// The child also receives `--launcher-pid`; Glass exits when that host process
// disappears, and disposal kills the spawned tree so the companion follows DSH.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-status-bar-plugin';
export const inject = ['connection', 'webServer'];

/** Package root: `lib/index.js` -> the directory that holds `package.json`. */
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));

/** Where the light npm package writes the runtime it downloads on first run. */
const DEFAULT_RUNTIME_URL = 'https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz';

/** The download URL the published manifest advertises, if any. */
function manifestRuntimeUrl() {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
    const url = manifest?.dsh?.statusBar?.runtime;
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

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

function hasApp(candidate) {
  return typeof candidate === 'string' && candidate.length > 0 && existsSync(join(candidate, 'out', 'main', 'index.js'));
}

function distBinary(distDir) {
  return firstFile(electronExecutables().map(name => join(distDir, name)));
}

function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * The app directory holds `out/main/index.js`. The packaged copy wins, then an
 * explicit override, then the checkout layout used while developing.
 */
function resolveAppDir(config) {
  return firstFile([
    config.appDir,
    process.env.DSH_STATUS_BAR_APP,
    process.env.DSH_GLASS_APP,
    join(pluginRoot, 'app'),
    join(pluginRoot, '..', '..', 'apps', 'desktop'),
  ].filter(hasApp));
}

function resolveElectron(config, appDir) {
  const explicit = firstFile([config.electronBinary, process.env.DSH_STATUS_BAR_ELECTRON, process.env.DSH_GLASS_ELECTRON].filter(value => typeof value === 'string'));
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

/** A layout that already has both halves of the companion. */
function resolveInstalled(config) {
  const appDir = resolveAppDir(config);
  if (!appDir) return undefined;
  const electron = resolveElectron(config, appDir);
  return electron ? { appDir, electron } : undefined;
}

function runtimeRoot(config) {
  const base = config.runtimeDir
    ?? process.env.DSH_STATUS_BAR_RUNTIME
    ?? process.env.DSH_GLASS_RUNTIME
    ?? (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dsh-status-bar')
      : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'dsh-status-bar'));
  return join(base, `runtime-${packageVersion()}`);
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Follows redirects; GitHub's release download resolves to a CDN host. */
function download(url, destination, { redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error(`too many redirects while downloading ${url}`));
          return;
        }
        const next = new URL(response.headers.location, url).href;
        download(next, destination, { redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`download failed with HTTP ${status}: ${url}`));
        return;
      }
      const total = Number(response.headers['content-length'] ?? 0);
      let received = 0;
      let reported = 0;
      const file = createWriteStream(destination);
      response.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const percent = Math.floor((received / total) * 100);
          if (percent >= reported + 10) {
            reported = percent - (percent % 10);
            console.info(`[dsh-status-bar] downloading the Glass runtime: ${reported}% of ${Math.round(total / (1024 * 1024))} MB`);
          }
        }
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve(received)));
      file.on('error', (error) => {
        rmSync(destination, { force: true });
        reject(error);
      });
    });
    request.on('error', (error) => {
      rmSync(destination, { force: true });
      reject(error);
    });
    request.setTimeout(15 * 60 * 1000, () => request.destroy(new Error(`timed out downloading ${url}`)));
  });
}

/** `tar` ships with Windows 10+ (bsdtar), macOS and every mainstream Linux. */
function extract(tarball, directory) {
  const result = spawnSync('tar', ['-xzf', tarball, '-C', directory], { stdio: 'ignore', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`could not unpack ${tarball} (tar exited with ${result.status ?? result.signal}); extract it manually to ${directory}`);
  }
}

/**
 * Downloads and unpacks the release tarball into the per-version cache, then
 * returns the same `{ appDir, electron }` shape as a bundled install.
 */
async function fetchRuntime(config) {
  const url = config.downloadUrl ?? process.env.DSH_STATUS_BAR_RUNTIME_URL ?? process.env.DSH_GLASS_RUNTIME_URL ?? manifestRuntimeUrl() ?? DEFAULT_RUNTIME_URL;
  const root = runtimeRoot(config);
  const cached = { appDir: join(root, 'app'), electron: distBinary(join(root, 'electron', 'dist')) };
  if (hasApp(cached.appDir) && cached.electron) return cached;

  const staging = `${root}.staging`;
  const tarball = join(tmpdir(), `dsh-status-bar-${process.pid}-${Date.now()}.tgz`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  console.info(`[dsh-status-bar] first run: fetching the ~155 MB Glass runtime from ${url}`);
  try {
    const bytes = await download(url, tarball);
    console.info(`[dsh-status-bar] unpacking the Glass runtime (${Math.round(bytes / (1024 * 1024))} MB)`);
    extract(tarball, staging);
    const unpacked = join(staging, 'package');
    if (!hasApp(join(unpacked, 'app')) || !distBinary(join(unpacked, 'electron', 'dist'))) {
      throw new Error('the downloaded archive does not contain app/ and electron/dist/');
    }
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    renameSync(join(unpacked, 'app'), join(root, 'app'));
    renameSync(join(unpacked, 'electron'), join(root, 'electron'));
  } finally {
    rmSync(tarball, { force: true });
    rmSync(staging, { recursive: true, force: true });
  }

  const electron = distBinary(join(root, 'electron', 'dist'));
  if (!electron) throw new Error(`the runtime in ${root} has no Electron executable`);
  return { appDir: join(root, 'app'), electron };
}

function killChild(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try { child.kill(); } catch { /* already gone */ }
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

function bundleMtimeOf(appDir) {
  try { return statSync(join(appDir, 'out', 'main', 'index.js')).mtimeMs; } catch { return 0; }
}

export function apply(ctx, config = {}) {
  if (config.autoLaunch === false) return;
  let child;
  let attempts = 0;
  let timer;
  let watcher;
  let bundleStamp = 0;
  let target = resolveInstalled(config);
  let preparing = false;
  let fatal;

  const stopClock = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const startClock = () => {
    if (!timer) timer = setInterval(tryLaunch, 250);
  };

  const useTarget = (next) => {
    target = next;
    bundleStamp = bundleMtimeOf(next.appDir);
    startClock();
  };

  const prepare = () => {
    if (preparing || target || fatal) return;
    preparing = true;
    fetchRuntime(config).then((next) => {
      preparing = false;
      console.info(`[dsh-status-bar] Glass runtime ready at ${next.appDir}`);
      useTarget(next);
    }, (error) => {
      preparing = false;
      fatal = `[dsh-status-bar] could not prepare the Glass runtime: ${describeError(error)}`;
      console.warn(fatal);
      stopClock();
    });
  };

  const tryLaunch = () => {
    if (fatal) return;
    if (!target) {
      // The npm build has no app yet: fetch it once, then keep waiting for the
      // web server in the background instead of counting down against it.
      prepare();
      return;
    }
    attempts += 1;
    if (attempts > 600) {
      stopClock();
      console.warn('[dsh-status-bar] no web server origin after 150s; the Glass companion was not started');
      return;
    }
    let origin;
    try { origin = ctx.webServer.getOrigin(); } catch { return; }
    let link;
    try { link = ctx.connection.authenticatedUrl(origin); } catch { return; }
    if (!link || !/^https?:\/\//.test(link)) return;

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const spawned = spawn(target.electron, [target.appDir, `--dsh-link=${link}`, `--launcher-pid=${process.pid}`], {
      cwd: target.appDir,
      detached: true,
      stdio: 'ignore',
      env,
    });
    child = spawned;
    spawned.on('exit', () => { if (child === spawned) child = undefined; });
    spawned.unref();
    bundleStamp = bundleMtimeOf(target.appDir);
    stopClock();
    console.info('[dsh-status-bar] Glass desktop companion launched (authenticated link redacted)');
  };

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      stopClock();
      if (watcher) clearInterval(watcher);
      watcher = undefined;
      killChild(child);
      child = undefined;
    });
  }

  if (target) {
    startClock();
  } else {
    prepare();
  }

  if (config.autoReload !== false) {
    // Rebuild-and-reload loop: when the desktop bundle changes, relaunch the
    // running companion with the current authenticated link. A user-initiated
    // quit leaves `child` empty, so it is never resurrected by a build.
    watcher = setInterval(() => {
      if (!target) return;
      const stamp = bundleMtimeOf(target.appDir);
      if (!child || !stamp || bundleStamp === 0 || stamp === bundleStamp) return;
      bundleStamp = stamp;
      console.info('[dsh-status-bar] desktop bundle changed; relaunching the Glass companion');
      killChild(child);
      child = undefined;
      startClock();
    }, 1500);
  }
}
