import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const launchState = vi.hoisted(() => ({ fail: false }));
const launched = vi.hoisted(() => [] as { executable: string; args: string[]; child: EventEmitter; env?: NodeJS.ProcessEnv }[]);
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: (file: string, args: string[], options: object) => {
    if (file.includes('electron') && file.endsWith('.exe')) {
      const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, unref: () => {}, kill: vi.fn() });
      launched.push({ executable: file, args, child, env: (options as { env?: NodeJS.ProcessEnv }).env });
      queueMicrotask(() => child.emit(launchState.fail ? 'error' : 'spawn', Object.assign(new Error('Do not log launch arguments'), { code: 'ENOEXEC' }))); return child;
    }
    return actual.spawn(file, args, options);
  } };
});
// Route the original HTTPS-only downloader to the local HTTP fixture so the
// red test exercises a dropped response, without bypassing real TLS anywhere.
vi.mock('node:https', async () => ({ get: (await import('node:http')).get }));
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); launched.length = 0; launchState.fail = false; vi.restoreAllMocks(); vi.unstubAllEnvs(); });
type CommandDefinition = { name: string; description: string; handler: (invocation: unknown) => Promise<{ kind: string; text?: string }> };
type CommandContext = { commands: { register(definition: CommandDefinition): () => void }; effect(cb: () => (() => void) | void): void };
type Plugin = { apply: (ctx: { webServer: { getOrigin(): string }; connection: { authenticatedUrl(origin: string): string }; effect(cb: () => () => void): void; inject?(deps: string[], callback: (context: CommandContext) => void): void }, config: Record<string, unknown>) => void };
type Progress = { phase?: string; received?: number; total?: number; message?: string };
type Runtime = { runtimeUrl(config: object, root: string): string; ensureRuntime(config: object, root: string, options?: { signal?: AbortSignal; onProgress?: (state: Progress) => void }): Promise<{ appDir: string; electron: string }> };
type Downloader = { downloadArchive(url: string, part: string, options?: { signal?: AbortSignal; onProgress?: (state: Progress) => void; backend?: string; attempts?: number; idleMs?: number; timeoutMs?: number }): Promise<void> };
async function fixture(options: { version?: string; respond?: (req: IncomingMessage, res: ServerResponse, bytes: Buffer, requests: string[]) => void } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'glass-plugin-startup-'));
  cleanup.push(() => { if (!directory.startsWith(join(tmpdir(), 'glass-plugin-startup-'))) throw new Error('Unexpected test path'); rmSync(directory, { recursive: true, force: true }); });
  const plugin = join(directory, 'plugin'); mkdirSync(plugin);
  cpSync('packages/dsh-status-bar/lib', join(plugin, 'lib'), { recursive: true });
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ type: 'module', version: '0.2.5' }));
  const payload = join(directory, 'payload', 'package'); mkdirSync(join(payload, 'app', 'out', 'main'), { recursive: true }); mkdirSync(join(payload, 'electron', 'dist'), { recursive: true });
  writeFileSync(join(payload, 'package.json'), JSON.stringify({ version: options.version ?? '0.2.5' }));
  writeFileSync(join(payload, 'app', 'package.json'), JSON.stringify({ version: options.version ?? '0.2.5' }));
  writeFileSync(join(payload, 'app', 'out', 'main', 'index.js'), '// fixture, never executed');
  writeFileSync(join(payload, 'electron', 'dist', 'electron.exe'), 'fixture, never executed');
  writeFileSync(join(payload, 'padding'), randomBytes(384 * 1024));
  const archive = join(directory, 'runtime.tgz'); expect(spawnSync('tar', ['-czf', archive, '-C', join(directory, 'payload'), 'package']).status).toBe(0);
  const bytes = readFileSync(archive); const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.headers.range ?? 'full'); const start = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
    if (options.respond) { options.respond(req, res, bytes, requests); return; }
    res.writeHead(start ? 206 : 200, { ETag: '"fixture-v1"', 'Content-Length': bytes.length - start,
      ...(start ? { 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}) });
    if (requests.length === 1) { res.write(bytes.subarray(0, 65536)); setTimeout(() => res.destroy(), 20); }
    else res.end(bytes.subarray(start));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture server missing');
  const loaded = await import(pathToFileURL(join(plugin, 'lib', 'index.js')).href) as Plugin;
  let dispose = () => {};
  const commands: { definition: CommandDefinition; dispose: ReturnType<typeof vi.fn> }[] = [];
  const commandCtx: CommandContext = {
    commands: { register: vi.fn((definition: CommandDefinition) => { const stop = vi.fn(); commands.push({ definition, dispose: stop }); return stop; }) },
    effect: (cb: () => (() => void) | void) => { const stop = cb(); cleanup.push(() => stop?.()); },
  };
  const ctx = { webServer: { getOrigin: () => 'http://127.0.0.1:1' }, connection: { authenticatedUrl: vi.fn(() => 'http://127.0.0.1:1/?token=test-only') }, effect: (cb: () => () => void) => { dispose = cb(); },
    inject: (deps: string[], callback: (context: CommandContext) => void) => { if (deps.includes('commands')) callback(commandCtx); } };
  cleanup.push(() => dispose());
  const runtimeDir = join(directory, 'cache');
  const status = () => {
    const name = existsSync(runtimeDir) ? readdirSync(runtimeDir).find(name => /^startup-.*\.json$/.test(name)) : undefined;
    if (!name) return;
    try { return { path: join(runtimeDir, name), ...JSON.parse(readFileSync(join(runtimeDir, name), 'utf8')) } as Progress & { path: string }; } catch { return; }
  };
  return { directory, plugin, loaded, ctx, commands, requests, bytes, payload, status, url: `http://127.0.0.1:${address.port}/runtime`, dispose: () => dispose(), runtimeDir,
    runtime: () => import(pathToFileURL(join(plugin, 'lib', 'runtime.js')).href) as Promise<Runtime>,
    downloader: () => import(pathToFileURL(join(plugin, 'lib', 'download.js')).href) as Promise<Downloader> };
}
it('recovers a real interrupted first download with Range and launches only a validated runtime', async () => {
  const f = await fixture();
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, downloadUrl: f.url, showStartupUI: false, autoReload: false });
  await expect.poll(() => f.requests.length, { timeout: 2500 }).toBeGreaterThan(1);
  await expect.poll(() => launched.length, { timeout: 5000 }).toBe(1);
  expect(f.requests[1]).toMatch(/^bytes=[1-9]\d*-$/);
  expect(existsSync(join(f.runtimeDir, 'runtime-0.2.5', 'app', 'out', 'main', 'index.js'))).toBe(true);
  expect(launched[0]?.args.some(value => value.startsWith('--dsh-link='))).toBe(true);
});
it('keeps failed startup visible and supports retry without restarting DSH or issuing an early auth link', async () => {
  let offline = true;
  const f = await fixture({ respond: (_req, res, bytes) => { if (offline) res.writeHead(503).end(); else res.writeHead(200, { ETag: '"ok"', 'Content-Length': bytes.length }).end(bytes); } });
  const log = vi.spyOn(console, 'info'); const warnings = vi.spyOn(console, 'warn');
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, downloadUrl: f.url, showStartupUI: false, autoReload: false });
  await expect.poll(() => f.status()?.phase, { timeout: 6500 }).toBe('failed');
  expect(launched).toHaveLength(0); expect(f.ctx.connection.authenticatedUrl).not.toHaveBeenCalled();
  expect(f.status()?.message).toContain('重试'); offline = false;
  writeFileSync(f.status()!.path.replace(/\.json$/, '.action'), 'retry');
  await expect.poll(() => launched.length, { timeout: 4000 }).toBe(1);
  expect(f.ctx.connection.authenticatedUrl).toHaveBeenCalledOnce();
  expect(JSON.stringify([log.mock.calls, warnings.mock.calls])).not.toContain('test-only');
  expect(f.status()).toBeUndefined();
}, 12000);
it('disposal during a download aborts it and cannot launch a late companion', async () => {
  const f = await fixture({ respond: (_req, res, bytes) => { res.writeHead(200, { ETag: '"slow"', 'Content-Length': bytes.length }); res.write(bytes.subarray(0, 65536)); } });
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, downloadUrl: f.url, showStartupUI: false, autoReload: false });
  await expect.poll(() => f.requests.length).toBe(1); f.dispose();
  await expect.poll(() => existsSync(join(f.runtimeDir, 'runtime-0.2.5.lock'))).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(launched).toHaveLength(0); expect(f.status()).toBeUndefined(); expect(f.ctx.connection.authenticatedUrl).not.toHaveBeenCalled();
});
it('reuses the existing manual 0.2.5 cache without a request and removes ELECTRON_RUN_AS_NODE', async () => {
  const f = await fixture(); mkdirSync(f.runtimeDir); cpSync(f.payload, join(f.runtimeDir, 'runtime-0.2.5'), { recursive: true });
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, downloadUrl: f.url, showStartupUI: false, autoReload: false });
  expect(f.status()).toBeUndefined(); // No bootstrap panel flash on a cache hit.
  await expect.poll(() => launched.length).toBe(1);
  expect(f.requests).toHaveLength(0); expect(launched[0]?.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE'); expect(f.status()).toBeUndefined();
});
it('reports spawn errors and allows retry from the complete cache', async () => {
  const f = await fixture(); mkdirSync(f.runtimeDir); cpSync(f.payload, join(f.runtimeDir, 'runtime-0.2.5'), { recursive: true });
  launchState.fail = true;
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, downloadUrl: f.url, showStartupUI: false, autoReload: false });
  await expect.poll(() => f.status()?.phase).toBe('failed'); expect(f.status()?.message).toContain('ENOEXEC');
  expect(f.status()?.message).not.toContain('test-only'); launchState.fail = false;
  writeFileSync(f.status()!.path.replace(/\.json$/, '.action'), 'retry');
  await expect.poll(() => launched.length).toBe(2); expect(f.requests).toHaveLength(0);
});
it('does nothing when auto launch is disabled', async () => {
  const f = await fixture(); f.loaded.apply(f.ctx, { autoLaunch: false, runtimeDir: f.runtimeDir });
  await new Promise(resolve => setTimeout(resolve, 350));
  expect(f.requests).toHaveLength(0); expect(launched).toHaveLength(0); expect(f.status()).toBeUndefined();
});
it('keeps /status-bar available when auto launch is disabled', async () => {
  const f = await fixture(); mkdirSync(f.runtimeDir); cpSync(f.payload, join(f.runtimeDir, 'runtime-0.2.5'), { recursive: true });
  f.loaded.apply(f.ctx, { autoLaunch: false, runtimeDir: f.runtimeDir });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(launched).toHaveLength(0);
  const command = f.commands.find(entry => entry.definition.name === 'status-bar')?.definition;
  expect(command).toBeTruthy();
  const result = await command!.handler({});
  expect(result.kind).toBe('success');
  await expect.poll(() => launched.length).toBe(1);
  expect(f.requests).toHaveLength(0);
});
it('wakes a running companion from /status-bar without exposing the authenticated link', async () => {
  const f = await fixture(); mkdirSync(f.runtimeDir); cpSync(f.payload, join(f.runtimeDir, 'runtime-0.2.5'), { recursive: true });
  const log = vi.spyOn(console, 'info'); const warnings = vi.spyOn(console, 'warn');
  f.loaded.apply(f.ctx, { runtimeDir: f.runtimeDir, showStartupUI: false, autoReload: false });
  await expect.poll(() => launched.length).toBe(1);
  const command = f.commands.find(entry => entry.definition.name === 'status-bar')?.definition;
  expect(command).toBeTruthy();
  const result = await command!.handler({});
  expect(result).toMatchObject({ kind: 'success' });
  await expect.poll(() => launched.length).toBe(2);
  expect(f.requests).toHaveLength(0);
  expect(JSON.stringify([log.mock.calls, warnings.mock.calls, result])).not.toContain('test-only');
});
it('pins the default/latest manifest URL to this plugin version and preserves explicit overrides', async () => {
  const f = await fixture(); const runtime = await f.runtime();
  expect(runtime.runtimeUrl({}, f.plugin)).toContain('/download/v0.2.5/');
  writeFileSync(join(f.plugin, 'package.json'), JSON.stringify({ version: '0.2.5', dsh: { statusBar: { runtime: 'https://github.com/wfz2006/dsh-status-bar/releases/latest/download/dsh-status-bar.tgz' } } }));
  expect(runtime.runtimeUrl({}, f.plugin)).toContain('/download/v0.2.5/');
  expect(runtime.runtimeUrl({ downloadUrl: f.url }, f.plugin)).toBe(f.url);
});
it('prefers the npm-hosted runtime and keeps the release asset as its fallback', async () => {
  const f = await fixture();
  type RuntimeWithFallback = { runtimeUrls(config: object, root: string): string[] };
  const runtime = await f.runtime() as unknown as RuntimeWithFallback;
  expect(runtime.runtimeUrls({}, f.plugin)).toEqual(['https://github.com/wfz2006/dsh-status-bar/releases/download/v0.2.5/dsh-status-bar.tgz']);
  const npmRuntime = 'https://registry.npmjs.org/dsh-status-bar-runtime/-/dsh-status-bar-runtime-0.2.5.tgz';
  writeFileSync(join(f.plugin, 'package.json'), JSON.stringify({ version: '0.2.5', dsh: { statusBar: { runtime: npmRuntime } } }));
  expect(runtime.runtimeUrls({}, f.plugin)).toEqual([npmRuntime, 'https://github.com/wfz2006/dsh-status-bar/releases/download/v0.2.5/dsh-status-bar.tgz']);
  expect(runtime.runtimeUrls({ downloadUrl: f.url }, f.plugin)).toEqual([f.url]);
});
it('does not publish a cache for an archive from the wrong release', async () => {
  const f = await fixture({ version: '9.9.9', respond: (_req, res, bytes) => res.writeHead(200, { ETag: '"wrong"', 'Content-Length': bytes.length }).end(bytes) });
  const runtime = await f.runtime();
  await expect(runtime.ensureRuntime({ runtimeDir: f.runtimeDir, downloadUrl: f.url }, f.plugin)).rejects.toThrow('不匹配');
  expect(existsSync(join(f.runtimeDir, 'runtime-0.2.5'))).toBe(false);
});
it('serializes two preparations and lets a cancelled waiter leave the owner intact', async () => {
  const f = await fixture(); const runtime = await f.runtime(); const config = { runtimeDir: f.runtimeDir, downloadUrl: f.url };
  const owner = runtime.ensureRuntime(config, f.plugin);
  await expect.poll(() => f.requests.length).toBe(1);
  const cancel = new AbortController();
  const waiter = runtime.ensureRuntime(config, f.plugin, { signal: cancel.signal, onProgress: value => { if (value.phase === 'waiting') cancel.abort(); } });
  await expect(waiter).rejects.toMatchObject({ name: 'AbortError' });
  const peer = runtime.ensureRuntime(config, f.plugin);
  const [first, second] = await Promise.all([owner, peer]); expect(second).toEqual(first);
  expect(f.requests).toHaveLength(2); expect(existsSync(join(f.runtimeDir, 'runtime-0.2.5.lock'))).toBe(false);
});
it('restarts safely when a server ignores Range instead of appending a complete file to the partial', async () => {
  const f = await fixture({ respond: (_req, res, bytes, requests) => {
    res.writeHead(200, { ETag: requests.length === 1 ? '"old"' : '"new"', 'Content-Length': bytes.length });
    if (requests.length === 1) { res.write(bytes.subarray(0, 65536)); setTimeout(() => res.destroy(), 20); } else res.end(bytes);
  } });
  mkdirSync(f.runtimeDir); const part = join(f.runtimeDir, 'test.part'); const { downloadArchive } = await f.downloader();
  await downloadArchive(f.url, part); expect(readFileSync(part).equals(f.bytes)).toBe(true);
  expect(f.requests[1]).toMatch(/^bytes=/); expect(f.requests.at(-1)).toBe('full');
});
it('preserves a verified partial across cancellation and resumes it using the Node fallback', async () => {
  const f = await fixture({ respond: (req, res, bytes, requests) => {
    const offset = Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1] ?? 0);
    res.writeHead(offset ? 206 : 200, { ETag: '"same"', 'Content-Length': bytes.length - offset,
      ...(offset ? { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) });
    if (requests.length === 1) res.write(bytes.subarray(0, 65536)); else res.end(bytes.subarray(offset));
  } });
  mkdirSync(f.runtimeDir); const part = join(f.runtimeDir, 'test.part'); const { downloadArchive } = await f.downloader(); const cancel = new AbortController();
  await expect(downloadArchive(f.url, part, { backend: 'node', signal: cancel.signal, onProgress: p => { if ((p.received ?? 0) >= 65536) cancel.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  expect(readFileSync(part).length).toBeGreaterThan(0);
  await downloadArchive(f.url, part, { backend: 'node' }); expect(f.requests[1]).toMatch(/^bytes=[1-9]\d*-$/);
  expect(readFileSync(part).equals(f.bytes)).toBe(true);
});
it('bounds a stalled Node transfer instead of waiting for the old fifteen-minute timeout', async () => {
  const f = await fixture({ respond: (_req, res, bytes) => { res.writeHead(200, { ETag: '"stalled"', 'Content-Length': bytes.length }); res.flushHeaders(); } });
  mkdirSync(f.runtimeDir); const { downloadArchive } = await f.downloader();
  const start = Date.now();
  await expect(downloadArchive(f.url, join(f.runtimeDir, 'stall.part'), { backend: 'node', attempts: 1, idleMs: 100, timeoutMs: 1000 })).rejects.toThrow('重试');
  expect(Date.now() - start).toBeLessThan(2000);
});
it('starts fresh after an unverifiable partial instead of blindly resuming it', async () => {
  const f = await fixture({ respond: (_req, res, bytes, requests) => {
    res.writeHead(200, { 'Content-Length': bytes.length });
    if (requests.length === 1) { res.write(bytes.subarray(0, 65536)); setTimeout(() => res.destroy(), 20); } else res.end(bytes);
  } });
  mkdirSync(f.runtimeDir); const part = join(f.runtimeDir, 'test.part'); const { downloadArchive } = await f.downloader();
  await downloadArchive(f.url, part); expect(f.requests).toEqual(['full', 'full']); expect(readFileSync(part).equals(f.bytes)).toBe(true);
});
it('falls back when system curl is unavailable', async () => {
  const f = await fixture(); mkdirSync(f.runtimeDir); const part = join(f.runtimeDir, 'test.part');
  vi.stubEnv('SystemRoot', join(f.directory, 'missing-system-root'));
  const { downloadArchive } = await f.downloader(); await downloadArchive(f.url, part);
  expect(f.requests[1]).toMatch(/^bytes=/); expect(readFileSync(part).equals(f.bytes)).toBe(true);
});
it('discards a corrupt archive so retry can fetch a valid one and removes abandoned staging', async () => {
  let corrupt = true;
  const f = await fixture({ respond: (_req, res, bytes) => { const body = corrupt ? Buffer.from('not an archive') : bytes; res.writeHead(200, { ETag: corrupt ? '"bad"' : '"good"', 'Content-Length': body.length }).end(body); } });
  const runtime = await f.runtime(); const config = { runtimeDir: f.runtimeDir, downloadUrl: f.url };
  await expect(runtime.ensureRuntime(config, f.plugin)).rejects.toThrow('压缩包');
  expect(existsSync(join(f.runtimeDir, 'runtime-0.2.5.tgz.part'))).toBe(false);
  const abandoned = join(f.runtimeDir, 'runtime-0.2.5.staging-00000000-0000-0000-0000-000000000000'); mkdirSync(abandoned); writeFileSync(join(abandoned, 'partial'), 'test');
  corrupt = false; await runtime.ensureRuntime(config, f.plugin);
  expect(existsSync(abandoned)).toBe(false); expect(f.requests).toEqual(['full', 'full']);
});
it('handles a truncated error response in the Node fallback without an unhandled response error', async () => {
  const f = await fixture({ respond: (_req, res) => { res.writeHead(503, { 'Content-Length': 1000 }); res.write('offline'); setTimeout(() => res.destroy(), 10); } });
  mkdirSync(f.runtimeDir); const { downloadArchive } = await f.downloader();
  await expect(downloadArchive(f.url, join(f.runtimeDir, 'bad.part'), { backend: 'node', attempts: 1 })).rejects.toThrow('503');
  await new Promise(resolve => setTimeout(resolve, 50));
});
it('asks Schannel for best-effort revocation checking and still resumes by validator', async () => {
  type Curl = { curlArgs(url: string, part: string, headers: string, previous: { validator?: string; total?: number }, options: { timeoutMs: number; idleMs: number }, quirks?: { schannel?: boolean; revoke?: boolean }): string[] };
  const f = await fixture();
  const { curlArgs } = await f.downloader() as unknown as Curl;
  const directory = mkdtempSync(join(tmpdir(), 'glass-curl-')); cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const part = join(directory, 'runtime.tgz.part'); const headers = join(directory, 'headers'); const options = { timeoutMs: 300000, idleMs: 30000 };
  const url = 'https://example.invalid/dsh-status-bar.tgz';
  expect(curlArgs(url, part, headers, {}, options, { schannel: true })).toContain('--ssl-revoke-best-effort');
  expect(curlArgs(url, part, headers, {}, options, { schannel: true, revoke: false })).not.toContain('--ssl-revoke-best-effort');
  expect(curlArgs(url, part, headers, {}, options, { schannel: false })).not.toContain('--ssl-revoke-best-effort');
  writeFileSync(part, 'x'.repeat(64));
  const resumed = curlArgs(url, part, headers, { validator: '"abc"', total: 1024 }, options, { schannel: true });
  expect(resumed).toEqual(expect.arrayContaining(['--continue-at', '64', '--header', 'If-Range: "abc"']));
  expect(resumed.at(-2)).toBe('--url'); expect(resumed.at(-1)).toBe(url);
});
