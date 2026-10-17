import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, globalShortcut } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { createBridge } from '@glass/bridge';
import { createMockAdapter, type MockScenario } from '@glass/mock';
import { frameSchema, initialProjection, reduceProjection, type Frame, type LocalEvent } from '@glass/protocol';
import { clampBounds, type Bounds } from '../shared/window';

const here = dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow;
let tray: Tray | undefined;
let quitting = false;
let state = initialProjection();
let bridge: Awaited<ReturnType<typeof createBridge>> | undefined;
let adapter: ReturnType<typeof createMockAdapter> | undefined;
let socket: WebSocket | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectEnabled = true;
let lastReceived = 0;
let largeSize = { width: 420, height: 560 };
let lastExpanded: Bounds | undefined;
let opaque = true;
const rendererFile = join(here, '../renderer/index.html');
const devURL = process.env.ELECTRON_RENDERER_URL;
const smoke = process.env.GLASS_SMOKE === '1';

function update(event: Frame | LocalEvent) {
  state = reduceProjection(state, event);
  if (win && !win.isDestroyed()) win.webContents.send('glass:update', state);
}
function connect() {
  if (!bridge || quitting) return;
  clearTimeout(retry);
  const previous = socket; socket = undefined; previous?.terminate();
  update({ kind: 'transport.connecting' });
  const ws = new WebSocket(bridge.url, { headers: { Authorization: `Bearer ${bridge.token}` } });
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
  ws.on('error', () => { /* Surface connection state, never raw transport secrets. */ });
  ws.on('close', () => {
    if (socket !== ws) return;
    socket = undefined;
    if (state.connection !== 'incompatible') update({ kind: 'transport.closed' });
    if (reconnectEnabled && !quitting) retry = setTimeout(connect, 1500);
  });
}
function savedBounds(): Bounds {
  const area = screen.getPrimaryDisplay().workArea;
  const fallback = { x: area.x + area.width - 240, y: area.y + 80, width: 180, height: 54 };
  if (smoke) return fallback;
  try {
    const value: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'window.json'), 'utf8'));
    if (typeof value === 'object' && value !== null && 'x' in value && 'y' in value && 'width' in value && 'height' in value &&
      [value.x, value.y, value.width, value.height].every(v => typeof v === 'number' && Number.isFinite(v))) {
      const bounds = value as Bounds;
      return clampBounds(bounds, screen.getDisplayMatching(bounds).workArea);
    }
  } catch { /* Missing/invalid geometry falls back to visible coordinates. */ }
  return fallback;
}
function saveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (win.isDestroyed() || smoke) return;
    const bounds = win.getBounds();
    if (bounds.width >= 340 && bounds.height >= 250) { largeSize = { width: bounds.width, height: bounds.height }; lastExpanded = bounds; }
    try { writeFileSync(join(app.getPath('userData'), 'window.json'), JSON.stringify(bounds)); } catch { /* Geometry persistence is optional. */ }
  }, 200);
}
function expand() {
  const current = win.getBounds();
  win.setBounds(clampBounds({ ...current, ...largeSize }, screen.getDisplayMatching(current).workArea));
}
function collapse() {
  const current = win.getBounds();
  if (current.width >= 340 && current.height >= 250) { largeSize = { width: current.width, height: current.height }; lastExpanded = current; }
  win.setBounds({ x: lastExpanded?.x ?? current.x, y: lastExpanded?.y ?? current.y, width: 180, height: 54 });
}
function setMaterial() {
  // Opaque fallback is default; native acrylic is opt-in until wallpaper acceptance.
  try { win.setBackgroundMaterial(opaque ? 'none' : 'acrylic'); } catch { opaque = true; }
  win.setBackgroundColor(opaque ? '#151d2c' : '#00000000');
}
function refreshTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 DSH Glass', click: () => win.show() },
    { label: '展开工作台', click: () => { expand(); win.show(); } },
    { label: '置顶', type: 'checkbox', checked: win.isAlwaysOnTop(), click: item => win.setAlwaysOnTop(item.checked) },
    { type: 'separator' }, { label: '退出 Glass', click: () => app.quit() },
  ]));
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  const allowed = devURL ? new URL(devURL).origin : new URL(`file://${rendererFile.replaceAll('\\', '/')}`).href;
  const actual = frame?.url ?? '';
  const validURL = devURL ? actual.startsWith(`${allowed}/`) : actual === allowed;
  if (!win || event.sender !== win.webContents || frame !== win.webContents.mainFrame || !validURL) throw new Error('Untrusted IPC sender');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    app.setAppUserModelId('local.dsh-glass.preview');
    win = new BrowserWindow({ ...savedBounds(), minWidth: 180, minHeight: 54, maxWidth: 900, maxHeight: 1000,
      frame: false, resizable: true, show: false, backgroundColor: '#151d2c', title: 'DSH Glass · Mock 开发预览',
      webPreferences: { preload: join(here, '../preload/index.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('resize', saveBounds); win.on('move', saveBounds);
    win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); } });
    win.on('ready-to-show', () => win.show());
    ipcMain.handle('glass:state', event => { assertSender(event); return state; });
    ipcMain.handle('glass:window-state', event => { assertSender(event); return { pinned: win.isAlwaysOnTop() }; });
    win.on('always-on-top-changed', () => {
      win.webContents.send('glass:window-update', { pinned: win.isAlwaysOnTop() });
      refreshTrayMenu();
    });
    ipcMain.handle('glass:window', (event, action: unknown) => {
      assertSender(event);
      switch (action) {
        case 'expand': expand(); break;
        case 'collapse': collapse(); break;
        case 'hide': win.hide(); break;
        case 'quit': app.quit(); break;
        case 'pin': win.setAlwaysOnTop(!win.isAlwaysOnTop()); break;
        case 'material': opaque = !opaque; setMaterial(); break;
        default: throw new Error('Unsupported window action');
      }
      return { pinned: !win.isDestroyed() && win.isAlwaysOnTop() };
    });
    ipcMain.handle('glass:mock', (event, action: unknown) => {
      assertSender(event);
      if (action === 'disconnect') { reconnectEnabled = false; socket?.close(); update({ kind: 'transport.closed' }); }
      else if (action === 'reconnect') { reconnectEnabled = true; connect(); }
      else if (action === 'restart' || action === 'out-of-order') {
        adapter?.stop();
        adapter = makeAdapter(action === 'restart' ? 'normal' : 'out-of-order');
        adapter.start(); reconnectEnabled = true; connect();
      } else throw new Error('Unsupported Mock action');
    });
    function makeAdapter(scenario: MockScenario) {
      return createMockAdapter(f => bridge?.publish(f), () => bridge?.disconnect(), scenario);
    }
    adapter = makeAdapter('normal');
    bridge = await createBridge({ welcome: () => adapter!.welcome(), snapshot: () => adapter!.snapshot() });
    adapter.start(); connect();
    watchdog = setInterval(() => { if (socket && Date.now() - lastReceived > 9000) { update({ kind: 'transport.closed' }); socket.terminate(); } }, 1000);
    const icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVQ4T2Nk+P+/HgMlgImBQjBqAAMAAGmDH/FHQwHAAAAAAElFTkSuQmCC');
    tray = new Tray(icon);
    tray.setToolTip('DSH Glass · Mock 开发预览');
    refreshTrayMenu();
    tray.on('double-click', () => win.show());
    globalShortcut.register('CommandOrControl+Shift+G', () => win.isVisible() ? win.hide() : win.show());
    screen.on('display-removed', () => win.setBounds(clampBounds(win.getBounds(), screen.getPrimaryDisplay().workArea)));
    screen.on('display-metrics-changed', () => win.setBounds(clampBounds(win.getBounds(), screen.getDisplayMatching(win.getBounds()).workArea)));
    if (devURL) await win.loadURL(devURL); else await win.loadFile(rendererFile);
  }).catch(() => { console.error('[glass] Startup failed; see local setup guide.'); app.quit(); });
}
app.on('before-quit', () => {
  quitting = true; reconnectEnabled = false;
  clearTimeout(retry); clearTimeout(saveTimer); clearInterval(watchdog);
  adapter?.stop(); socket?.terminate(); void bridge?.close();
  globalShortcut.unregisterAll(); tray?.destroy();
});
