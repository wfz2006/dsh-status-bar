import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, openSync, closeSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { abortError, checkAbort, delay, downloadArchive } from './download.js';

const DEFAULT_RUNTIME_URL = 'https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz';
const json = path => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; } };
const firstFile = values => values.find(value => { try { return typeof value === 'string' && statSync(value).isFile(); } catch { return false; } });
const hasApp = path => typeof path === 'string' && !!firstFile([join(path, 'out', 'main', 'index.js')]);
export function packageVersion(root) {
  const version = json(join(root, 'package.json')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('插件版本信息无效，请重新安装插件。');
  return version;
}
export function cacheBase(config) {
  return resolve(config.runtimeDir ?? process.env.DSH_STATUS_BAR_RUNTIME ?? process.env.DSH_GLASS_RUNTIME ??
    (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'dsh-status-bar') : join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'dsh-status-bar')));
}
export function runtimeUrl(config, root) {
  const explicit = config.downloadUrl ?? process.env.DSH_STATUS_BAR_RUNTIME_URL ?? process.env.DSH_GLASS_RUNTIME_URL;
  const advertised = json(join(root, 'package.json')).dsh?.statusBar?.runtime;
  const url = explicit ?? advertised ?? DEFAULT_RUNTIME_URL;
  return !explicit && url === DEFAULT_RUNTIME_URL ? `https://github.com/wfz2006/dsh-status-bar/releases/download/v${packageVersion(root)}/dsh-status-bar.tgz` : url;
}
function binary(dist) {
  const name = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? join('Electron.app', 'Contents', 'MacOS', 'Electron') : 'electron';
  return firstFile([join(dist, name)]);
}
export function resolveInstalled(config, root) {
  const appDir = [config.appDir, process.env.DSH_STATUS_BAR_APP, process.env.DSH_GLASS_APP, join(root, 'app'), join(root, '..', '..', 'apps', 'desktop')].find(hasApp);
  if (!appDir) return;
  let electron = firstFile([config.electronBinary, process.env.DSH_STATUS_BAR_ELECTRON, process.env.DSH_GLASS_ELECTRON]) ?? binary(join(root, 'electron', 'dist'));
  for (const base of [appDir, root]) {
    if (electron) break;
    try { electron = binary(join(dirname(createRequire(join(base, 'package.json')).resolve('electron/package.json')), 'dist')); } catch { /* Try the other install shape. */ }
  }
  return electron ? { appDir, electron } : undefined;
}
function cachedRuntime(root, version) {
  const appDir = join(root, 'app'); const electron = binary(join(root, 'electron', 'dist'));
  return hasApp(appDir) && electron && json(join(appDir, 'package.json')).version === version ? { appDir, electron } : undefined;
}
export function resolveAvailable(config, root) {
  const direct = resolveInstalled(config, root); if (direct) return direct;
  const version = packageVersion(root);
  const cached = cachedRuntime(join(cacheBase(config), `runtime-${version}`), version);
  return cached ? resolveInstalled({ ...config, appDir: cached.appDir }, root) ?? cached : undefined;
}
async function lock(path, signal, onProgress) {
  const owner = randomUUID();
  for (;;) {
    checkAbort(signal);
    try {
      const fd = openSync(path, 'wx');
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, owner })); } finally { closeSync(fd); }
      return () => { if (json(path).owner === owner) rmSync(path, { force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = json(path); let alive = true;
      if (Number.isSafeInteger(current.pid) && current.pid > 0) {
        try { process.kill(current.pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
      } else { try { alive = Date.now() - statSync(path).mtimeMs < 10000; } catch { continue; } }
      if (!alive) { rmSync(path, { force: true }); continue; }
      onProgress({ phase: 'waiting', message: '另一个 DSH 窗口正在准备同版本运行时，完成后会自动继续。' });
      await delay(500, signal);
    }
  }
}
function run(program, args, signal, capture = false) {
  checkAbort(signal);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
    let output = ''; let excessive = false;
    child.stdout?.on('data', chunk => { output += chunk.toString(); if (output.length > 16 * 1024 * 1024) { excessive = true; child.kill(); } });
    const abort = () => child.kill(); signal?.addEventListener('abort', abort, { once: true });
    child.once('error', error => { signal?.removeEventListener('abort', abort); reject(error); });
    child.once('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(abortError());
      else if (code !== 0 || excessive) reject(new Error('运行时压缩包无法解压，请重试或安装自包含版本。'));
      else resolvePromise(output);
    });
    if (signal?.aborted) abort();
  });
}
function removeOwned(path, root) {
  if (dirname(path) !== dirname(root) || !basename(path).startsWith(`${basename(root)}.`)) throw new Error('缓存临时路径无效。');
  rmSync(path, { recursive: true, force: true });
}
export async function ensureRuntime(config, pluginRoot, { signal, onProgress = () => {} } = {}) {
  const version = packageVersion(pluginRoot); const base = cacheBase(config); const root = join(base, `runtime-${version}`);
  const cached = cachedRuntime(root, version); if (cached) return cached;
  mkdirSync(base, { recursive: true });
  const release = await lock(`${root}.lock`, signal, onProgress);
  const part = `${root}.tgz.part`; const staging = `${root}.staging-${randomUUID()}`; const previous = `${root}.previous-${randomUUID()}`;
  try {
    const installedByPeer = cachedRuntime(root, version); if (installedByPeer) return installedByPeer;
    // The exclusive lock proves that no other preparer owns these generated
    // staging folders. An abrupt Host exit must not leave one unpack per retry.
    for (const name of readdirSync(base)) if (name.startsWith(`${basename(root)}.staging-`) && /^[0-9a-f-]{36}$/.test(name.slice(`${basename(root)}.staging-`.length))) removeOwned(join(base, name), root);
    await downloadArchive(runtimeUrl(config, pluginRoot), part, { signal, onProgress }); checkAbort(signal);
    onProgress({ phase: 'unpacking', message: '下载完成，正在校验并解压运行时。' });
    let entries;
    try { entries = await run('tar', ['-tvzf', part], signal, true); }
    catch (error) { if (error.name !== 'AbortError') { rmSync(part, { force: true }); rmSync(`${part}.json`, { force: true }); } throw error; }
    // Reject links and traversal before extraction; only this package subtree is expected.
    for (const line of entries.split(/\r?\n/).filter(Boolean)) {
      const entry = line.match(/\b(package\/.*)$/)?.[1];
      if (!['-', 'd'].includes(line[0]) || !entry || entry.includes('\\') || entry.split('/').some(part => part === '..' || part.includes(':'))) {
        rmSync(part, { force: true }); rmSync(`${part}.json`, { force: true });
        throw new Error('运行时压缩包包含不支持的条目。');
      }
    }
    mkdirSync(staging);
    await run('tar', ['-xzf', part, '-C', staging, '--no-same-owner', '--no-same-permissions'], signal);
    const unpacked = join(staging, 'package');
    if (json(join(unpacked, 'package.json')).version !== version || !cachedRuntime(unpacked, version)) {
      rmSync(part, { force: true }); rmSync(`${part}.json`, { force: true });
      throw new Error(`下载内容与插件 ${version} 不匹配，未覆盖现有缓存。请重试或安装对应版本的自包含包。`);
    }
    checkAbort(signal);
    if (existsSync(root)) renameSync(root, previous);
    try { renameSync(unpacked, root); }
    catch (error) { if (existsSync(previous)) renameSync(previous, root); throw error; }
    removeOwned(previous, root);
    rmSync(part, { force: true }); rmSync(`${part}.json`, { force: true });
    return cachedRuntime(root, version);
  } finally { try { removeOwned(staging, root); } finally { release(); } }
}
