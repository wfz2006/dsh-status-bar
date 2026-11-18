import { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } from 'electron';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createBridge } from '@glass/bridge';
import { createMockAdapter, mockSnapshot, mockWelcome, type MockScenario } from '@glass/mock';
import { createDshAdapter, parseHostLink, type DshPublication } from '@glass/dsh';
import { frameSchema, initialProjection, reduceProjection, type Frame, type LocalEvent } from '@glass/protocol';
import { clampBounds, type Bounds } from '../shared/window';
import { dshInstanceFromArgs, dshLinkFromArgs, launcherPidFromArgs } from '../shared/launch';
import { deriveTask } from '../shared/view-model';
import { poolEvent } from '../shared/pool-events';
import type { DesktopProjection, HistoryPagination, MockAction, RequestKind, SubmissionResult, WindowAction, SourceState } from '../shared/api';
import { assertApprovalResponse, assertQuestionResponse, identityOf, type RequestIdentity } from './request-gate';
import { createWindowController } from './window-controller';
import { createDesktopOptics } from './desktop-optics';
import {createWindowPositioner} from './window-positioner';
import { createDshLauncher } from './dsh-launcher';
import { ProjectionPublisher } from '../shared/projection-channel';

const here = dirname(fileURLToPath(import.meta.url));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const rendererFile = join(here, '../renderer/index.html');
const devURL = process.env.ELECTRON_RENDERER_URL;
const smoke = process.env.GLASS_SMOKE === '1';
const customDataDirectory = process.env.GLASS_USER_DATA_DIR;
if (customDataDirectory && isAbsolute(customDataDirectory)) {
  mkdirSync(customDataDirectory, { recursive: true }); app.setPath('userData', customDataDirectory);
}
let win: BrowserWindow;
let ui: ReturnType<typeof createWindowController> | undefined;
let optics:ReturnType<typeof createDesktopOptics> | undefined;
let positioner:ReturnType<typeof createWindowPositioner>|undefined;
let quitting = false;
let state = initialProjection();
let selected = 'demo-main';
let bridge: Awaited<ReturnType<typeof createBridge>> | undefined;
let adapter: ReturnType<typeof createMockAdapter> | undefined;
let socket: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
let reconnectEnabled = true;
let lastReceived = 0;
let dsh: ReturnType<typeof createDshAdapter> | undefined;
let source: SourceState = { mode: smoke ? 'mock' : 'dsh', connection: 'disconnected', endpoint: null, error: null };
let sourceGeneration = 0;
let sourceLauncher: number | undefined;
let launcherWatch: ReturnType<typeof setInterval> | undefined;
let history: HistoryPagination | undefined;
// Only a random, process-local scope crosses IPC. An authentication link never does.
let draftHost: { fingerprint: string; plugin?: string; scope: string } | undefined;
let sessionBeforeReconnect: string | undefined;
let cueSequence = 0;
let lastPoolEvent: DesktopProjection['poolEvent'];
const responses = new Set<string>();
const submissions = new Map<string, SubmissionResult>();
// Coalesce projection pushes: the adapter can publish several frames for one
// adapter turn (status, transcript, approval) and the renderer only needs the
// newest projection per animation frame.
let pendingState: DesktopProjection | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
const projectionPublisher = new ProjectionPublisher();
let projectedState: typeof state | undefined;
let desktopState: DesktopProjection | undefined;
function desktopProjection(): DesktopProjection {
  if (!desktopState || state !== projectedState || selected !== desktopState.selectedSession || history !== desktopState.history ||
      draftHost?.scope !== desktopState.draftScope || lastPoolEvent !== desktopState.poolEvent) {
    projectedState = state;
    desktopState = { ...state, selectedSession: selected, history, draftScope: draftHost?.scope, poolEvent: lastPoolEvent };
  }
  return desktopState;
}
function queueProjection() {
  pendingState = desktopProjection();
  stateTimer ??= setTimeout(flushState, 16);
}
function flushState() {
  stateTimer = undefined;
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  const next = pendingState; pendingState = undefined;
  const message = next && projectionPublisher.next(next);
  if (message) win.webContents.send('glass:update', message);
}

function sourceName() { return source.mode === 'mock' ? '数据源：Mock 演示 · 非真实会话' : `数据源：DeepSeek Harness · ${source.connection === 'connected' ? '已连接' : source.connection === 'connecting' ? '连接中' : '未连接'}`; }
function publishSource() {
  // Quit tears the window down while transport close events are still draining; never publish
  // into destroyed UI from those late callbacks.
  if (quitting) return;
  if (win && !win.isDestroyed()) {
    win.webContents.send('glass:source-update', source);
    win.setTitle('DSH Glass · ' + (source.mode === 'mock' ? 'Mock 开发预览' : 'DeepSeek Harness'));
  }
  ui?.publish();
}
function resetSource(mode: SourceState['mode']) {
  if (mode === 'mock') { draftHost = undefined; sessionBeforeReconnect = undefined; }
  else if (draftHost && selected && Object.hasOwn(state.sessions, selected)) sessionBeforeReconnect = selected;
  sourceGeneration++; reconnectEnabled = false; clearTimeout(retry);
  socket?.terminate(); socket = undefined; adapter?.stop(); adapter = undefined;
  dsh?.stop(); dsh = undefined; responses.clear();
  sourceLauncher = undefined; history = undefined;
  source = { mode, connection: 'disconnected', endpoint: null, error: null };
  state = initialProjection(); update({ kind: 'transport.closed' }); publishSource();
}
async function connectDSH(value: unknown, launcher?: number, instance?: string) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('请输入有效的 DSH 本机认证链接。');
  const link = parseHostLink(value);
  const endpoint = link.origin;
  const fingerprint = createHash('sha256').update(JSON.stringify([endpoint, link.searchParams.get('token')])).digest('hex');
  const plugin = launcher && instance ? JSON.stringify([endpoint, launcher, instance]) : undefined;
  const previous = draftHost && (draftHost.fingerprint === fingerprint || !!plugin && draftHost.plugin === plugin) ? draftHost : undefined;
  resetSource('dsh'); const generation = sourceGeneration;
  draftHost = { fingerprint, scope: previous?.scope ?? randomUUID(), plugin: plugin ?? previous?.plugin };
  if (!previous) sessionBeforeReconnect = undefined;
  sourceLauncher = launcher;
  source = { ...source, connection: 'connecting', endpoint }; publishSource();
  dsh = createDshAdapter({
    publish: (frame, origin) => { if (generation === sourceGeneration) update(frame, origin); },
    selectedSession: () => selected,
    onHistory: pagination => {
      if (generation !== sourceGeneration || history?.hasOlder === pagination.hasOlder && history.canReturn === pagination.canReturn) return;
      history = pagination; queueProjection();
    },
    onConnection: connection => {
      if (generation !== sourceGeneration) return;
      source = { ...source, connection: connection === 'connected' ? 'connected' : connection === 'connecting' ? 'connecting' : 'disconnected', error: connection === 'disconnected' ? '连接已断开，请重新粘贴官方连接链接。' : null };
      if (connection !== 'connected') update({ kind: connection === 'connecting' ? 'transport.connecting' : 'transport.closed' });
      publishSource();
    },
  });
  try { await dsh.connect(value); }
  catch {
    if (generation === sourceGeneration) {
      dsh?.disconnect(); source = { ...source, connection: 'disconnected', error: '未能连接 DSH，请检查官方连接链接和本机服务。' };
      update({ kind: 'transport.closed' }); publishSource();
    }
    throw new Error('DSH 连接失败，请检查官方连接链接和本机服务');
  }
}
async function useMock() {
  resetSource('mock'); const generation = sourceGeneration;
  // The bridge answers hello/requests on timers that can fire while this function is still awaiting
  // createBridge (or after a later source switch cleared the adapter). Never dereference a stale or
  // missing adapter here: fall back to the static demo frames instead of crashing the main process.
  if (!bridge) bridge = await createBridge({
    welcome: () => adapter?.welcome() ?? mockWelcome(),
    snapshot: () => adapter?.snapshot() ?? mockSnapshot(),
  });
  if (generation !== sourceGeneration) return;
  adapter = makeAdapter('normal'); adapter.start(); reconnectEnabled = true; connect(); publishSource();
}

function refreshFacts(notifyCompletion = false) {
  if (state.connection === 'connected' && !state.stale && sessionBeforeReconnect) {
    if (Object.hasOwn(state.sessions, sessionBeforeReconnect)) selected = sessionBeforeReconnect;
    sessionBeforeReconnect = undefined;
  }
  if (!Object.hasOwn(state.sessions, selected)) selected = Object.keys(state.sessions)[0] ?? '';
  const task = deriveTask(state, selected);
  if (quitting) return;
  ui?.observe({
    pending: [...task.pending.map(a => ['approval', a.runtimeId, a.sourceEpoch, a.sessionId, a.requestId].join('/')),
      ...task.questions.map(q => ['question', q.runtimeId, q.sourceEpoch, q.sessionId, q.requestId].join('/'))],
    completed: task.status === 'completed' ? [state.runtimeId, state.epoch, selected].join('/') : null,
    holdApproval: submissions.size > 0,
    notifyCompletion,
  }, state.connection === 'connected' && !state.stale);
}
function update(event: Frame | LocalEvent, origin?: DshPublication) {
  const previous = state;
  state = reduceProjection(state, event);
  const cue = origin === 'history' ? undefined : poolEvent(previous, state, event, selected,
    source.mode === 'dsh' ? origin === 'live-completion' : undefined);
  const visible = !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  if (cue && visible) lastPoolEvent = { id: ++cueSequence, kind: cue, sessionId: selected };
  else if (!visible || state.stale || event.kind === 'glass.snapshot') lastPoolEvent = undefined;
  if (source.mode === 'mock') {
    const connection = state.connection === 'connected' ? 'connected' : state.connection === 'connecting' || state.connection === 'reconnecting' ? 'connecting' : 'disconnected';
    if (source.connection !== connection) { source = { ...source, connection }; publishSource(); }
  }
  refreshFacts(cue === 'completed' && visible);
  queueProjection();
}
function selectSession(id: string) {
  if (id !== selected) lastPoolEvent = undefined;
  selected = id;
  refreshFacts();
  queueProjection();
}

async function submitResponse(kind: RequestKind, identity: RequestIdentity, send: (active: NonNullable<typeof dsh>) => Promise<void>, decision?: SubmissionResult['decision']) {
  const active = dsh;
  const key = JSON.stringify([kind, identity]);
  if (!active || source.mode !== 'dsh' || responses.has(key)) throw new Error('请求已失效或正在提交');
  responses.add(key);
  const id = randomUUID();
  const result: SubmissionResult = { id, kind, identity, decision, sessionTitle: state.sessions[identity.sessionId]?.title || identity.sessionId, status: 'submitting' };
  submissions.set(id, result);
  ui?.publish();
  try {
    await send(active);
    submissions.set(id, { ...result, status: 'confirmed' });
  } catch {
    submissions.set(id, { ...result, status: 'unconfirmed' });
    throw new Error('DSH 未确认，请在 DSH 中核实。');
  } finally {
    responses.delete(key);
    const finished = [...submissions.values()].filter(item => item.status !== 'submitting');
    for (const old of finished.slice(0, Math.max(0, finished.length - 10))) submissions.delete(old.id);
    refreshFacts();
    ui?.publish();
  }
}
function connect() {
  if (!bridge || quitting || source.mode !== 'mock') return;
  clearTimeout(retry);
  const previous = socket; socket = undefined; previous?.terminate();
  update({ kind: 'transport.connecting' });
  const ws = new WebSocket(bridge.url, { headers: { Authorization: 'Bearer ' + bridge.token } });
  socket = ws; lastReceived = Date.now();
  ws.on('open', () => ws.send(JSON.stringify({ kind: 'glass.hello', protocolVersion: 1, clientNonce: randomUUID() })));
  ws.on('message', raw => {
    if (socket !== ws) return;
    let value: unknown;
    try { value = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid frame'); return; }
    const parsed = frameSchema.safeParse(value);
    if (!parsed.success) { reconnectEnabled = false; update({ kind: 'transport.incompatible' }); ws.close(); return; }
    lastReceived = Date.now(); update(parsed.data);
    if (parsed.data.kind === 'glass.welcome') ws.send(JSON.stringify({ kind: 'glass.snapshot.request', reason: 'initial' }));
  });
  ws.on('error', () => {});
  ws.on('close', () => {
    if (socket !== ws) return;
    socket = undefined;
    if (state.connection !== 'incompatible') update({ kind: 'transport.closed' });
    if (reconnectEnabled && !quitting) retry = setTimeout(connect, 1500);
  });
}
function position(): Bounds {
  const area = screen.getPrimaryDisplay().workArea;
  // Rest in the lower-right quadrant so the taller peek/expanded forms still
  // have room and the capsule no longer sits against the top edge.
  const restingY = Math.max(area.y + 96, area.y + area.height - 420);
  let initial = { x: area.x + area.width - 350, y: restingY, width: 300, height: 56 };
  let legacyTop = false;
  if (!smoke) try {
    const old: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'window.json'), 'utf8'));
    if (old && typeof old === 'object' && 'x' in old && 'y' in old && typeof old.x === 'number' && typeof old.y === 'number' && Number.isFinite(old.x) && Number.isFinite(old.y)) {
      initial = { ...initial, x: old.x, y: old.y };
      legacyTop = old.y < area.y + 160;
    }
  } catch { /* Only legacy geometry is read, no conversation/config. */ }
  const marker = join(app.getPath('userData'), 'window-placement.json');
  // One-time migration for windows parked in the old top band. The marker is
  // written on first run, so a later deliberate top placement is respected.
  if (legacyTop && !existsSync(marker)) initial = { ...initial, y: restingY };
  if (!smoke) try { if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ version: 2 })); } catch { /* Optional. */ }
  return clampBounds(initial, screen.getDisplayMatching(initial).workArea);
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  const actual = event.senderFrame?.url ?? '';
  const validURL = devURL ? actual.startsWith(new URL(devURL).origin + '/') : actual === pathToFileURL(rendererFile).href;
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !validURL) throw new Error('Untrusted IPC sender');
}
function makeAdapter(scenario: MockScenario) { return createMockAdapter(f => bridge?.publish(f), () => bridge?.disconnect(), scenario); }
function mockAction(action: unknown) {
  if (source.mode !== 'mock') throw new Error('请先在设置中切换到演示模式');
  if (action === 'disconnect') { reconnectEnabled = false; socket?.close(); update({ kind: 'transport.closed' }); }
  else if (action === 'reconnect') { reconnectEnabled = true; connect(); }
  else if (action === 'restart' || action === 'out-of-order' || action === 'approval-queue' || action === 'edge-cases' || action === 'completed' || action === 'long-approval') {
    adapter?.stop(); adapter = makeAdapter(action === 'restart' ? 'normal' : action);
    adapter.start(); reconnectEnabled = true; connect();
  } else throw new Error('Unsupported Mock action');
}
function finiteRecord(value: unknown, keys: string[]): value is Record<string, number> {
  return typeof value === 'object' && value !== null && keys.every(k => Object.hasOwn(value, k) && typeof (value as Record<string, unknown>)[k] === 'number' && Number.isFinite((value as Record<string, number>)[k]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  const owningLauncher = launcherPidFromArgs(process.argv);
  let watchedLauncher = owningLauncher;
  let hasStatusBarCommand = !!watchedLauncher && process.argv.includes('--status-bar-command');
  let loaded = false;
  let queuedHandoff: string[] | undefined;
  function watchLauncher(pid: number | undefined) {
    watchedLauncher = pid;
    if (!pid) { if (launcherWatch) clearInterval(launcherWatch); launcherWatch = undefined; return; }
    if (launcherWatch) return;
    launcherWatch = setInterval(() => {
      if (!watchedLauncher) return;
      try { process.kill(watchedLauncher, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') app.quit(); }
    }, 3000);
    launcherWatch.unref?.();
  }
  // Quit with the DSH host that spawned this window; a later focus wake-up can
  // re-target the watched pid through the second-instance hand-off.
  watchLauncher(watchedLauncher);
  function handoff(argv: string[]): boolean {
    if (!loaded) { queuedHandoff = argv; return false; }
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    const link = dshLinkFromArgs(argv);
    if (!link) return false;
    let origin: string;
    try { origin = parseHostLink(link).origin; } catch { return false; }
    const launcher = launcherPidFromArgs(argv);
    if (launcher) {
      watchLauncher(launcher);
      // A second instance cannot make its plugin responsible for cleaning up
      // a primary process it did not start.
      hasStatusBarCommand = launcher === owningLauncher && argv.includes('--status-bar-command');
      ui?.publish();
    }
    // The existing authenticated channel remains usable for the same launcher
    // and origin even when the wake-up includes a fresh one-use token.
    if (!(launcher && launcher === sourceLauncher && origin === source.endpoint && dsh?.isConnected())) {
      void connectDSH(link, launcher, dshInstanceFromArgs(argv)).catch(() => { /* connectDSH already published the failure state */ });
    }
    return true;
  }
  app.on('second-instance', (_event, argv) => handoff(argv));
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.dsh-glass.preview');
    win = new BrowserWindow({ ...position(), minWidth: 180, minHeight: 44, maxWidth: 900, maxHeight: 1000,
      frame: false, thickFrame: false, hasShadow: false, roundedCorners: false, transparent: true,
      resizable: true, show: false, skipTaskbar: true, backgroundColor: '#00000000', title: 'DSH Glass · 悬浮伴侣',
      webPreferences: { preload: join(here, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    positioner=createWindowPositioner(win,join(here,'../../native/RegionCapture.exe'));
    let recoveryShortcut: string | undefined;
    ui = createWindowController(win, app.getPath('userData'), smoke, {
      position:(x,y)=>positioner!.move(x,y),
      sourceName,
      reconnect: () => ui?.showConnection(),
      recovery: () => [...(recoveryShortcut ? [recoveryShortcut] : []), ...(hasStatusBarCommand ? ['DSH 的 /status-bar'] : [])],
      submissions: () => [...submissions.values()].reverse(),
      mock: action => { if (source.mode === 'mock') mockAction(action); else void useMock().then(() => mockAction(action)); }, quit: () => app.quit(),
      canOpenDSH: true, openDSH: createDshLauncher(win, app.getPath('userData')),
      menuChanged: () => {},
      suspendOptics:suspended=>optics?.setSuspended(suspended),
    });
    optics=createDesktopOptics(win,join(here,'../../native/RegionCapture.exe'));
    optics.setSuspended(ui.state().settings.appearance==='whale-pool'&&ui.state().panel===null);
    win.webContents.on('did-finish-load',()=>optics?.refresh());
    win.on('show', () => {
      lastPoolEvent = undefined;
      clearTimeout(stateTimer); stateTimer = undefined; pendingState = undefined;
      win.webContents.send('glass:update', projectionPublisher.snapshot(desktopProjection()));
    });
    const opticsBinary = join(here, '../../native/RegionCapture.exe');
    const opticsOverride = process.argv.includes('--desktop-optics');
    function syncOptics(force = false) {
      const settings = ui!.state().settings;
      const supportedMaterial = settings.material !== 'solid' && settings.material !== 'acrylic';
      const enabled = supportedMaterial && (settings.desktopOptics ?? (opticsOverride || !smoke && existsSync(opticsBinary)));
      if (force || optics!.state().enabled !== enabled) return optics!.enable(enabled);
      return optics!.state();
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('close', event => { if (!quitting) { event.preventDefault(); ui?.request('hide'); } });
    win.once('ready-to-show', () => {
      win.show();
      if (opticsOverride) {
        ui!.setSettings({material:'transparent'});ui!.request('collapse',true);ui!.request('expand',true);
      }
      syncOptics();
    });
    ipcMain.handle('glass:state', event => { assertSender(event); return projectionPublisher.snapshot(desktopProjection()); });
    ipcMain.handle('glass:source-state', event => { assertSender(event); return source; });
    ipcMain.handle('glass:dsh-connect', (event, value: unknown) => { assertSender(event); return connectDSH(value); });
    ipcMain.handle('glass:dsh-disconnect', event => { assertSender(event); resetSource('dsh'); });
    ipcMain.handle('glass:use-mock', event => { assertSender(event); return useMock(); });
    ipcMain.handle('glass:approval-response', async (event, identity: unknown, outcome: unknown) => {
      assertSender(event); const checked = assertApprovalResponse(state, identity, outcome);
      return submitResponse('approval', checked.identity, active => active.respondApproval(checked.identity, checked.outcome), checked.outcome);
    });
    ipcMain.handle('glass:question-response', async (event, identity: unknown, answers: unknown) => {
      assertSender(event); const checked = assertQuestionResponse(state, identity, answers);
      return submitResponse('question', checked.identity, active => active.respondQuestion(checked.identity, checked.answers));
    });
    ipcMain.handle('glass:dismiss-submission', (event, id: unknown) => {
      assertSender(event);
      if (typeof id === 'string' && submissions.get(id)?.status !== 'submitting' && submissions.delete(id)) {
        refreshFacts();
        ui?.publish();
      }
    });
    ipcMain.handle('glass:optics-state',event=>{assertSender(event);return optics!.state();});
    ipcMain.handle('glass:optics-refresh',event=>{assertSender(event);optics!.refresh();});
    ipcMain.handle('glass:optics-enable',(event,value:unknown)=>{
      assertSender(event);if(typeof value!=='boolean')throw new Error('Invalid optics setting');
      ui!.setSettings(value && ui!.state().settings.material==='solid' ? {desktopOptics: value, material:'transparent'} : {desktopOptics: value});
      return syncOptics(true);
    });
    ipcMain.handle('glass:window-state', event => { assertSender(event); return ui!.state(); });
    ipcMain.handle('glass:window', (event, action: unknown, reduced: unknown) => {
      assertSender(event);
      if (typeof action !== 'string' || reduced !== undefined && typeof reduced !== 'boolean') throw new Error('Invalid window action');
      return ui!.request(action as WindowAction, reduced === true);
    });
    ipcMain.handle('glass:settings', (event, value: unknown) => {
      assertSender(event);
      const previous = ui!.state().settings;
      const next = ui!.setSettings(value);
      // Tint/theme changes need a fresh tone evaluation even when every
      // sampled desktop pixel is unchanged. Coalesce into the next capture.
      optics!.refresh();
      if (next.settings.material !== previous.material || next.settings.desktopOptics !== previous.desktopOptics) syncOptics();
      return next;
    });
    ipcMain.handle('glass:resize', (event, value: unknown) => {
      assertSender(event);
      if (!finiteRecord(value, ['x', 'y', 'width', 'height'])) throw new Error('Invalid bounds');
      ui!.resize({ x: Math.round(value.x!), y: Math.round(value.y!), width: Math.min(900, Math.round(value.width!)), height: Math.min(1000, Math.round(value.height!)) });
    });
    ipcMain.handle('glass:move', (event, value: unknown, released: unknown) => {
      assertSender(event); if (!finiteRecord(value, ['x', 'y'])) throw new Error('Invalid position');
      if (released !== undefined && typeof released !== 'boolean') throw new Error('Invalid drag state');
      return ui!.move(Math.round(value.x!), Math.round(value.y!), released === true);
    });
    ipcMain.handle('glass:select-session', (event, id: unknown, previous?: unknown) => {
      assertSender(event); if (typeof id !== 'string' || !Object.hasOwn(state.sessions, id)) throw new Error('Unknown Session');
      if (previous !== undefined && (state.stale || state.connection !== 'connected' || !previous || typeof previous !== 'object' ||
        !('runtimeId' in previous) || previous.runtimeId !== state.runtimeId || !('epoch' in previous) || previous.epoch !== state.epoch ||
        !('sessionId' in previous) || previous.sessionId !== selected)) throw new Error('原会话已不可用');
      selectSession(id);
    });
    ipcMain.handle('glass:load-history', (event, direction: unknown) => {
      assertSender(event);
      if (!dsh || source.connection !== 'connected' || (direction !== 'older' && direction !== 'recent')) throw new Error('无法读取历史会话');
      return dsh.loadHistory(direction);
    });
    ipcMain.handle('glass:open-request', (event, kind: unknown, value: unknown, reduced: unknown) => {
      assertSender(event);
      const identity = identityOf(value);
      const task = deriveTask(state, identity.sessionId);
      const queue = kind === 'approval' ? task.pending : kind === 'question' ? task.questions : [];
      if (task.status === 'disconnected' || !queue.some(request =>
        request.requestId === identity.requestId && request.runtimeId === identity.runtimeId && request.sourceEpoch === identity.sourceEpoch)) throw new Error('请求已结束');
      selectSession(identity.sessionId);
      clearTimeout(stateTimer); flushState();
      return ui!.request('approval', reduced === true);
    });
    ipcMain.handle('glass:copy-approval', (event, value: unknown) => {
      assertSender(event);
      if (!value || typeof value !== 'object' || !('sessionId' in value && 'requestId' in value)) throw new Error('Invalid request identity');
      const a = state.approvals.find(a => a.sessionId === value.sessionId && a.requestId === value.requestId && a.runtimeId === state.runtimeId && a.sourceEpoch === state.epoch);
      if (!a?.commandPreview) throw new Error('Preview unavailable');
      clipboard.writeText(a.commandPreview);
    });
    ipcMain.handle('glass:mock', (event, action: MockAction) => { assertSender(event); mockAction(action); });
    if (smoke) await useMock();
    else { update({ kind: 'transport.closed' }); publishSource(); }
    watchdog = setInterval(() => { if (socket && Date.now() - lastReceived > 9000) { update({ kind: 'transport.closed' }); socket.terminate(); } }, 1000);
    const toggleVisibility = () => { if (win.isVisible() && !win.isMinimized()) ui?.request('hide'); else { win.restore(); win.show(); win.focus(); } };
    for (const [accelerator, label] of [['CommandOrControl+Shift+G', 'Ctrl+Shift+G'], ['CommandOrControl+Shift+F12', 'Ctrl+Shift+F12']] as const) {
      try {
        if (globalShortcut.register(accelerator, toggleVisibility)) { recoveryShortcut = label; break; }
      } catch { /* The platform may reject an accelerator. */ }
    }
    ui.publish();
    screen.on('display-removed', () => ui?.displayChanged(screen.getPrimaryDisplay().workArea));
    screen.on('display-metrics-changed', () => ui?.displayChanged());
    if (devURL) await win.loadURL(devURL); else await win.loadFile(rendererFile);
    const startupLink = dshLinkFromArgs(process.argv);
    // The DSH bundle hands over the authenticated host link on launch. Connect once the
    // renderer exists; failures land in the normal source state instead of a dialog.
    loaded = true;
    const handled = queuedHandoff && handoff(queuedHandoff);
    queuedHandoff = undefined;
    if (!handled && startupLink && !smoke) void connectDSH(startupLink, owningLauncher, dshInstanceFromArgs(process.argv)).catch(() => { /* connectDSH published the failure state */ });
  }).catch(error => { console.error('[glass] Startup failed: ' + (error instanceof Error ? error.message : 'unknown')); app.quit(); });
}
app.on('before-quit', () => {
  quitting = true; reconnectEnabled = false; clearTimeout(retry); clearInterval(watchdog); clearInterval(launcherWatch); ui?.stop();
  optics?.stop();
  positioner?.stop();
  sourceGeneration++; dsh?.stop(); adapter?.stop(); socket?.terminate(); void bridge?.close(); globalShortcut.unregisterAll();
});
