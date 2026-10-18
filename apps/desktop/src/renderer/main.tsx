import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GlassAPI, WindowAction, WindowState } from '../shared/api';
import { DEFAULT_SETTINGS, deriveTask, viewForSize, type GlassViewMode } from '../shared/view-model';
import { chimeFor, type ChimeSnapshot } from '../shared/sound';
import { playChime } from './sound';
import { useGlass } from './store';
import { ResizeHandles,useWindowDrag } from './gestures';
import { TaskCapsule, TaskPeek, TaskExpanded } from './task-views';
import { RequestPanel } from './question-card';
import { GlassSettingsPanel } from './settings';
import { GlassMaterial } from './glass-material';
import { Icon } from './icon';
import './style.css';
import './refined-theme.css';
import './typography.css';
import './integration-controls.css';

declare global { interface Window { glass: GlassAPI } }
const initialWindow: WindowState = { pinned: false, material: 'acrylic', morphing: null, viewMode: 'capsule', manualSize: false, panel: null, settings: { ...DEFAULT_SETTINGS }, completionFeedback: false };
function App() {
  const drag=useWindowDrag();
  const { projection, selected, replace, select } = useGlass();
  const root = useRef<HTMLElement>(null);
  const settledMode = useRef<GlassViewMode>('capsule');
  const [windowState, setWindowState] = useState<WindowState>(initialWindow);
  const [size, setSize] = useState({ width: 300, height: 56 });
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = window.glass.subscribe(replace);
    const unsubscribeWindow = window.glass.subscribeWindow(setWindowState);
    void window.glass.getWindowState().then(setWindowState).catch(() => setError('窗口状态暂不可用'));
    void window.glass.getState().then(replace).catch(() => setError('本地连接不可用'));
    const observer = new ResizeObserver(entries => { const box = entries[0]?.borderBoxSize[0]; if (box) setSize({ width: box.inlineSize, height: box.blockSize }); });
    if (root.current) observer.observe(root.current);
    return () => { unsubscribe(); unsubscribeWindow(); observer.disconnect(); };
  }, [replace]);
  async function action(value: WindowAction) {
    try { setWindowState(await window.glass.windowAction(value, matchMedia('(prefers-reduced-motion: reduce)').matches)); }
    catch { setError('操作未完成，请稍后重试'); }
  }
  async function chooseSession(id: string) {
    try { await window.glass.selectSession(id); select(id); } catch { setError('会话已不可用'); }
  }
  const task = deriveTask(projection, selected);
  const chime = useRef<ChimeSnapshot | null>(null);
  useEffect(() => {
    const next = { sessionId: selected, status: task.status, attention: task.attentionCount };
    const kind = chimeFor(chime.current, next, windowState.settings.sound);
    chime.current = next;
    if (kind) playChime(kind);
  }, [selected, task.status, task.attentionCount, windowState.settings.sound]);
  const mode = windowState.morphing === 'collapsing' && windowState.viewMode === 'capsule' ? settledMode.current : windowState.morphing || windowState.panel ? windowState.viewMode : viewForSize(size.width, size.height, windowState.viewMode);
  if (!windowState.morphing) settledMode.current = mode;
  const invoke = (value: WindowAction) => () => void action(value);
  return <main ref={root} {...drag} className="glass" data-mode={mode} data-panel={windowState.panel ?? 'none'}
    data-state={task.status} data-material={windowState.material} data-strength={windowState.settings.strength}
    data-theme={windowState.material === 'frosted' ? 'dark' : windowState.settings.theme} data-morph={windowState.morphing ?? 'idle'}
    data-animation={windowState.settings.animation} data-completion={windowState.completionFeedback}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); void action(windowState.panel ? 'back' : 'collapse'); }
      if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); void action('menu'); }
    }}>
    <GlassMaterial strength={windowState.settings.strength} moving={!!windowState.morphing} solid={windowState.material === 'solid'} frosted={windowState.material === 'frosted'} autoTheme={windowState.settings.theme==='auto'} appearance={windowState.settings} />
    {(mode !== 'capsule' || windowState.panel) && <div className="drag-strip">
      <div className="chrome-group" role="toolbar" aria-label="窗口操作">
        <button className="chrome-button" aria-label="收起窗口" title="收起窗口" onClick={invoke('collapse')}><Icon name="collapse"/></button>
        <button className="chrome-button" aria-label="窗口菜单" title="窗口菜单" onClick={invoke('menu')}><Icon name="more"/></button>
      </div>
    </div>}
    {error && mode !== 'capsule' && <p className="inline-error" role="alert">{error}</p>}
    {windowState.panel === 'settings' ? <GlassSettingsPanel value={windowState.settings} projection={projection} back={invoke('back')}
      update={patch => {
        setWindowState(current => ({ ...current, settings: { ...current.settings, ...patch } }));
        void window.glass.setSettings(patch).then(setWindowState).catch(() => {
          setError('设置未保存'); void window.glass.getWindowState().then(setWindowState).catch(() => {});
        });
      }}
      mock={value => { void window.glass.mockAction(value).catch(() => setError('调试操作未完成')); }} />
    : windowState.panel === 'activity' ? <section className="activity-panel"><div className="panel-heading"><button className="back-button" aria-label="返回" title="返回" onClick={invoke('back')}><Icon name="back"/></button><h1>最近活动</h1></div>
      <div className="activity-list">{task.session?.activities.length ? task.session.activities.map(a => <article key={a.callId} data-tool-status={a.status??'running'}><div className="activity-heading"><strong>{a.toolName}</strong><span className="activity-status">{{pending:'等待执行',running:'执行中',success:'已完成',error:'执行失败',cancelled:'已取消'}[a.status??'running']}</span></div><p>{a.summary}</p>{a.resultSummary && <p className="activity-result">{a.resultSummary}</p>}</article>) : <p className="empty-state">此会话暂无工具活动</p>}</div></section>
    : mode === 'capsule' ? <TaskCapsule task={task} activate={invoke(task.attentionCount ? 'approval' : 'expand')} />
    : mode === 'peek' ? <TaskPeek task={task} expand={invoke('expand')} approval={invoke('approval')} reconnect={invoke('reconnect')} />
    : mode === 'expanded' ? <TaskExpanded task={task} projection={projection} selected={selected} select={id => void chooseSession(id)} approval={invoke('approval')} reconnect={invoke('reconnect')} />
    : <RequestPanel key={JSON.stringify([projection.runtimeId,projection.epoch,selected])} task={task} openDSH={invoke('open-dsh')} />}
    <ResizeHandles />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
