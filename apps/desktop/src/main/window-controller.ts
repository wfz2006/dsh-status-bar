import { Menu, nativeTheme, screen, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPresentation } from './presentation';
import { clampBounds, type Bounds } from '../shared/window';
import { DEFAULT_SETTINGS, initialView, manualView, normalizeSettings, observeFacts, viewForSize, viewSize, type GlassViewMode, type AttentionFacts } from '../shared/view-model';
import type { WindowAction, WindowState, MockAction } from '../shared/api';

type Hooks = { sourceName?: () => string; position:(x:number,y:number)=>Promise<void>; reconnect: () => void; mock: (action: MockAction) => void; openDSH: () => void; canOpenDSH: boolean; quit: () => void; menuChanged: (menu: Menu) => void };
export function createWindowController(win: BrowserWindow, directory: string, smoke: boolean, hooks: Hooks) {
  const preferencePath = join(directory, 'glass-ui.json');
  let settings = { ...DEFAULT_SETTINGS };
  let remembered: { mode: GlassViewMode; bounds: Bounds; manual: boolean } | undefined;
  if (!smoke) try {
    const saved: unknown = JSON.parse(readFileSync(preferencePath, 'utf8'));
    if (saved && typeof saved === 'object' && 'settings' in saved) settings = normalizeSettings(saved.settings);
    if (saved && typeof saved === 'object' && 'mode' in saved && 'bounds' in saved && ['capsule', 'peek', 'expanded', 'approval'].includes(String(saved.mode))) {
      const b = saved.bounds;
      if (b && typeof b === 'object' && 'x' in b && 'y' in b && 'width' in b && 'height' in b && [b.x, b.y, b.width, b.height].every(v => typeof v === 'number' && Number.isFinite(v))) remembered = { mode: saved.mode as GlassViewMode, bounds: b as Bounds, manual: 'manual' in saved && saved.manual === true };
    }
  } catch { /* Invalid or absent local preferences use defaults. */ }
  let view = initialView(settings.defaultView === 'peek' ? 'peek' : settings.defaultView === 'remember-last' ? remembered?.mode ?? 'capsule' : 'capsule');
  if (settings.defaultView === 'remember-last' && remembered?.manual) view = manualView(view, remembered.mode);
  let sourceConnected = false;
  let panel: WindowState['panel'] = null;
  let panelReturn: { bounds: Bounds; manual: boolean; mode: GlassViewMode } | null = null;
  let completionFeedback = false;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
  const presentation = createPresentation(win, publish);
  function state(): WindowState {
    return { ...(presentation?.state() ?? { material: 'acrylic', morphing: null }), pinned: !win.isDestroyed() && win.isAlwaysOnTop(), viewMode: view.mode, manualSize: view.manual, panel, settings: { ...settings }, completionFeedback };
  }
  function persist() {
    if (smoke || win.isDestroyed() || panel || presentation?.state().morphing) return;
    try { writeFileSync(preferencePath, JSON.stringify({ version: 1, settings, mode: view.mode, manual: view.manual, bounds: win.getBounds() })); } catch { /* User preference failures do not affect observations. */ }
  }
  function saveSoon() { clearTimeout(persistenceTimer); persistenceTimer = setTimeout(persist, 180); }
  function publish() {
    if (win.isDestroyed()) return;
    win.webContents.send('glass:window-update', state());
    Menu.setApplicationMenu(menu());
    hooks.menuChanged(menu());
  }
  function safeBounds(bounds: Bounds) { return clampBounds(bounds, screen.getDisplayMatching(bounds).workArea); }
  function moveTo(bounds: Bounds, reduce = false, duration = 320) {
    presentation?.morphTo(safeBounds(bounds), reduce || settings.animation !== 'full', duration);
    saveSoon();
  }
  function showMode(mode: GlassViewMode, reduce = false) {
    panel = null; panelReturn = null;
    view = { ...view, mode, manual: false, returnMode: null };
    moveTo({ ...win.getBounds(), ...viewSize(mode) }, reduce, mode === 'capsule' ? 260 : 320); publish();
  }
  function showPanel(value: 'settings' | 'activity') {
    if (!panel) panelReturn = { bounds: win.getBounds(), manual: view.manual, mode: view.mode };
    panel = value; moveTo({ ...win.getBounds(), width: 390, height: value === 'settings' ? 510 : 360 }); publish();
  }
  function back() {
    if (panel && panelReturn) {
      const previous = panelReturn; panel = null; panelReturn = null;
      view = { ...view, mode: previous.mode, manual: previous.manual };
      moveTo(previous.bounds); publish();
    } else showMode('capsule');
  }
  function setSettings(patch: unknown) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
    settings = normalizeSettings({ ...settings, ...patch });
    nativeTheme.themeSource = settings.theme === 'auto' ? 'system' : settings.theme;
    presentation?.setMaterial(settings.material === 'solid' ? 'solid' : settings.material === 'acrylic' ? 'acrylic' : 'clear');
    win.setAlwaysOnTop(settings.pin === 'always' || settings.pin === 'on-notification' && sourceConnected && view.pending.length > 0);
    // Settings changes must be saved even while the settings panel is open.
    if (!smoke) try { writeFileSync(preferencePath, JSON.stringify({ version: 1, settings, mode: panelReturn?.mode ?? view.mode, manual: panelReturn?.manual ?? view.manual, bounds: panelReturn?.bounds ?? win.getBounds() })); } catch { /* Optional persistence. */ }
    publish(); return state();
  }
  function observe(facts: AttentionFacts, connected: boolean) {
    sourceConnected = connected;
    if (!connected) {
      clearTimeout(completionTimer); completionFeedback = false;
      if (settings.pin === 'on-notification') win.setAlwaysOnTop(false);
      publish(); return;
    }
    const old = view;
    view = observeFacts(view, facts, panel ? { ...settings, autoApproval: false } : settings);
    if (settings.pin === 'on-notification') win.setAlwaysOnTop(facts.pending.length > 0);
    if (view.mode !== old.mode && !panel) moveTo({ ...win.getBounds(), ...viewSize(view.mode) });
    if (facts.completed && facts.completed !== old.completed) {
      completionFeedback = true; clearTimeout(completionTimer); publish();
      completionTimer = setTimeout(() => {
        completionFeedback = false;
        if (sourceConnected && settings.autoCollapse && view.completed === facts.completed && !view.manual && !panel && !view.pending.length) showMode('capsule');
        publish();
      }, 1500);
    }
    if (view.mode !== old.mode) publish();
  }
  function menu() {
    const items: MenuItemConstructorOptions[] = [
      { label: hooks.sourceName?.() ?? '数据源：Mock 演示 · 真实 DSH 未接入', enabled: false, id: 'source-label' },
      { type: 'separator' },
      { label: '胶囊', id: 'view-capsule', click: () => showMode('capsule') },
      { label: '速览', id: 'view-peek', click: () => showMode('peek') },
      { label: '任务详情', id: 'view-expanded', click: () => showMode('expanded') },
      { label: '待处理请求', id: 'view-approval', click: () => showMode('approval') },
      { label: '最近活动', id: 'activity', click: () => showPanel('activity') },
      { label: '始终置顶', id: 'pin', type: 'checkbox', checked: win.isAlwaysOnTop(), click: item => setSettings({ pin: item.checked ? 'always' : 'normal' }) },
      { label: '设置', id: 'settings', click: () => showPanel('settings') },
      { label: '查看 DSH 原窗口', id: 'open-dsh', enabled: hooks.canOpenDSH, click: hooks.openDSH },
      { label: '重新连接', id: 'reconnect', click: hooks.reconnect },
      { label: 'Mock 调试', id: 'debug', submenu: [
        { label: '重播演示', id: 'mock-restart', click: () => hooks.mock('restart') },
        { label: '模拟断线', id: 'mock-disconnect', click: () => hooks.mock('disconnect') },
        { label: '模拟乱序', id: 'mock-out-of-order', click: () => hooks.mock('out-of-order') },
        { label: '并发审批演示', id: 'mock-approval-queue', click: () => hooks.mock('approval-queue') },
        { label: '长标题与空列表', id: 'mock-edge-cases', click: () => hooks.mock('edge-cases') },
        { label: '明确完成状态', id: 'mock-completed', click: () => hooks.mock('completed') },
        { label: '长命令只读预览', id: 'mock-long-approval', click: () => hooks.mock('long-approval') },
      ] },
      { type: 'separator' },
      { label: '显示窗口', id: 'show', click: () => win.show() },
      { label: '隐藏到托盘', id: 'hide', click: () => win.hide() },
      { label: '退出', id: 'quit', click: hooks.quit },
    ];
    return Menu.buildFromTemplate(items);
  }
  function request(action: WindowAction, reduce = false) {
    switch (action) {
      case 'expand': showMode(view.mode === 'capsule' ? 'peek' : 'expanded', reduce); break;
      case 'collapse': showMode('capsule', reduce); break;
      case 'approval': showMode('approval', reduce); break;
      case 'settings': showPanel('settings'); break;
      case 'activity': showPanel('activity'); break;
      case 'back': back(); break;
      case 'pin': setSettings({ pin: win.isAlwaysOnTop() ? 'normal' : 'always' }); break;
      case 'menu': menu().popup({ window: win }); break;
      case 'hide': win.hide(); break;
      case 'quit': hooks.quit(); break;
      case 'open-dsh': if (hooks.canOpenDSH) hooks.openDSH(); break;
      case 'reconnect': hooks.reconnect(); break;
      default: throw new Error('Unsupported window action');
    }
    return state();
  }
  nativeTheme.themeSource = settings.theme === 'auto' ? 'system' : settings.theme;
  const initial = settings.defaultView === 'remember-last' && remembered ? remembered.bounds : { ...win.getBounds(), ...viewSize(view.mode) };
  win.setBounds(safeBounds(initial)); presentation.applyShape();
  setSettings(settings);
  win.setMenuBarVisibility(false);
  win.webContents.on('context-menu', () => menu().popup({ window: win }));
  win.on('always-on-top-changed', publish);
  win.on('move', saveSoon); win.on('resize', saveSoon);
  win.on('closed', () => { clearTimeout(completionTimer); clearTimeout(persistenceTimer); });
  return { state, request, setSettings, observe, menu, publish,
    resize: (bounds: Bounds) => {
      presentation?.stop();
      const safe = safeBounds(panel ? { ...bounds, width: Math.max(320, bounds.width), height: Math.max(280, bounds.height) } : bounds);
      if (!panel) view = manualView(view, viewForSize(safe.width, safe.height, view.mode));
      win.setBounds(safe); publish(); saveSoon();
    },
    move: async (x: number, y: number) => { presentation?.stop(); const safe=safeBounds({ ...win.getBounds(),x,y });await hooks.position(safe.x,safe.y);saveSoon(); },
    stop: () => { persist(); presentation?.stop(); clearTimeout(completionTimer); clearTimeout(persistenceTimer); },
  };
}
