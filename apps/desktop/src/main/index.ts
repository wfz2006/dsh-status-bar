import { app, BrowserWindow, ipcMain, Tray, nativeImage, screen, globalShortcut, shell, clipboard } from 'electron';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createBridge } from '@glass/bridge';
import { createMockAdapter, type MockScenario } from '@glass/mock';
import { frameSchema, initialProjection, reduceProjection, type Frame, type LocalEvent } from '@glass/protocol';
import { clampBounds, type Bounds } from '../shared/window';
import { deriveTask } from '../shared/view-model';
import type { MockAction, WindowAction } from '../shared/api';
import { createWindowController } from './window-controller';

const here = dirname(fileURLToPath(import.meta.url));
const rendererFile = join(here, '../renderer/index.html');
const devURL = process.env.ELECTRON_RENDERER_URL;
const smoke = process.env.GLASS_SMOKE === '1';
const customDataDirectory = process.env.GLASS_USER_DATA_DIR;
if (customDataDirectory && isAbsolute(customDataDirectory)) {
  mkdirSync(customDataDirectory, { recursive: true }); app.setPath('userData', customDataDirectory);
}
const originalDSH = 'D:/DSH/DeepSeek Harness.exe';
let win: BrowserWindow;
let tray: Tray | undefined;
let ui: ReturnType<typeof createWindowController> | undefined;
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

function refreshFacts() {
  if (!Object.hasOwn(state.sessions, selected)) selected = Object.keys(state.sessions)[0] ?? '';
  const task = deriveTask(state, selected);
  ui?.observe({
    pending: task.pending.map(a => [a.runtimeId, a.sourceEpoch, a.sessionId, a.requestId].join('/')),
    completed: task.status === 'completed' ? [state.runtimeId, state.epoch, selected].join('/') : null,
  }, state.connection === 'connected' && !state.stale);
}
function update(event: Frame | LocalEvent) {
  state = reduceProjection(state, event);
  if (win && !win.isDestroyed()) win.webContents.send('glass:update', state);
  refreshFacts();
}
function connect() {
  if (!bridge || quitting) return;
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
  let initial = { x: area.x + area.width - 350, y: area.y + 80, width: 300, height: 56 };
  if (!smoke) try {
    const old: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'window.json'), 'utf8'));
    if (old && typeof old === 'object' && 'x' in old && 'y' in old && typeof old.x === 'number' && typeof old.y === 'number' && Number.isFinite(old.x) && Number.isFinite(old.y)) initial = { ...initial, x: old.x, y: old.y };
  } catch { /* Only legacy geometry is read, no conversation/config. */ }
  return clampBounds(initial, screen.getDisplayMatching(initial).workArea);
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  const actual = event.senderFrame?.url ?? '';
  const validURL = devURL ? actual.startsWith(new URL(devURL).origin + '/') : actual === pathToFileURL(rendererFile).href;
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !validURL) throw new Error('Untrusted IPC sender');
}
function makeAdapter(scenario: MockScenario) { return createMockAdapter(f => bridge?.publish(f), () => bridge?.disconnect(), scenario); }
function mockAction(action: unknown) {
  if (action === 'disconnect') { reconnectEnabled = false; socket?.close(); update({ kind: 'transport.closed' }); }
  else if (action === 'reconnect') { reconnectEnabled = true; connect(); }
  else if (action === 'restart' || action === 'out-of-order' || action === 'approval-queue' || action === 'edge-cases' || action === 'completed') {
    adapter?.stop(); adapter = makeAdapter(action === 'restart' ? 'normal' : action);
    adapter.start(); reconnectEnabled = true; connect();
  } else throw new Error('Unsupported Mock action');
}
function finiteRecord(value: unknown, keys: string[]): value is Record<string, number> {
  return typeof value === 'object' && value !== null && keys.every(k => Object.hasOwn(value, k) && typeof (value as Record<string, unknown>)[k] === 'number' && Number.isFinite((value as Record<string, number>)[k]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.dsh-glass.preview');
    win = new BrowserWindow({ ...position(), minWidth: 180, minHeight: 50, maxWidth: 900, maxHeight: 1000,
      frame: false, thickFrame: false, hasShadow: false, roundedCorners: false, transparent: true,
      resizable: true, show: false, backgroundColor: '#00000000', title: 'DSH Glass · Mock 开发预览',
      webPreferences: { preload: join(here, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    ui = createWindowController(win, app.getPath('userData'), smoke, {
      reconnect: () => mockAction('reconnect'), mock: action => mockAction(action), quit: () => app.quit(),
      canOpenDSH: existsSync(originalDSH), openDSH: () => { void shell.openPath(originalDSH); },
      menuChanged: menu => tray?.setContextMenu(menu),
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.on('ready-to-show', () => win.show());
    ipcMain.handle('glass:state', event => { assertSender(event); return state; });
    ipcMain.handle('glass:window-state', event => { assertSender(event); return ui!.state(); });
    ipcMain.handle('glass:window', (event, action: unknown, reduced: unknown) => {
      assertSender(event);
      if (typeof action !== 'string' || reduced !== undefined && typeof reduced !== 'boolean') throw new Error('Invalid window action');
      return ui!.request(action as WindowAction, reduced === true);
    });
    ipcMain.handle('glass:settings', (event, value: unknown) => { assertSender(event); return ui!.setSettings(value); });
    ipcMain.handle('glass:resize', (event, value: unknown) => {
      assertSender(event);
      if (!finiteRecord(value, ['x', 'y', 'width', 'height'])) throw new Error('Invalid bounds');
      ui!.resize({ x: Math.round(value.x!), y: Math.round(value.y!), width: Math.min(900, Math.round(value.width!)), height: Math.min(1000, Math.round(value.height!)) });
    });
    ipcMain.handle('glass:move', (event, value: unknown) => {
      assertSender(event); if (!finiteRecord(value, ['x', 'y'])) throw new Error('Invalid position');
      ui!.move(Math.round(value.x!), Math.round(value.y!));
    });
    ipcMain.handle('glass:select-session', (event, id: unknown) => {
      assertSender(event); if (typeof id !== 'string' || !Object.hasOwn(state.sessions, id)) throw new Error('Unknown Session');
      selected = id; refreshFacts();
    });
    ipcMain.handle('glass:copy-approval', (event, value: unknown) => {
      assertSender(event);
      if (!value || typeof value !== 'object' || !('sessionId' in value && 'requestId' in value)) throw new Error('Invalid request identity');
      const a = state.approvals.find(a => a.sessionId === value.sessionId && a.requestId === value.requestId && a.runtimeId === state.runtimeId && a.sourceEpoch === state.epoch);
      if (!a?.commandPreview) throw new Error('Preview unavailable');
      clipboard.writeText(a.commandPreview);
    });
    ipcMain.handle('glass:mock', (event, action: MockAction) => { assertSender(event); mockAction(action); });
    adapter = makeAdapter('normal');
    bridge = await createBridge({ welcome: () => adapter!.welcome(), snapshot: () => adapter!.snapshot() });
    adapter.start(); connect();
    watchdog = setInterval(() => { if (socket && Date.now() - lastReceived > 9000) { update({ kind: 'transport.closed' }); socket.terminate(); } }, 1000);
    tray = new Tray(nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVQ4T2Nk+P+/HgMlgImBQjBqAAMAAGmDH/FHQwHAAAAAAElFTkSuQmCC'));
    tray.setToolTip('DSH Glass · Mock 演示 · 未连接真实 DSH'); tray.setContextMenu(ui.menu());
    tray.on('double-click', () => win.show());
    globalShortcut.register('CommandOrControl+Shift+G', () => win.isVisible() ? win.hide() : win.show());
    screen.on('display-removed', () => win.setBounds(clampBounds(win.getBounds(), screen.getPrimaryDisplay().workArea)));
    screen.on('display-metrics-changed', () => win.setBounds(clampBounds(win.getBounds(), screen.getDisplayMatching(win.getBounds()).workArea)));
    if (devURL) await win.loadURL(devURL); else await win.loadFile(rendererFile);
  }).catch(error => { console.error('[glass] Startup failed: ' + (error instanceof Error ? error.message : 'unknown')); app.quit(); });
}
app.on('before-quit', () => {
  quitting = true; reconnectEnabled = false; clearTimeout(retry); clearInterval(watchdog); ui?.stop();
  adapter?.stop(); socket?.terminate(); void bridge?.close(); globalShortcut.unregisterAll(); tray?.destroy();
});
