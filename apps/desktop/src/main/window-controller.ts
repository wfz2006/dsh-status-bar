import { Menu, nativeTheme, screen, systemPreferences, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPresentation } from './presentation';
import { clampBounds, type Bounds } from '../shared/window';
import { EDGE_ORB_SIZE, edgeAtBounds, edgeMotionLayout, edgeReplacementBounds, type EdgeMotion, type EdgeSide } from '../shared/edge-dock';
import { COMPLETION_FEEDBACK_MS, DEFAULT_SETTINGS, initialView, manualView, normalizeSettings, observeFacts, viewForAppearanceSize, appearanceViewSize, type GlassViewMode, type AttentionFacts } from '../shared/view-model';
import { WHALE_POOL_FEATURE, normalizeAnnouncements, acknowledgeFeature, shouldIntroduceWhalePool } from '../shared/feature-announcements';
import type { WindowAction, WindowState, MockAction, SubmissionResult } from '../shared/api';

type Hooks = { sourceName?: () => string; recovery?: () => string[]; submissions?: () => SubmissionResult[];
  suspendOptics?:(suspended:boolean)=>void; position:(x:number,y:number)=>Promise<void>; reconnect: () => void; mock: (action: MockAction) => void; openDSH: () => void; canOpenDSH: boolean; quit: () => void; menuChanged: (menu: Menu) => void };
const orbSize = { width: EDGE_ORB_SIZE, height: EDGE_ORB_SIZE };
export function createWindowController(win: BrowserWindow, directory: string, smoke: boolean, hooks: Hooks) {
  const preferencePath = join(directory, 'glass-ui.json');
  let settings = { ...DEFAULT_SETTINGS };
  let announcements: string[]=[];
  let remembered: { mode: GlassViewMode; bounds: Bounds; manual: boolean } | undefined;
  let savedVersion: number | undefined;
  if (!smoke) try {
    const saved: unknown = JSON.parse(readFileSync(preferencePath, 'utf8'));
    if(saved && typeof saved==='object' && 'announcements' in saved)announcements=normalizeAnnouncements(saved.announcements);
    if (saved && typeof saved === 'object' && 'version' in saved && typeof saved.version === 'number') savedVersion = saved.version;
    if (saved && typeof saved === 'object' && 'settings' in saved) settings = normalizeSettings(saved.settings);
    if (saved && typeof saved === 'object' && 'mode' in saved && 'bounds' in saved && ['capsule', 'peek', 'expanded', 'approval'].includes(String(saved.mode))) {
      const b = saved.bounds;
      if (b && typeof b === 'object' && 'x' in b && 'y' in b && 'width' in b && 'height' in b && [b.x, b.y, b.width, b.height].every(v => typeof v === 'number' && Number.isFinite(v))) remembered = { mode: saved.mode as GlassViewMode, bounds: b as Bounds, manual: 'manual' in saved && saved.manual === true };
    }
  } catch { /* Invalid or absent local preferences use defaults. */ }
  // Version 1 defaulted to a floating but ordinary window; adopt the newer
  // always-on-top default exactly once instead of silently keeping the old value.
  if (savedVersion === 1 && settings.pin === 'normal') settings = { ...settings, pin: 'always' };
  let view = initialView(settings.defaultView === 'peek' ? 'peek' : settings.defaultView === 'remember-last' ? remembered?.mode ?? 'capsule' : 'capsule');
  if (settings.defaultView === 'remember-last' && remembered?.manual) view = manualView(view, remembered.mode);
  let sourceConnected = false;
  let panel: WindowState['panel'] = null;
  let reconnectFocus = 0;
  let hideBlocked = false;
  let panelReturn: { bounds: Bounds; manual: boolean; mode: GlassViewMode } | null = null;
  let dock: { edge: EdgeSide; normal: Bounds } | undefined;
  let capsuleSize: Pick<Bounds, 'width' | 'height'> | undefined;
  let edgeMotion: EdgeMotion | undefined;
  let edgeTimer: ReturnType<typeof setTimeout> | undefined;
  let restoreAfterGather: boolean | undefined;
  let geometryRevision = 0;
  let completionFeedback = false;
  let completionTimer: ReturnType<typeof setTimeout> | undefined;
  let approvalReturn: GlassViewMode | undefined;
  let approvalSawRequest = false;
  let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
  const presentation = createPresentation(win, publish);
  const sizeFor=(mode:GlassViewMode,attention=false)=>appearanceViewSize(mode,attention,settings.appearance);
  // Windows rounds HWND edges outward when converting to whole DIPs. Reusing
  // that width on each restore would progressively enlarge the capsule.
  function rememberCapsuleSize(bounds: Bounds) {
    if (!panel && view.mode === 'capsule') capsuleSize = { width: bounds.width, height: bounds.height };
    return bounds;
  }
  function floatingBounds() {
    const bounds = win.getBounds();
    if (panel || dock || view.mode !== 'capsule' || !capsuleSize) return bounds;
    // At most one DIP per edge is a rounding fringe. Larger changes are real
    // native resizes, including sizes imposed by a new display work area.
    if (Math.abs(bounds.width - capsuleSize.width) > 2 || Math.abs(bounds.height - capsuleSize.height) > 2) return bounds;
    return { ...bounds, ...capsuleSize };
  }
  function writePreferences(){
    if(smoke||win.isDestroyed())return;
    try{writeFileSync(preferencePath,JSON.stringify({version:2,settings,announcements,mode:panelReturn?.mode??view.mode,manual:panelReturn?.manual??view.manual,bounds:panelReturn?.bounds??dock?.normal??floatingBounds()}));}catch{/* Preference failures must not block tasks. */}
  }
  function acknowledgeWhalePool(){announcements=acknowledgeFeature(announcements,WHALE_POOL_FEATURE);writePreferences();}
  function applyMaterial(){presentation?.setMaterial(settings.appearance==='whale-pool'&&!panel?'clear':settings.material==='solid'?'solid':settings.material==='acrylic'?'acrylic':settings.material==='frosted'?'frosted':'clear');}
  function state(): WindowState {
    const recovery = hooks.recovery?.() ?? [];
    return { ...presentation.state(), visible: !win.isDestroyed() && win.isVisible() && !win.isMinimized(), pinned: !win.isDestroyed() && win.isAlwaysOnTop(), viewMode: view.mode, manualSize: view.manual, panel, settings: { ...settings }, completionFeedback, dockEdge: dock?.edge, edgeMotion,
      submissions: hooks.submissions?.(), reconnectFocus, hideBlocked: hideBlocked && !recovery.length,
      recoveryHint: recovery.length ? `隐藏后可通过 ${recovery.join(' 或 ')} 恢复窗口。` : '当前没有可用的恢复入口，窗口将保持可见。' };
  }
  function persist() {
    if (smoke || win.isDestroyed() || panel || presentation?.state().morphing) return;
    writePreferences();
  }
  function saveSoon() { clearTimeout(persistenceTimer); persistenceTimer = setTimeout(persist, 180); }
  function publish() {
    if (win.isDestroyed()) return;
    hooks.suspendOptics?.(settings.appearance==='whale-pool'&&!panel);
    win.webContents.send('glass:window-update', state());
    const applicationMenu = menu();
    Menu.setApplicationMenu(applicationMenu);
    hooks.menuChanged(applicationMenu);
  }
  function safeBounds(bounds: Bounds) { return clampBounds(bounds, screen.getDisplayMatching(bounds).workArea); }
  function settleEdgeBounds(bounds: Bounds, orb: boolean) {
    const wasMoving = !!edgeMotion;
    clearTimeout(edgeTimer);
    edgeMotion = undefined;
    restoreAfterGather = undefined;
    presentation.setOrb(orb);
    win.setBounds(orb ? bounds : rememberCapsuleSize(bounds));
    if (wasMoving) presentation.setEdgeSurface(false);
    if (!orb) win.setMinimumSize(180, 44);
  }
  function restoreCapsule(area?: Bounds) {
    if (!dock) return false;
    const normal = dock.normal;
    dock = undefined;
    geometryRevision++;
    presentation.stop(false);
    settleEdgeBounds(area ? clampBounds(normal, area) : safeBounds(normal), false);
    return true;
  }
  function animateEdge(direction: EdgeMotion['direction'], capsule: Bounds, orb: Bounds, finish: () => void, reduce = false) {
    if (reduce || settings.animation !== 'full' || systemPreferences.getAnimationSettings().prefersReducedMotion) {
      finish();
      return;
    }
    const { host, ...endpoints } = edgeMotionLayout(capsule, orb);
    const duration = direction === 'gather' ? 380 : 560;
    win.setBounds(host);
    presentation.setEdgeSurface(true);
    edgeMotion = { ...endpoints, direction, duration, startedAt: Date.now() };
    edgeTimer = setTimeout(finish, duration);
    publish();
  }
  function spreadDock(capsule: Bounds, orb: Bounds, area: Bounds, reduce: boolean) {
    if (!dock) return;
    dock.normal = capsule;
    geometryRevision++;
    animateEdge('spread', capsule, orb, () => { restoreCapsule(area); publish(); saveSoon(); }, reduce);
  }
  function openDock(reduce: boolean, dropArea?: Bounds) {
    if (!dock || edgeMotion?.direction === 'spread') return;
    if (edgeMotion?.direction === 'gather') {
      restoreAfterGather = (restoreAfterGather ?? false) || reduce;
      return;
    }
    const orb = win.getBounds();
    const area = dropArea ?? screen.getDisplayMatching(orb).workArea;
    const capsule = edgeReplacementBounds(orb, dock.normal, area, dropArea ? null : dock.edge);
    spreadDock(capsule, orb, area, reduce);
  }
  function finishDrop(area: Bounds) {
    if (!settings.edgeDock || panel || view.mode !== 'capsule'
      || presentation.state().morphing || !win.isVisible() || win.isMinimized()) return;
    const bounds = floatingBounds();
    const edge = edgeAtBounds(bounds, area);
    if (dock) {
      if (!edge) { openDock(false, area); return; }
      dock.edge = edge;
      dock.normal = edgeReplacementBounds(bounds, dock.normal, area, edge);
      win.setBounds(edgeReplacementBounds(bounds, orbSize, area, edge));
      publish();
    } else if (edge) {
      const normal = edgeReplacementBounds(bounds, bounds, area, edge);
      const orb = edgeReplacementBounds(normal, orbSize, area, edge);
      dock = { edge, normal };
      geometryRevision++;
      win.setMinimumSize(EDGE_ORB_SIZE, 44);
      animateEdge('gather', normal, orb, () => {
        const restore = restoreAfterGather;
        restoreAfterGather = undefined;
        // Both animations share the same host rectangle. A queued click can
        // spread directly without a 64-DIP native resize between them.
        if (restore !== undefined) spreadDock(normal, orb, area, restore);
        else { settleEdgeBounds(orb, true); publish(); saveSoon(); }
      });
    }
  }
  function moveTo(bounds: Bounds, reduce = false, duration = 320) {
    geometryRevision++;
    presentation?.morphTo(rememberCapsuleSize(safeBounds(bounds)), reduce || settings.animation !== 'full', duration);
    saveSoon();
  }
  function showMode(mode: GlassViewMode, reduce = false) {
    restoreCapsule();
    hideBlocked = false;
    reconnectFocus = 0;
    if(panel==='whale-pool-intro')acknowledgeWhalePool();
    if (mode === 'approval' && view.mode !== 'approval') { approvalReturn = view.mode; approvalSawRequest = false; }
    else if (mode !== 'approval') { approvalReturn = undefined; approvalSawRequest = false; }
    panel = null; panelReturn = null;
    view = { ...view, mode, manual: false, returnMode: null };
    applyMaterial();moveTo({ ...win.getBounds(), ...sizeFor(mode, view.pending.length > 0) }, reduce, mode === 'capsule' ? 260 : 320); publish();
  }
  function showPanel(value: Exclude<WindowState['panel'],null>, focusConnection = false) {
    restoreCapsule();
    if (!panel) panelReturn = { bounds: floatingBounds(), manual: view.manual, mode: view.mode };
    hideBlocked = false;
    reconnectFocus = focusConnection ? reconnectFocus + 1 : 0;
    panel = value; applyMaterial();
    const size = value === 'settings' ? { width: 464, height: 568 } : { width: 390, height: 360 };
    moveTo({ ...win.getBounds(), ...size }); publish();
  }
  function back() {
    if(panel==='whale-pool-intro')acknowledgeWhalePool();
    if (panel && panelReturn) {
      const previous = panelReturn; panel = null; panelReturn = null;
      reconnectFocus = 0;
      view = { ...view, mode: previous.mode, manual: previous.manual };
      applyMaterial();moveTo(previous.bounds); publish();
    } else showMode('capsule');
  }
  function setSettings(patch: unknown) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings');
    const previousAppearance=settings.appearance;
    settings = normalizeSettings({ ...settings, ...patch });
    if (dock && (!settings.edgeDock || previousAppearance !== settings.appearance)) restoreCapsule();
    if(previousAppearance!==settings.appearance){
      if(panelReturn)panelReturn={...panelReturn,manual:false,bounds:{...panelReturn.bounds,...sizeFor(panelReturn.mode,view.pending.length>0)}};
      else{view={...view,manual:false};moveTo({...win.getBounds(),...sizeFor(view.mode,view.pending.length>0)});}
    }
    nativeTheme.themeSource = settings.theme === 'auto' ? 'system' : settings.theme;
    applyMaterial();
    win.setAlwaysOnTop(settings.pin === 'always' || settings.pin === 'on-notification' && sourceConnected && view.pending.length > 0);
    // Settings changes must be saved even while the settings panel is open.
    writePreferences();
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
    // observeFacts owns automatic transitions and respects both user settings
    // and manual sizing. Notification pinning must also run on return paths.
    if (settings.pin === 'on-notification' && win.isAlwaysOnTop() !== (facts.pending.length > 0)) win.setAlwaysOnTop(facts.pending.length > 0);
    // Once the request that pulled us into the approval sheet is resolved, go
    // back to the view the user came from instead of parking on an empty sheet.
    if (view.mode === 'approval') {
      if (facts.pending.length > 0) approvalSawRequest = true;
      else if (approvalSawRequest && !panel && !facts.holdApproval) {
        const target = approvalReturn ?? 'peek';
        approvalReturn = undefined; approvalSawRequest = false;
        showMode(target);
        return;
      }
    }
    if (view.mode !== old.mode && !panel) {
      restoreCapsule();applyMaterial();moveTo({ ...win.getBounds(), ...sizeFor(view.mode, view.pending.length > 0) });
    }
    const attentionChanged = (old.pending.length > 0) !== (view.pending.length > 0);
    if (view.mode === old.mode && view.mode === 'peek' && !view.manual && !panel && attentionChanged) {
      moveTo({ ...win.getBounds(), ...sizeFor('peek', view.pending.length > 0) });
    }
    if (facts.completed && facts.completed !== old.completed && facts.notifyCompletion !== false) {
      completionFeedback = true; clearTimeout(completionTimer); publish();
      completionTimer = setTimeout(() => {
        completionFeedback = false;
        if (sourceConnected && settings.autoCollapse && view.completed === facts.completed && !view.manual && !panel && !dock && !view.pending.length &&
          !(view.mode === 'approval' && hooks.submissions?.().length)) showMode('capsule');
        publish();
      }, COMPLETION_FEEDBACK_MS);
    }
    if (view.mode !== old.mode) publish();
  }
  function hide() {
    if (hooks.recovery?.().length) win.hide();
    else { hideBlocked = true; publish(); }
  }
  function menu() {
    const classicMode=(mode:GlassViewMode)=>{if(settings.appearance!=='classic')setSettings({appearance:'classic'});showMode(mode);};
    const recovery = hooks.recovery?.() ?? [];
    const items: MenuItemConstructorOptions[] = [
      { label: hooks.sourceName?.() ?? '数据源：Mock 演示 · 真实 DSH 未接入', enabled: false, id: 'source-label' },
      { type: 'separator' },
      { label: '原版胶囊', id: 'view-capsule', click: () => classicMode('capsule') },
      { label: '原版速览', id: 'view-peek', click: () => classicMode('peek') },
      { label: '任务详情', id: 'view-expanded', click: () => showMode('expanded') },
      { label: '待处理请求', id: 'view-approval', click: () => showMode('approval') },
      {label:'鲸鱼水池',id:'view-whale-pool',type:'checkbox',checked:settings.appearance==='whale-pool',click:()=>{acknowledgeWhalePool();setSettings({appearance:'whale-pool'});showMode('capsule');}},
      { label: '最近活动', id: 'activity', click: () => showPanel('activity') },
      { label: '始终置顶', id: 'pin', type: 'checkbox', checked: win.isAlwaysOnTop(), click: item => setSettings({ pin: item.checked ? 'always' : 'normal' }) },
      { label: '设置', id: 'settings', click: () => showPanel('settings') },
      { label: '查看 DSH 原窗口', id: 'open-dsh', enabled: hooks.canOpenDSH, click: hooks.openDSH },
      // Reload only the UI. Main retains its verified cookie and subscriptions;
      // relaunching argv would replay the launcher's single-use authentication.
      { label: '重新加载 Glass', id: 'reload', click: () => win.webContents.reload() },
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
      { label: recovery.length ? `隐藏窗口（通过 ${recovery.join(' 或 ')} 恢复）` : '无法隐藏窗口（无可用恢复入口）', id: 'hide', enabled: recovery.length > 0, click: hide },
      { label: '退出', id: 'quit', click: hooks.quit },
    ];
    return Menu.buildFromTemplate(items);
  }
  function request(action: WindowAction, reduce = false) {
    switch (action) {
      case 'expand': showMode(view.mode === 'capsule' ? 'peek' : 'expanded', reduce); break;
      case 'overview': showMode('peek', reduce); break;
      case 'details': showMode('expanded', reduce); break;
      case 'collapse': showMode('capsule', reduce); break;
      case 'restore-capsule': openDock(reduce); break;
      case 'approval': showMode('approval', reduce); break;
      case 'settings': showPanel('settings'); break;
      case 'other-requests': showPanel('other-requests'); break;
      case 'activity': showPanel('activity'); break;
      case 'back': back(); break;
      case 'pin': setSettings({ pin: win.isAlwaysOnTop() ? 'normal' : 'always' }); break;
      case 'menu': menu().popup({ window: win }); break;
      case 'hide': hide(); break;
      case 'quit': hooks.quit(); break;
      case 'open-dsh': if (hooks.canOpenDSH) hooks.openDSH(); break;
      case 'reconnect': hooks.reconnect(); break;
      case 'introduce-whale-pool': showPanel('whale-pool-intro'); break;
      case 'try-whale-pool': acknowledgeWhalePool();setSettings({appearance:'whale-pool'});showMode('capsule',reduce);break;
      case 'dismiss-whale-pool': acknowledgeWhalePool();back();break;
      default: throw new Error('Unsupported window action');
    }
    return state();
  }
  nativeTheme.themeSource = settings.theme === 'auto' ? 'system' : settings.theme;
  const position = remembered?.bounds ?? win.getBounds();
  const initial = settings.defaultView === 'remember-last' && remembered ? remembered.bounds : { ...position, ...sizeFor(view.mode, view.pending.length > 0) };
  win.setBounds(rememberCapsuleSize(safeBounds(initial))); presentation.applyShape();
  setSettings(settings);
  if(shouldIntroduceWhalePool(announcements,smoke))showPanel('whale-pool-intro');
  win.setMenuBarVisibility(false);
  win.webContents.on('context-menu', () => menu().popup({ window: win }));
  win.on('always-on-top-changed', publish);
  win.on('show', publish); win.on('hide', publish);
  win.on('minimize', publish); win.on('restore', publish);
  win.on('move', saveSoon); win.on('resize', saveSoon);
  win.on('closed', () => { clearTimeout(edgeTimer); clearTimeout(completionTimer); clearTimeout(persistenceTimer); });
  return { state, request, setSettings, observe, menu, publish, showConnection: () => showPanel('settings', true),
    resize: (bounds: Bounds) => {
      if (dock) return;
      geometryRevision++;
      presentation?.stop();
      const safe = safeBounds(panel ? { ...bounds, width: Math.max(320, bounds.width), height: Math.max(280, bounds.height) } : settings.appearance==='whale-pool'&&view.mode!=='approval'?{...bounds,width:Math.max(220,bounds.width),height:Math.max(140,bounds.height)}:bounds);
      const oldMode=view.mode;
      if (!panel) view = manualView(view, viewForAppearanceSize(safe.width, safe.height, view.mode,settings.appearance));
      if(view.mode!==oldMode)applyMaterial();
      win.setBounds(rememberCapsuleSize(safe)); publish(); saveSoon();
    },
    move: async (x: number, y: number, released = false) => {
      if (edgeMotion) return;
      if (presentation.state().morphing) presentation.stop();
      const revision = geometryRevision, current = win.getBounds();
      const target = { ...current, x, y }, area = screen.getDisplayMatching(target).workArea;
      const safe = clampBounds(target, area, dock ? orbSize : undefined);
      if (safe.x !== current.x || safe.y !== current.y) await hooks.position(safe.x, safe.y);
      if (revision !== geometryRevision || win.isDestroyed()) return;
      if (released) finishDrop(area);
      saveSoon();
    },
    displayChanged: (area?: Bounds) => {
      geometryRevision++;
      presentation.stop(false);
      if (!restoreCapsule(area)) {
        const bounds = floatingBounds();
        win.setBounds(rememberCapsuleSize(area ? clampBounds(bounds, area) : safeBounds(bounds)));
      }
      publish(); saveSoon();
    },
    stop: () => { persist(); presentation?.stop(); clearTimeout(edgeTimer); clearTimeout(completionTimer); clearTimeout(persistenceTimer); },
  };
}
