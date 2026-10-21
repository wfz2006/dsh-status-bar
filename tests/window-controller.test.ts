import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const electron = vi.hoisted(() => ({
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((items: unknown[]) => ({ items, popup: vi.fn() })) },
  nativeTheme: { themeSource: 'system' },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  app: { relaunch: vi.fn(), exit: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })) },
  shell: { openPath: vi.fn(async () => '') },
}));
vi.mock('electron', () => electron);
vi.mock('../apps/desktop/src/main/presentation', () => ({ createPresentation: (win: { setBounds: (b: unknown) => void }) => ({
  state: () => ({ material: 'clear', morphing: null }), setMaterial: vi.fn(), applyShape: vi.fn(), stop: vi.fn(),
  morphTo: (bounds: unknown) => win.setBounds(bounds),
}) }));
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
    isDestroyed: () => false, getBounds: () => ({ ...bounds }), setBounds: vi.fn((b: typeof bounds) => { bounds = b; }),
    isAlwaysOnTop: () => pinned, setAlwaysOnTop: vi.fn((value: boolean) => { pinned = value; }),
    setMenuBarVisibility: vi.fn(), on: vi.fn(), show: vi.fn(), hide: vi.fn(),
    webContents: { send: vi.fn(), on: vi.fn(), reload: vi.fn() },
  };
  const ui = createWindowController(win as unknown as Parameters<typeof createWindowController>[0], '', true, {
    position: async () => {}, reconnect: vi.fn(), mock: vi.fn(), openDSH: vi.fn(), canOpenDSH: false, quit: vi.fn(), menuChanged: vi.fn(),
  });
  controllers.push(ui); return { ui, win };
}
describe('window controller request policy', () => {
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
