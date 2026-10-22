import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { cacheBase } from './runtime.js';

/** Bootstrap feedback cannot depend on the Electron runtime being downloaded.
 * The native window reads only these non-sensitive progress/command files. */
export function createStartupStatus(config, { retry, cancel }) {
  const id = randomUUID(); const base = cacheBase(config);
  const statePath = join(base, `startup-${id}.json`); const actionPath = join(base, `startup-${id}.action`);
  let panel; let timer; let closed = false; let state = {}; let lastLog = '';
  const remove = () => { for (const path of [statePath, actionPath]) try { rmSync(path, { force: true }); } catch { /* A closing native reader may briefly hold the file. */ } };
  function open() {
    if (timer || closed) return;
    mkdirSync(base, { recursive: true });
    timer = setInterval(() => {
      let action;
      try { action = readFileSync(actionPath, 'utf8').trim(); rmSync(actionPath, { force: true }); } catch { return; }
      if (action === 'retry') retry(); else if (action === 'cancel') cancel();
    }, 250); timer.unref();
    if (process.platform !== 'win32' || config.showStartupUI === false) return;
    panel = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-STA', '-File', fileURLToPath(new URL('./startup-window.ps1', import.meta.url)),
        '-StatePath', statePath, '-ActionPath', actionPath, '-OwnerPid', String(process.pid)],
      { stdio: 'ignore', windowsHide: true });
    panel.once('error', () => { console.warn('[dsh-status-bar] 无法打开准备进度窗口，请查看插件日志。'); panel = undefined; });
    panel.once('exit', () => { panel = undefined; if (!closed) cancel(); else remove(); });
    panel.unref();
  }
  return {
    update(patch) {
      if (closed) return;
      state = { ...state, ...patch };
      // The reader retries transient sharing/partial-write errors on its next tick.
      try { open(); writeFileSync(statePath, JSON.stringify(state)); }
      catch { console.warn('[dsh-status-bar] 无法写入准备状态，请检查运行时缓存目录权限。'); }
      const log = `${state.phase}:${Math.floor((state.total ? state.received / state.total : 0) * 10)}`;
      if (log !== lastLog) {
        lastLog = log;
        (state.phase === 'failed' ? console.warn : console.info)(`[dsh-status-bar] ${state.message ?? state.phase}${state.total ? ` ${Math.min(100, Math.floor(state.received / state.total * 100))}%` : ''}`);
      }
    },
    close() {
      if (closed) return; closed = true; clearInterval(timer); timer = undefined;
      if (panel) { panel.kill(); panel = undefined; }
      remove();
    },
  };
}
