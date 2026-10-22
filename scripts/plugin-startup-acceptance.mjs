// Actual thin-plugin -> interrupted local HTTP download -> native progress UI ->
// retry -> real Windows Electron/production renderer, using only a temporary profile.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

if (process.platform !== 'win32') throw new Error('This acceptance requires Windows');
const directory = mkdtempSync(join(tmpdir(), 'glass-first-run-e2e-'));
const output = resolve('.tools/first-run-e2e'); mkdirSync(output, { recursive: true });
const config = { runtimeDir: join(directory, 'cache'), autoReload: false,
  electronBinary: createRequire(resolve('apps/desktop/package.json'))('electron') };
const plugin = join(directory, 'plugin'); mkdirSync(plugin); cpSync('packages/dsh-status-bar/lib', join(plugin, 'lib'), { recursive: true });
writeFileSync(join(plugin, 'package.json'), JSON.stringify({ type: 'module', version: '0.2.5' }));
const portServer = createServer(); await new Promise(resolvePromise => portServer.listen(0, '127.0.0.1', resolvePromise));
const debugPort = portServer.address().port; await new Promise(resolvePromise => portServer.close(resolvePromise));
const payload = join(directory, 'payload', 'package'); mkdirSync(join(payload, 'app', 'out', 'main'), { recursive: true }); mkdirSync(join(payload, 'electron', 'dist'), { recursive: true });
writeFileSync(join(payload, 'package.json'), JSON.stringify({ version: '0.2.5' }));
writeFileSync(join(payload, 'app', 'package.json'), JSON.stringify({ type: 'module', main: 'out/main/index.js', version: '0.2.5' }));
writeFileSync(join(payload, 'app', 'out', 'main', 'index.js'), `import {app} from 'electron'; app.commandLine.appendSwitch('remote-debugging-port','${debugPort}'); await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/out/main/index.js')).href)});`);
// Documented electronBinary override avoids copying/serving another 155MB runtime
// in the fixture; the spawned child is the actual workspace Electron distribution.
writeFileSync(join(payload, 'electron', 'dist', 'electron.exe'), 'fixture marker; actual binary is supplied explicitly');
writeFileSync(join(payload, 'padding'), randomBytes(256 * 1024));
const tarball = join(directory, 'runtime.tgz'); assert.equal(spawnSync('tar', ['-czf', tarball, '-C', join(directory, 'payload'), 'package']).status, 0);
const archive = readFileSync(tarball); const ranges = []; let offline = true;
const server = createServer((request, response) => {
  const offset = Number(request.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0); ranges.push(request.headers.range ?? 'full');
  if (offline && ranges.length > 1) { response.writeHead(503).end(); return; }
  response.writeHead(offset ? 206 : 200, { ETag: '"native-fixture"', 'Content-Length': archive.length - offset,
    ...(offset ? { 'Content-Range': `bytes ${offset}-${archive.length - 1}/${archive.length}` } : {}) });
  if (offline) { response.write(archive.subarray(0, 65536)); setTimeout(() => response.destroy(), 25); }
  else response.end(archive.subarray(offset));
});
const host = new FakeHost(); host.sessions = [{ sessionId: 'startup-acceptance', title: '首次启动恢复验证', running: true }];
let dispose = () => {}; let browser; const report = { result: 'RUNNING', checks: [], scope: 'temporary thin plugin and cache; local synthetic HTTP/Host; real system curl, WPF and Windows Electron; documented executable override; no production Profile' };
const status = () => {
  const name = existsSync(config.runtimeDir) && readdirSync(config.runtimeDir).find(name => /^startup-.*\.json$/.test(name));
  if (!name) return;
  try { return { path: join(config.runtimeDir, name), ...JSON.parse(readFileSync(join(config.runtimeDir, name), 'utf8')) }; } catch { return; }
};
function panelTitles() {
  const command = `$ids=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${process.pid}' | Where-Object Name -eq 'powershell.exe' | Select-Object -ExpandProperty ProcessId); @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object MainWindowTitle | Select-Object -ExpandProperty MainWindowTitle) | ConvertTo-Json -Compress`;
  try { const text = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, encoding: 'utf8' }).trim(); return text ? JSON.parse(text) : []; } catch { return []; }
}
try {
  process.env.GLASS_SMOKE = '0'; process.env.GLASS_USER_DATA_DIR = join(directory, 'profile'); process.env.ELECTRON_RUN_AS_NODE = '1';
  mkdirSync(process.env.GLASS_USER_DATA_DIR);
  writeFileSync(join(process.env.GLASS_USER_DATA_DIR, 'glass-ui.json'), JSON.stringify({ version: 2, settings: { material: 'solid', animation: 'off', sound: false, pin: 'normal' } }));
  await host.start(); await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  config.downloadUrl = `http://127.0.0.1:${server.address().port}/runtime`;
  const { apply } = await import(pathToFileURL(join(plugin, 'lib', 'index.js')).href);
  const ctx = { webServer: { getOrigin: () => host.origin }, connection: { authenticatedUrl: () => host.link() }, effect: effect => { dispose = effect(); } };
  apply(ctx, config);
  await expect.poll(() => status()?.phase, { timeout: 15000 }).toBe('failed');
  await expect.poll(() => JSON.stringify(panelTitles()), { timeout: 10000 }).toContain('DSH Status Bar');
  assert.equal(host.authAttempts, 0); report.checks.push('real dropped download and HTTP 503 produce a visible native failure window before any Host token exchange');
  offline = false; writeFileSync(status().path.replace(/\.json$/, '.action'), 'retry');
  await expect.poll(async () => { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); return true; } catch { return false; } }, { timeout: 15000 }).toBe(true);
  const page = browser.contexts()[0].pages()[0]; await page.locator('main').waitFor();
  await expect.poll(() => page.evaluate(() => window.glass.getSourceState()), { timeout: 10000 }).toMatchObject({ mode: 'dsh', connection: 'connected' });
  await expect.poll(() => page.evaluate(() => window.glass.getState())).toMatchObject({ sessions: { 'startup-acceptance': { title: '首次启动恢复验证' } } });
  assert.ok(ranges.at(-1).startsWith('bytes=')); report.checks.push('retry resumes the existing partial and opens the real companion with sandboxed production UI and current Host state');
  assert.equal(host.authAttempts, 1); await expect.poll(() => status()).toBeUndefined();
  await expect.poll(() => JSON.stringify(panelTitles())).not.toContain('DSH Status Bar');
  report.checks.push('successful launch closes the native panel; ELECTRON_RUN_AS_NODE in the parent does not break Electron');
  await page.screenshot({ path: join(output, 'companion.png') });
  dispose(); await expect.poll(() => browser.isConnected(), { timeout: 10000 }).toBe(false); report.checks.push('plugin disposal closes its real Electron child');
  report.ranges = ranges; report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = String(error); throw error; }
finally {
  dispose(); if (browser?.isConnected()) await browser.close();
  await host.stop(); await new Promise(resolvePromise => { server.close(resolvePromise); server.closeAllConnections(); });
  writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  if (!directory.startsWith(join(tmpdir(), 'glass-first-run-e2e-'))) throw new Error('Unexpected fixture cleanup path');
  rmSync(directory, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
}
