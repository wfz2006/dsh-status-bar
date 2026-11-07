import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const electron = vi.hoisted(() => ({
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((items: unknown[]) => ({ items, popup: vi.fn() })) },
  nativeTheme: { themeSource: 'system' },
  systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: false }) },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  app: { relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })) },
  shell: { openPath: vi.fn(async () => '') },
}));
vi.mock('electron', () => electron);
vi.mock('../apps/desktop/src/main/presentation', () => ({ createPresentation: (win: { setBounds: (b: unknown) => void }) => {let material='clear';return ({
  state: () => ({ material, morphing: null }), setMaterial: vi.fn((value:string)=>{material=value;}), applyShape: vi.fn(), stop: vi.fn(), setOrb: vi.fn(), setEdgeSurface: vi.fn(),
  morphTo: (bounds: unknown) => win.setBounds(bounds),
});} }));
import { createWindowController } from '../apps/desktop/src/main/window-controller';
import { createDshLauncher, dshExecutableCandidates } from '../apps/desktop/src/main/dsh-launcher';

const controllers: ReturnType<typeof createWindowController>[] = [];
const directories: string[] = [];
afterEach(() => {
  controllers.splice(0).forEach(controller => controller.stop()); vi.clearAllMocks(); vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) { if (!directory.startsWith(join(tmpdir(), 'dsh-launcher-test-'))) throw new Error('Unexpected cleanup target'); rmSync(directory, { recursive: true, force: true }); }
});
function setup() {
  let bounds = { x: 100, y: 100, width: 288, height: 44 }; let pinned = false;
  const win = {
    isVisible: vi.fn(() => true), isMinimized: vi.fn(() => false),
    isDestroyed: () => false, getBounds: () => ({ ...bounds }), setBounds: vi.fn((b: typeof bounds) => { bounds = b; }),
    isAlwaysOnTop: () => pinned, setAlwaysOnTop: vi.fn((value: boolean) => { pinned = value; }),
    setMenuBarVisibility: vi.fn(), setMinimumSize: vi.fn(), on: vi.fn(), show: vi.fn(), hide: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn(), reload: vi.fn() },
  };
  const suspendOptics = vi.fn();
  const ui = createWindowController(win as unknown as Parameters<typeof createWindowController>[0], '', true, {
    position: async (x, y) => { bounds = { ...bounds, x, y }; }, suspendOptics, reconnect: vi.fn(), mock: vi.fn(), openDSH: vi.fn(), canOpenDSH: false, quit: vi.fn(), menuChanged: vi.fn(),
  });
  controllers.push(ui); return { ui, win, suspendOptics };
}
describe('capsule edge motion', () => {
  it.each([
    ['left', 15, 180, 'x', 0], ['right', 1920, 180, 'x', 1920],
    ['top', 340, 12, 'y', 0], ['bottom', 340, 1080, 'y', 1080],
  ] as const)('gathers and spreads at the %s edge with a fixed host and live optics', async (edge, x, y, axis, limit) => {
    vi.useFakeTimers();
    try {
      const { ui, win, suspendOptics } = setup();
      await ui.move(x, y, true);
      const gather = ui.state().edgeMotion!;
      expect(gather).toMatchObject({ direction: 'gather' });
      expect(ui.state().dockEdge).toBe(edge);
      const farSide = edge === 'right' || edge === 'bottom';
      const dimension = axis === 'x' ? 'width' : 'height';
      const host = win.getBounds();
      for (const local of [gather.capsule, gather.orb]) {
        expect(host[axis] + local[axis] + (farSide ? local[dimension] : 0)).toBe(limit);
      }
      win.setBounds.mockClear();
      vi.advanceTimersByTime(gather.duration - 1);
      expect(win.setBounds).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(win.getBounds()).toMatchObject({ width: 64, height: 64 });
      expect(suspendOptics).toHaveBeenLastCalledWith(false);
      const spread = ui.request('restore-capsule').edgeMotion!;
      expect(spread).toMatchObject({ direction: 'spread', capsule: gather.capsule, orb: gather.orb });
      expect(win.getBounds()).toEqual(host);
      vi.advanceTimersByTime(spread.duration);
      expect(ui.state()).toMatchObject({ dockEdge: undefined, edgeMotion: undefined });
      expect(win.getBounds()).toEqual({ ...gather.capsule, x: host.x + gather.capsule.x, y: host.y + gather.capsule.y });
    } finally { vi.useRealTimers(); }
  });

  it('restores immediately on reduced motion and cancels pending geometry on a mode change', async () => {
    vi.useFakeTimers();
    try {
      const { ui, win } = setup();
      ui.setSettings({ animation: 'reduced' });
      await ui.move(0, 180, true);
      expect(ui.state()).toMatchObject({ dockEdge: 'left', edgeMotion: undefined });
      ui.setSettings({ animation: 'full' });
      expect(ui.request('restore-capsule', true)).toMatchObject({ dockEdge: undefined, edgeMotion: undefined });
      await ui.move(0, 180, true);
      expect(ui.state().edgeMotion?.direction).toBe('gather');
      ui.request('settings');
      const settingsBounds = win.getBounds();
      vi.runAllTimers();
      expect(ui.state()).toMatchObject({ panel: 'settings', dockEdge: undefined, edgeMotion: undefined });
      expect(win.getBounds()).toEqual(settingsBounds);
    } finally { vi.useRealTimers(); }
  });
});
describe('window controller request policy', () => {
  it('keeps the original menu forms independent of the whale pool choice', () => {
    const {ui,win}=setup();ui.setSettings({appearance:'whale-pool'});
    const classic=ui.menu().items.find(item=>item.id==='view-capsule');
    classic?.click?.(classic,win as never,{} as never);
    expect(ui.state()).toMatchObject({viewMode:'capsule',settings:{appearance:'classic'}});
    const pool=ui.menu().items.find(item=>item.id==='view-whale-pool');expect(pool).toBeDefined();
    pool?.click?.(pool,win as never,{} as never);
    expect(ui.state()).toMatchObject({viewMode:'capsule',settings:{appearance:'whale-pool'}});
  });
  it('restores the configured material during automatic approval and preserves pool resize modes', () => {
    const {ui,win}=setup();ui.setSettings({appearance:'whale-pool',material:'solid',autoApproval:true});
    expect(ui.state().material).toBe('clear');
    ui.observe({pending:['approval:a'],completed:null},true);
    expect(ui.state()).toMatchObject({viewMode:'approval',material:'solid'});
    ui.observe({pending:[],completed:null},true);
    expect(ui.state()).toMatchObject({viewMode:'capsule',material:'clear'});
    ui.resize({...win.getBounds(),width:221});expect(ui.state().viewMode).toBe('capsule');
    ui.request('expand',true);ui.resize({...win.getBounds(),width:441});
    expect(ui.state()).toMatchObject({viewMode:'peek',material:'clear'});
    ui.resize({...win.getBounds(),width:500,height:440});expect(ui.state()).toMatchObject({viewMode:'expanded',material:'solid'});
    ui.resize({...win.getBounds(),width:180,height:44});
    expect(win.getBounds().height).toBeGreaterThanOrEqual(140);
  });
  it('publishes native visibility on hide/show and minimize/restore', () => {
    const { ui, win } = setup();
    for (const [event, visible, minimized] of [['hide', false, false], ['show', true, false], ['minimize', true, true], ['restore', true, false]] as const) {
      win.isVisible.mockReturnValue(visible); win.isMinimized.mockReturnValue(minimized);
      const listener = win.on.mock.calls.find(call => call[0] === event)?.[1];
      expect(listener).toBeTypeOf('function');
      (listener as () => void)();
      expect(ui.state().visible).toBe(visible && !minimized);
      expect(win.webContents.send).toHaveBeenLastCalledWith('glass:window-update', expect.objectContaining({ visible: visible && !minimized }));
    }
  });
  it('honours disabled auto expansion and still pins a notification', () => {
    const { ui, win } = setup(); ui.setSettings({ autoApproval: false, pin: 'on-notification' });
    ui.observe({ pending: ['approval:a'], completed: null }, true);
    expect(ui.state().viewMode).toBe('capsule'); expect(win.isAlwaysOnTop()).toBe(true);
    ui.observe({ pending: [], completed: null }, true); expect(win.isAlwaysOnTop()).toBe(false);
  });
  it('preserves manual geometry and the user mode when auto expansion is enabled', () => {
    const { ui, win } = setup(); ui.setSettings({ autoApproval: true, pin: 'on-notification' });
    const custom = { x: 100, y: 100, width: 425, height: 385 }; ui.resize(custom);
    ui.observe({ pending: ['question:q'], completed: null }, true);
    expect(ui.state()).toMatchObject({ viewMode: 'expanded', manualSize: true, pinned: true });
    expect(win.getBounds()).toEqual(custom);
    ui.observe({ pending: [], completed: null }, true); expect(win.getBounds()).toEqual(custom);
  });
  it('returns to the original automatic view only after every request settles', () => {
    const { ui, win } = setup(); ui.setSettings({ autoApproval: true, pin: 'on-notification' });
    ui.request('expand', true);
    ui.observe({ pending: ['a'], completed: null }, true); expect(ui.state().viewMode).toBe('approval');
    expect(win.isAlwaysOnTop()).toBe(true);
    ui.observe({ pending: ['q'], completed: null }, true); expect(ui.state().viewMode).toBe('approval');
    ui.observe({ pending: [], completed: null }, true); expect(ui.state().viewMode).toBe('peek');
    expect(win.isAlwaysOnTop()).toBe(false);
  });
  it('reloads the renderer while retaining the authenticated main-process connection', () => {
    const { ui, win } = setup(); const item = ui.menu().items.find(item => item.id === 'reload');
    if (!item) throw new Error('Reload action missing'); item.click?.(item, win as never, {} as never);
    expect(win.webContents.reload).toHaveBeenCalledOnce(); expect(electron.app.relaunch).not.toHaveBeenCalled();
  });
});
it('opens a discovered or user-selected DSH executable without an author-specific drive', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-launcher-test-')); directories.push(directory);
  const executable = join(directory, 'DeepSeek Harness.exe'); writeFileSync(executable, 'test-only, never executed');
  vi.stubEnv('DSH_DESKTOP_EXECUTABLE', executable); const { win } = setup();
  await createDshLauncher(win as unknown as Parameters<typeof createDshLauncher>[0], directory)();
  expect(electron.shell.openPath).toHaveBeenCalledWith(executable); expect(electron.dialog.showOpenDialog).not.toHaveBeenCalled();
  expect(dshExecutableCandidates({ DSH_DESKTOP_EXECUTABLE: 'relative.exe' })).toEqual([]);
  vi.stubEnv('DSH_DESKTOP_EXECUTABLE', ''); vi.stubEnv('LOCALAPPDATA', join(directory, 'missing')); vi.stubEnv('ProgramFiles', join(directory, 'missing')); vi.stubEnv('ProgramFiles(x86)', join(directory, 'missing'));
  electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [executable] });
  const open = createDshLauncher(win as unknown as Parameters<typeof createDshLauncher>[0], directory);
  await open(); expect(electron.dialog.showOpenDialog).toHaveBeenCalledOnce();
  expect(JSON.parse(readFileSync(join(directory, 'dsh-desktop.json'), 'utf8'))).toEqual({ executable });
  await createDshLauncher(win as unknown as Parameters<typeof createDshLauncher>[0], directory)();
  expect(electron.dialog.showOpenDialog).toHaveBeenCalledOnce();
});
