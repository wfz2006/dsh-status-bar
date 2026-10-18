// Real end-to-end probe: official local DSH host (isolated DSH_HOME + observe-only fixture patch)
// <-> built Electron app, driving the same settings field a user would paste into.
// Never prints the authentication token or the host link with its token.
import { _electron as electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
process.chdir(repo);
const exe = process.env.DSH_EXE ?? 'D:\\DSH\\DeepSeek Harness.exe';
const cli = process.env.DSH_CLI ?? 'D:\\DSH\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
const home = resolve('.local-dsh-probe');
const redact = value => String(value).replace(/token=[A-Za-z0-9_-]+/g, 'token=<redacted>');
const log = (...args) => console.log(...args);
const result = { steps: [] };
const version = spawnSync(exe, ['--expose-internals', cli, '--version'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' });
result.dshVersion = (version.stdout || '').split(/\r?\n/).find(line => line.trim())?.trim() ?? null;
const step = (name, value) => { result.steps.push({ name, ...value }); log('✓', name, JSON.stringify(value)); };

let host; let app;
try {
  // 1. Boot the official bundled host against an isolated DSH home with an observe-only fixture plugin.
  host = spawn(exe, ['--expose-internals', cli, '--profile', 'web', '--patch', resolve('packages/adapters/dsh/probe/cordis.patch.yml'), '--no-open', '--port', '0'], {
    cwd: repo, env: { ...process.env, DSH_HOME: home, GLASS_PROBE_FIXTURE: '1', ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
  });
  let hostText = '';
  host.stdout.on('data', data => { hostText += data.toString(); });
  host.stderr.on('data', data => { hostText += data.toString(); });
  const link = await new Promise((accept, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const found = hostText.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)/);
      if (found) { clearInterval(timer); accept(found[1]); }
      else if (Date.now() - started > 30000) { clearInterval(timer); reject(new Error('host link timeout: ' + redact(hostText.slice(-600)))); }
    }, 150);
  });
  const origin = new URL(link).origin;
  result.hostOrigin = origin;
  step('host-up', { origin, dshVersion: result.dshVersion });
  await new Promise(accept => {
    const timer = setInterval(() => { if (hostText.includes('fixture appended')) { clearInterval(timer); accept(); } }, 100);
    setTimeout(() => { clearInterval(timer); accept(); }, 6000);
  });
  step('fixture-created', { marker: hostText.includes('fixture appended') });

  // 2. Verify the dedicated answer-capable operator contract used by Glass.
  const operatorUrl = new URL('/connect', origin);
  operatorUrl.searchParams.set('token', new URL(link).searchParams.get('token'));
  operatorUrl.searchParams.set('interactions', 'answer');
  const auth = await fetch(operatorUrl, { redirect: 'manual' });
  const setCookie = typeof auth.headers.getSetCookie === 'function' ? auth.headers.getSetCookie() : [];
  const location = auth.headers.get('location');
  const cookie = setCookie.map(value => value.split(';')[0]).join('; ');
  const rpc = await fetch(new URL('/api/session/list', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin },
    body: JSON.stringify({ type: 'client-request', rpcId: 'live-probe-1', method: 'session/list', payload: { args: { _request: {} } } }),
  });
  const rpcBody = await rpc.json().catch(() => null);
  const items = rpcBody?.result?.value?.items;
  step('operator-auth-contract', {
    status: auth.status, locationPath: location ? new URL(location, origin).pathname : null, cookieCount: setCookie.length,
    rpcStatus: rpc.status, rpcType: rpcBody?.type ?? null, rpcOk: rpcBody?.result?.ok ?? null,
    sessions: Array.isArray(items) ? items.map(item => ({ running: item.running, agentAvailable: item.agentAvailable,
      projectionKind: item.projections?.kind, asOfSeq: item.projections?.asOfSeq, projectionKeys: Object.keys(item.projections?.values ?? {}) })) : [],
  });
  // Inspect the real multiplexer's per-stream contract without logging session content.
  const activeSession = Array.isArray(items) ? items.find(item => item?.agentAvailable === true) : undefined;
  const ws = new WebSocket(new URL('/api/remote.mux', origin).toString().replace(/^http/, 'ws'), { headers: { cookie, origin } });
  const streamEvents = [];
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => accept(), 1800);
    ws.once('error', reject);
    ws.on('open', () => {
      for (const [streamId, endpoint] of [['control', 'session/control'], ['gateway', '$events'], ['workspace', 'workspace/follow']])
        ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: {} } }));
      if (activeSession) ws.send(JSON.stringify({
        type: 'open', streamId: 'audit-probe', endpoint: 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId: activeSession.sessionId }, maxMessages: 80 } } },
      }));
    });
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      streamEvents.push({ streamId: message.streamId, type: message.type, valueType: message.value?.type, errorCode: message.error?.code });
    });
  }).finally(() => ws.close());
  step('operator-stream-probe', { activeSessionAvailable: Boolean(activeSession), events: streamEvents });

  // 3. Real Electron app connected through the real settings field.
  const profile = await mkdtemp(join(tmpdir(), 'glass-live-'));
  const appEnv = { ...process.env, GLASS_SMOKE: '1', GLASS_USER_DATA_DIR: profile };
  delete appEnv.ELECTRON_RUN_AS_NODE; // inherited from the DSH host shell; Electron must boot as an app
  app = await electron.launch({ executablePath: createRequire(resolve('apps/desktop/package.json'))('electron'), args: [resolve('apps/desktop')], env: appEnv });
  app.process().stderr.on('data', data => { const text = String(data).trim(); if (text) log('main stderr:', redact(text).slice(0, 400)); });
  const page = await app.firstWindow();
  await page.locator('main').waitFor({ timeout: 20000 });
  const startSource = await page.evaluate(() => window.glass.getSourceState());
  const startState = await page.evaluate(() => window.glass.getState());
  step('app-start', { mode: startSource.mode, connection: startSource.connection, sessions: Object.keys(startState.sessions).length });

  const mainId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  await app.evaluate(({ Menu, BrowserWindow }, { id, mainId }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error('missing menu ' + id);
    item.click(item, BrowserWindow.fromId(mainId), {});
  }, { id: 'settings', mainId });
  const input = page.locator('#dsh-authentication-url');
  await input.waitFor({ timeout: 10000 });
  await input.fill(link);
  await page.getByRole('button', { name: '连接 DSH' }).click();
  await page.waitForFunction(() => window.glass.getSourceState().then(source => source.mode === 'dsh' && source.connection === 'connected'), null, { timeout: 30000 }).catch(async () => {
    const failed = await page.evaluate(() => window.glass.getSourceState());
    throw new Error('connect did not reach connected: ' + JSON.stringify(failed));
  });
  const liveSource = await page.evaluate(() => window.glass.getSourceState());
  const liveState = await page.evaluate(() => window.glass.getState());
  const sessions = Object.values(liveState.sessions);
  const todos = sessions.flatMap(session => (session.todos ?? []).map(todo => todo.content + ':' + todo.status));
  const token = link.split('token=')[1];
  step('connected', {
    mode: liveSource.mode, connection: liveSource.connection, endpoint: liveSource.endpoint, error: liveSource.error,
    capabilities: liveState.capabilities,
    sessions: sessions.length,
    phases: sessions.map(session => session.phase + '/' + session.agentStatus),
    titles: sessions.map(session => session.title),
    todos,
    tokenLeakedIntoRenderer: JSON.stringify(liveState).includes(token),
  });
  await mkdir(resolve('docs/evidence/live-dsh'), { recursive: true });
  await page.screenshot({ path: resolve('docs/evidence/live-dsh/connected.png') });
  step('screenshot', { path: 'docs/evidence/live-dsh/connected.png' });

  // 4. Disconnect through the same settings panel.
  await page.getByRole('button', { name: '断开连接' }).click();
  await page.waitForFunction(() => window.glass.getSourceState().then(source => source.mode === 'dsh' && source.connection === 'disconnected'), null, { timeout: 12000 });
  const afterDisconnect = await page.evaluate(() => window.glass.getState());
  step('disconnected', { sessions: Object.keys(afterDisconnect.sessions).length, connection: afterDisconnect.connection });

  // 5. Wrong token must be rejected by the official host, not silently accepted.
  await input.fill(link.replace(/token=[^&]+/, 'token=wrong-token'));
  await page.getByRole('button', { name: '连接 DSH' }).click();
  await page.waitForFunction(() => window.glass.getSourceState().then(source => source.mode === 'dsh' && source.connection === 'disconnected' && Boolean(source.error)), null, { timeout: 20000 });
  const rejected = await page.evaluate(() => window.glass.getSourceState());
  step('wrong-token-rejected', { connection: rejected.connection, error: rejected.error });

  result.outcome = 'PASS';
} catch (error) {
  result.outcome = 'FAIL';
  result.error = redact(error instanceof Error ? error.stack ?? error.message : String(error));
  log('✗ probe failed:', result.error);
} finally {
  try { if (app) await app.close(); } catch { /* already closed */ }
  try { if (host) host.kill(); } catch { /* already gone */ }
  await writeFile(resolve('.local-dsh-probe/live-integration.json'), JSON.stringify(result, null, 2));
  await mkdir(resolve('docs/evidence/live-dsh'), { recursive: true });
  await writeFile(resolve('docs/evidence/live-dsh/result.json'), JSON.stringify(result, null, 2));
  log('---', result.outcome, '---');
  if (result.outcome !== 'PASS') process.exitCode = 1;
}
