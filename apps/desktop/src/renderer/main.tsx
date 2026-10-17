import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GlassAPI, WindowAction, MockAction, WindowState } from '../shared/api';
import { density, resizeBounds, type ResizeEdge, type Bounds } from '../shared/window';
import { useGlass } from './store';
import './style.css';

declare global { interface Window { glass: GlassAPI } }
function ResizeHandles() {
  const drag = useRef<{ edge: ResizeEdge; start: Bounds; x: number; y: number } | null>(null);
  const pending = useRef<Bounds | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  const edges: ResizeEdge[] = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
  function flush() {
    raf.current = null;
    if (pending.current) { void window.glass.resizeWindow(pending.current).catch(() => {}); pending.current = null; }
  }
  return <>{edges.map(edge => <div key={edge} className={`resize-edge resize-${edge}`} aria-hidden="true"
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { edge, start: { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }, x: e.screenX, y: e.screenY };
    }}
    onPointerMove={e => {
      const d = drag.current; if (!d) return;
      pending.current = resizeBounds(d.start, d.edge, e.screenX - d.x, e.screenY - d.y);
      if (raf.current === null) raf.current = requestAnimationFrame(flush);
    }}
    onPointerUp={() => { flush(); drag.current = null; }}
    onLostPointerCapture={() => { flush(); drag.current = null; }}
  />)}</>;
}
function App() {
  const { projection: p, selected, replace, select } = useGlass();
  const root = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<ReturnType<typeof density>>('capsule');
  const [theme, setTheme] = useState('dark');
  const [windowState, setWindowState] = useState<WindowState>({ pinned: false, material: 'acrylic', morphing: null });
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = window.glass.subscribe(replace);
    const unsubscribeWindow = window.glass.subscribeWindow(setWindowState);
    void window.glass.getWindowState().then(setWindowState).catch(() => setError('无法获取窗口状态'));
    void window.glass.getState().then(replace).catch(() => setError('无法连接桌面宿主'));
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.borderBoxSize[0];
      if (rect) setMeasured(density(rect.inlineSize, rect.blockSize));
    });
    if (root.current) observer.observe(root.current);
    return () => { unsubscribe(); unsubscribeWindow(); observer.disconnect(); };
  }, [replace]);
  async function action(value: WindowAction) {
    try { setWindowState(await window.glass.windowAction(value, matchMedia('(prefers-reduced-motion: reduce)').matches)); }
    catch { setError('窗口操作暂不可用'); }
  }
  async function mock(value: MockAction) {
    try { await window.glass.mockAction(value); } catch { setError('Mock 操作未完成'); }
  }
  const layout = windowState.morphing === 'expanding' ? 'workspace' : windowState.morphing === 'collapsing' ? 'capsule' : measured;
  const session = p.sessions[selected];
  const todos = session?.todos ?? [];
  const completed = todos.filter(t => t.status === 'completed').length;
  const current = todos.filter(t => t.status === 'in_progress');
  const approvals = p.approvals.filter(a => a.sessionId === selected);
  const connected = p.connection === 'connected' && !p.stale;
  const connectionLabel = p.connection === 'incompatible' ? '协议不兼容' : connected ? 'Mock 已连接' : p.connection === 'connecting' ? '正在连接 Mock' : 'Mock 连接已断开';
  const status = !connected ? connectionLabel : approvals.some(a => a.status === 'pending') ? '等待处理' : session?.phase === 'finished' ? '会话已完成' : session?.phase === 'error' ? '会话出错' : session?.agentStatus === 'running' ? '进行中' : '等待新事件';
  return <main ref={root} className={`glass ${layout}`} data-density={layout} data-theme={theme} data-material={windowState.material} data-morph={windowState.morphing ?? 'idle'}>
    <div className="optical-surface" aria-hidden="true"><i className="caustic caustic-top" /><i className="caustic caustic-bottom" /></div>
    {layout === 'capsule' ? <div className="capsule-row">
      <span className="capsule-grip drag" title="拖动窗口">⠿</span>
      <button className="capsule-open" aria-label="展开工作台" onClick={() => void action('expand')}>
        <span className={`dot ${connected ? 'online' : 'offline'}`} /><strong>DSH</strong><span className="tiny-mock">MOCK</span>
        <span className="capsule-count">{!connected ? '离线' : approvals.length ? `! ${approvals.length}` : `${completed}/${todos.length}`}</span>
      </button>
    </div> : <>
      <header className="titlebar drag">
        <div className="brand"><span className="brand-mark">D</span><span>DSH <b>Glass</b></span></div>
        <span className="mock-tag">MOCK</span>
        <div className="window-actions no-drag">
          <button aria-label="折叠为胶囊" title="折叠" onClick={() => void action('collapse')}>−</button>
          <button aria-label="隐藏到托盘" title="隐藏 · Ctrl+Shift+G 恢复" onClick={() => void action('hide')}>×</button>
        </div>
      </header>
      {layout === 'compact' ? <button className="compact-content" onClick={() => void action('expand')} aria-label="查看完整任务">
        <span className="status-line"><span className={`dot ${connected ? 'online' : 'offline'}`} />{status}<span className="steps">{completed}/{todos.length} 步骤</span></span>
        <span className="compact-task">{current[0]?.content ?? session?.title ?? '尚无会话'}</span>
      </button> : <>
        <div className="content">
          <section className="session-head">
            <label className="sr-only" htmlFor="session-select">选择会话</label>
            <select id="session-select" value={selected} onChange={e => select(e.target.value)} aria-label="选择会话">
              {Object.values(p.sessions).map(s => <option key={s.sessionId} value={s.sessionId}>{s.title}</option>)}
              {!session && <option value="">尚无会话</option>}
            </select>
          </section>
          <div className={`status-panel ${!connected ? 'disconnected' : ''}`} role="status">
            <span className={`dot ${connected ? 'online' : 'offline'}`} /><span>{status}</span>
            <span className="status-meta">{p.stale ? '数据已过时' : todos.length ? `${completed}/${todos.length} 步骤` : '暂无 Todo'}</span>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <section className="task-section" aria-label="Todo 列表">
            {todos.length > 0 && <div className="progress" aria-label={`${completed} / ${todos.length} 步骤完成`}><span style={{ width: `${completed / todos.length * 100}%` }} /></div>}
            <ol className="todos">{todos.map((todo, index) => <li className={`todo ${todo.status}`} key={`${index}-${todo.content}`}>
              <span className="todo-icon" aria-label={todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待开始'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span>
              <span>{todo.content}</span>
            </li>)}</ol>
            {!todos.length && <p className="empty">此会话尚无 Todo</p>}
            {current.length > 1 && <p className="muted">{current.length} 项并行进行</p>}
          </section>
          {approvals.map(a => <section className="approval" key={`${a.sessionId}-${a.requestId}`} aria-label="模拟审批">
            <details className="approval-details"><summary><span className="approval-icon">◇</span><span>待处理 <b>{a.toolName}</b></span><span className="readonly-tag">只读</span></summary>
              <div className="approval-body"><code>{a.commandPreview ?? '参数暂不可用'}</code>
                <p>{!connected ? '连接已断开，请求不可操作。' : 'Mock 请求 · 真实审批尚未接入，详情不完整。'}</p>
                <div className="approval-buttons"><button disabled>拒绝</button><button disabled>允许一次</button></div>
              </div>
            </details>
          </section>)}
          <details className="preview-controls"><summary>活动与设置</summary>
            <div className="secondary-content">
              {session?.activities.length ? session.activities.map(a => <div className="activity" key={`${a.callId}-${a.sourceSeq}`}><strong>{a.toolName}</strong><p>{a.summary}</p></div>) : <p className="empty">暂无工具活动</p>}
              <p className="workspace-label">{session?.workspaceLabel ?? '尚无会话'}</p>
              <div className="controls-grid"><button onClick={() => void mock('restart')}>重播 Mock</button><button onClick={() => void mock(connected ? 'disconnect' : 'reconnect')}>{connected ? '模拟断线' : '重新连接'}</button><button onClick={() => void mock('out-of-order')}>乱序场景</button><button onClick={() => void action('material')}>材质：{windowState.material === 'acrylic' ? '系统磨砂' : windowState.material === 'clear' ? '清透' : '实色'}</button></div>
              <label className="theme-label">外观<select aria-label="外观主题" value={theme} onChange={e => { const value = e.target.value; if (value === 'system' || value === 'dark' || value === 'light') { setTheme(value); void action(`theme-${value}`); } }}><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select></label>
              <p className="preview-warning">Mock 开发预览，未连接真实 DSH。</p>
            </div>
          </details>
        </div>
        <footer><span className="connection"><span className={`dot ${connected ? 'online' : 'offline'}`} />{connectionLabel}</span>
          <button className={windowState.pinned ? 'active' : ''} aria-label="置顶开关" aria-pressed={windowState.pinned} onClick={() => void action('pin')}>{windowState.pinned ? '已置顶' : '置顶'}</button>
          <button aria-label="退出 Glass" onClick={() => void action('quit')}>退出</button></footer>
      </>}
    </>}
    <ResizeHandles />
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
