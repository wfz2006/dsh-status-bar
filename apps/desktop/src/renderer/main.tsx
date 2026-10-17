import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GlassAPI, WindowAction, WindowState } from '../shared/api';
import { DEFAULT_SETTINGS, deriveTask, viewForSize } from '../shared/view-model';
import { useGlass } from './store';
import { ResizeHandles } from './gestures';
import { TaskCapsule, TaskPeek, TaskExpanded } from './task-views';
import { ApprovalCard } from './approval-card';
import { GlassSettingsPanel } from './settings';
import './style.css';

declare global { interface Window { glass: GlassAPI } }
const initialWindow: WindowState = { pinned: false, material: 'acrylic', morphing: null, viewMode: 'capsule', manualSize: false, panel: null, settings: { ...DEFAULT_SETTINGS }, completionFeedback: false };
function App() {
  const { projection, selected, replace, select } = useGlass();
  const root = useRef<HTMLElement>(null);
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
    catch { setError('操作未完成，请通过托盘重试'); }
  }
  async function chooseSession(id: string) {
    try { await window.glass.selectSession(id); select(id); } catch { setError('会话已不可用'); }
  }
  const task = deriveTask(projection, selected);
  const mode = windowState.morphing || windowState.panel ? windowState.viewMode : viewForSize(size.width, size.height, windowState.viewMode);
  const invoke = (value: WindowAction) => () => void action(value);
  return <main ref={root} className="glass" data-mode={mode} data-panel={windowState.panel ?? 'none'}
    data-state={task.status} data-material={windowState.material} data-strength={windowState.settings.strength}
    data-theme={windowState.settings.theme} data-morph={windowState.morphing ?? 'idle'}
    data-animation={windowState.settings.animation} data-completion={windowState.completionFeedback}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); void action(windowState.panel ? 'back' : 'collapse'); }
      if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); void action('menu'); }
    }}>
    <div className="glass-optics" aria-hidden="true"><i className="glass-highlight" /></div>
    {(mode !== 'capsule' || windowState.panel) && <div className="drag-strip" aria-hidden="true" title="拖动窗口" />}
    {error && mode !== 'capsule' && <p className="inline-error" role="alert">{error}</p>}
    {windowState.panel === 'settings' ? <GlassSettingsPanel value={windowState.settings} projection={projection} back={invoke('back')}
      update={patch => { void window.glass.setSettings(patch).then(setWindowState).catch(() => setError('设置未保存')); }}
      mock={value => { void window.glass.mockAction(value).catch(() => setError('调试操作未完成')); }} />
    : windowState.panel === 'activity' ? <section className="activity-panel"><div className="panel-heading"><h1>最近活动</h1><button className="quiet-button" onClick={invoke('back')}>返回</button></div>
      <div className="activity-list">{task.session?.activities.length ? task.session.activities.map(a => <article key={a.callId + '/' + a.sourceSeq}><strong>{a.toolName}</strong><p>{a.summary}</p></article>) : <p className="empty-state">此会话暂无工具活动</p>}</div></section>
    : mode === 'capsule' ? <TaskCapsule task={task} activate={invoke(task.pending.length ? 'approval' : 'expand')} />
    : mode === 'peek' ? <TaskPeek task={task} expand={invoke('expand')} approval={invoke('approval')} reconnect={invoke('reconnect')} />
    : mode === 'expanded' ? <TaskExpanded task={task} projection={projection} selected={selected} select={id => void chooseSession(id)} approval={invoke('approval')} reconnect={invoke('reconnect')} />
    : <ApprovalCard task={task} openDSH={invoke('open-dsh')} />}
    <ResizeHandles />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
