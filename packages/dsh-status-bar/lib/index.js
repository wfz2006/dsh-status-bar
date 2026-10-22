// DSH starts the companion only after its runtime and authenticated Host are
// ready. Bootstrap work is cancellable and never replays a saved Host token.
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntime, resolveInstalled, resolveAvailable } from './runtime.js';
import { createStartupStatus } from './startup-status.js';

export const name = 'dsh-status-bar-plugin';
export const inject = ['connection', 'webServer'];
const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
function stamp(appDir) { try { return statSync(join(appDir, 'out', 'main', 'index.js')).mtimeMs; } catch { return 0; } }
function killChild(child) {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => { try { child.kill(); } catch { /* Already gone. */ } });
  } else { try { child.kill(); } catch { /* Already gone. */ } }
}
function launchEnv() { const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; return env; }
export function apply(ctx, config = {}) {
  let child; let timer; let watcher; let controller; let feedback;
  let attempts = 0; let bundleStamp = 0; let preparing = false; let spawning = false;
  let disposed = false; let paused = false; let failed = false;
  let target = resolveAvailable(config, pluginRoot);
  function stopClock() { clearInterval(timer); timer = undefined; }
  function closeStatus() { feedback?.close(); feedback = undefined; }
  function update(state) {
    if (disposed || paused) return;
    feedback ??= createStartupStatus(config, { retry, cancel }); feedback.update(state);
  }
  function fail(message) {
    if (disposed || paused) return;
    failed = true; stopClock();
    update({ phase: 'failed', message, received: 0, total: 0 });
  }
  function cancel() {
    if (disposed || paused) return;
    paused = true; controller?.abort(); stopClock(); closeStatus();
  }
  function retry() {
    if (disposed || preparing || spawning || child) return;
    failed = paused = false; attempts = 0;
    target = resolveAvailable(config, pluginRoot) ?? target;
    if (target) startClock(); else prepare();
  }
  function prepare() {
    if (preparing || target || disposed || paused || failed) return;
    preparing = true; const current = new AbortController(); controller = current;
    update({ phase: 'downloading', received: 0, total: 0, message: '首次启动需要准备桌面运行时，完成后自动打开悬浮窗。' });
    void ensureRuntime(config, pluginRoot, { signal: current.signal, onProgress: update }).then(next => {
      if (disposed || paused || current.signal.aborted || controller !== current) return;
      target = resolveInstalled({ ...config, appDir: next.appDir }, pluginRoot) ?? next; bundleStamp = stamp(target.appDir);
      update({ phase: 'launching', message: '运行时已就绪，正在连接 DSH 并打开悬浮窗。' });
      startClock();
    }, error => {
      if (!current.signal.aborted && !disposed && !paused) fail(error instanceof Error ? error.message : '运行时准备失败，请点击重试。');
    }).finally(() => { if (controller === current) { preparing = false; controller = undefined; } });
  }
  function startClock() {
    if (timer || disposed || paused || failed) return;
    timer = setInterval(tryLaunch, 250);
  }
  function spawnTracked(link) {
    spawning = true; stopClock();
    let spawned;
    try {
      spawned = spawn(target.electron, [target.appDir, `--dsh-link=${link}`, `--launcher-pid=${process.pid}`], {
        cwd: target.appDir, detached: true, stdio: 'ignore', env: launchEnv(),
      });
    } catch { spawning = false; fail('无法启动桌面运行时，请检查系统权限后重试。'); return; }
    child = spawned;
    spawned.once('error', error => {
      if (child === spawned) child = undefined;
      spawning = false;
      const code = /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'unknown';
      fail(`桌面运行时未能启动（${code}），请检查运行时文件与权限后重试。`);
    });
    spawned.once('spawn', () => {
      spawning = false;
      if (disposed || paused) { killChild(spawned); return; }
      bundleStamp = stamp(target.appDir); closeStatus();
      console.info('[dsh-status-bar] Glass desktop companion launched (authenticated link redacted)');
    });
    spawned.once('exit', (code, signal) => {
      if (child !== spawned) return;
      child = undefined; spawning = false;
      if (!disposed && !paused && (code !== 0 || signal)) fail('悬浮窗进程意外退出。点击重试可重新启动；若仍失败，请重新安装运行时。');
    });
    spawned.unref();
  }
  function tryLaunch() {
    if (disposed || paused || failed || spawning || child) return;
    if (!target) { prepare(); return; }
    if (++attempts > 600) { fail('DSH 本地服务尚未就绪，悬浮窗未启动。待 DSH 加载完成后点击重试。'); return; }
    let link;
    try { link = ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()); } catch { return; }
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) return;
    spawnTracked(link);
  }
  function wake(link) {
    return new Promise((resolve, reject) => {
      let spawned;
      try {
        spawned = spawn(target.electron, [target.appDir, `--dsh-link=${link}`, `--launcher-pid=${process.pid}`], {
          cwd: target.appDir, detached: true, stdio: 'ignore', env: launchEnv(),
        });
      } catch (error) { reject(error); return; }
      spawned.once('spawn', () => resolve());
      spawned.once('error', reject);
      spawned.unref();
    });
  }
  // The command is the recovery entry for a hidden window and for a companion
  // the user quit earlier. A running instance receives the second-instance
  // hand-off and shows itself; a missing one is launched with a fresh link.
  async function showCompanion() {
    if (disposed) return { kind: 'error', text: '插件已停用，请重启 DSH。' };
    failed = paused = false; attempts = 0;
    if (!target) {
      if (!preparing) prepare();
      return { kind: 'success', text: '正在准备桌面运行时，完成后会自动打开悬浮窗。' };
    }
    let link;
    try { link = ctx.connection.authenticatedUrl(ctx.webServer.getOrigin()); } catch { link = undefined; }
    if (typeof link !== 'string' || !/^https?:\/\//.test(link)) return { kind: 'error', text: 'DSH 本地服务尚未就绪，请稍后再试。' };
    if (child) {
      try { await wake(link); return { kind: 'success', text: '已请求显示悬浮窗。' }; }
      catch { return { kind: 'error', text: '无法显示悬浮窗，请稍后重试。' }; }
    }
    if (spawning) return { kind: 'success', text: '正在打开悬浮窗。' };
    startClock(); tryLaunch();
    return { kind: 'success', text: '正在打开悬浮窗。' };
  }
  function registerCommand() {
    if (typeof ctx.inject !== 'function') return;
    ctx.inject(['commands'], commandCtx => {
      const register = () => commandCtx.commands.register({
        name: 'status-bar',
        description: '显示或重新启动 DSH Status Bar 悬浮窗',
        recordInput: false,
        handler: showCompanion,
      });
      if (typeof commandCtx.effect === 'function') commandCtx.effect(register);
      else if (typeof ctx.effect === 'function') ctx.effect(register);
      else register();
    });
  }
  registerCommand();
  if (config.autoLaunch === false) return;
  if (typeof ctx.effect === 'function') ctx.effect(() => () => {
    disposed = true; controller?.abort(); stopClock(); clearInterval(watcher); watcher = undefined;
    closeStatus(); killChild(child); child = undefined;
  });
  if (target) startClock(); else prepare();
  if (config.autoReload !== false) {
    watcher = setInterval(() => {
      if (!target || !child || spawning || disposed || paused) return;
      const nextStamp = stamp(target.appDir);
      if (!nextStamp || !bundleStamp || nextStamp === bundleStamp) return;
      bundleStamp = nextStamp; const previous = child; child = undefined; killChild(previous); attempts = 0; startClock();
    }, 1500); watcher.unref();
  }
}
