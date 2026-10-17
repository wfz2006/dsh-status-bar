import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GlassAPI, WindowAction, MockAction } from '../shared/api';
import { density } from '../shared/window';
import { useGlass } from './store';
import './style.css';

declare global { interface Window { glass: GlassAPI } }
function App() {
  const { projection: p, selected, replace, select } = useGlass();
  const root = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<ReturnType<typeof density>>('capsule');
  const [theme, setTheme] = useState('system');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = window.glass.subscribe(replace);
    const unsubscribeWindow = window.glass.subscribeWindow(state => setPinned(state.pinned));
    void window.glass.getWindowState().then(state => setPinned(state.pinned)).catch(() => setError('无法获取窗口状态'));
    void window.glass.getState().then(replace).catch(() => setError('无法连接桌面宿主'));
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.borderBoxSize[0];
      if (rect) setLayout(density(rect.inlineSize, rect.blockSize));
    });
    if (root.current) observer.observe(root.current);
    return () => { unsubscribe(); unsubscribeWindow(); observer.disconnect(); };
  }, [replace]);
  async function action(value: WindowAction) {
    try { const state = await window.glass.windowAction(value); setPinned(state.pinned); }
    catch { setError('窗口操作暂不可用'); }
  }
  async function mock(value: MockAction) {
    try { await window.glass.mockAction(value); } catch { setError('Mock 操作未完成'); }
  }
  const session = p.sessions[selected];
  const todos = session?.todos ?? [];
  const completed = todos.filter(t => t.status === 'completed').length;
  const current = todos.filter(t => t.status === 'in_progress');
  const approvals = p.approvals.filter(a => a.sessionId === selected);
  const connected = p.connection === 'connected' && !p.stale;
  const connectionLabel = p.connection === 'incompatible' ? '协议版本不兼容' : connected ? 'Mock 已连接' : p.connection === 'connecting' ? '正在连接 Mock' : 'Mock 连接已断开';
  const status = !connected ? connectionLabel : approvals.some(a => a.status === 'pending') ? '模拟审批待查看' : session?.phase === 'finished' ? '会话已完成' : session?.phase === 'error' ? '会话出错' : session?.agentStatus === 'running' ? '正在进行' : '等待新事件';

  return <main ref={root} className={`glass ${layout}`} data-density={layout} data-theme={theme}>
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
          <button aria-label="折叠为胶囊" title="折叠为胶囊" onDoubleClick={() => void action('collapse')} onClick={() => void action('collapse')}>−</button>
          <button aria-label="隐藏到托盘" title="隐藏到托盘 · Ctrl+Shift+G 恢复" onClick={() => void action('hide')}>×</button>
        </div>
      </header>
      {layout === 'compact' ? <button className="compact-content" onClick={() => void action('expand')} aria-label="查看完整任务">
        <span className="status-line"><span className={`dot ${connected ? 'online' : 'offline'}`} />{status}<span className="steps">{completed}/{todos.length} 步骤</span></span>
        <span className="compact-task">{current[0]?.content ?? session?.title ?? '尚无会话'}</span>
        <span className="compact-hint">开发预览 · 点击展开 ↗</span>
      </button> : <>
        <div className="content">
          <div className="eyebrow">YOUR DESKTOP COMPANION<span>01 / PREVIEW</span></div>
          <section className="session-head">
            <label className="sr-only" htmlFor="session-select">选择会话</label>
            <select id="session-select" value={selected} onChange={e => select(e.target.value)} aria-label="选择会话">
              {Object.values(p.sessions).map(s => <option key={s.sessionId} value={s.sessionId}>{s.title}</option>)}
              {!session && <option value="">尚无会话</option>}
            </select>
            <p className="workspace-label"><span>⌁</span> {session?.workspaceLabel ?? '等待连接本地 Bridge'}</p>
          </section>
          <div className={`status-panel ${!connected ? 'disconnected' : ''}`} role="status">
            <span className={`dot ${connected ? 'online' : 'offline'}`} />
            <span>{status}</span><span className="status-meta">{p.stale ? '数据已过时' : '模拟事件源'}</span>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <section className="task-section" aria-label="Todo 列表">
            <div className="section-title"><h2>任务清单</h2><span>{todos.length ? `${completed} / ${todos.length} 步骤完成` : '暂无 Todo'}</span></div>
            {todos.length > 0 && <div className="progress" aria-label={`${completed} / ${todos.length} 步骤完成`}><span style={{ width: `${completed / todos.length * 100}%` }} /></div>}
            <ol className="todos">{todos.map((todo, index) => <li className={`todo ${todo.status}`} key={`${index}-${todo.content}`}>
              <span className="todo-icon" aria-label={todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待开始'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span>
              <span>{todo.content}</span>{todo.status === 'in_progress' && <span className="working-label">进行中</span>}
            </li>)}</ol>
            {!todos.length && <p className="empty">此会话尚未使用 Todo 工具。</p>}
            {current.length > 1 && <p className="muted">{current.length} 项任务并行进行</p>}
          </section>
          {approvals.map(a => <section className="approval" key={`${a.sessionId}-${a.requestId}`} aria-label="模拟审批">
            <div className="approval-heading"><span>◇</span><h2>模拟审批 · 只读</h2><span className="request-tool">{a.toolName}</span></div>
            <p>{a.reason}</p><code>{a.commandPreview ?? '参数暂不可用'}</code>
            <p className="approval-note">{!connected ? '连接已断开，请求不可操作。' : '详情不完整，真实审批尚未接入。'}</p>
            <div className="approval-buttons"><button disabled>拒绝</button><button disabled>允许一次</button></div>
          </section>)}
          <section className="activity-section" aria-label="近期活动">
            <div className="section-title"><h2>近期活动</h2><span>来自 Mock</span></div>
            {session?.activities.length ? session.activities.map(a => <div className="activity" key={`${a.callId}-${a.sourceSeq}`}><span className="activity-icon">↳</span><div><strong>{a.toolName}</strong><p>{a.summary}</p></div></div>) : <p className="empty">等待新的工具事件</p>}
          </section>
          <details className="preview-controls"><summary>开发预览控制</summary>
            <p>事件按固定顺序播放一次：3 项 Todo → 2 项 Todo → 只读审批。所有内容均为模拟。</p>
            <div className="controls-grid"><button onClick={() => void mock('restart')}>重播 Mock</button><button onClick={() => void mock(connected ? 'disconnect' : 'reconnect')}>{connected ? '模拟断线' : '重新连接'}</button><button onClick={() => void mock('out-of-order')}>乱序场景</button><button onClick={() => void action('material')}>切换系统材质</button></div>
            <label className="theme-label">外观<select aria-label="外观主题" value={theme} onChange={e => setTheme(e.target.value)}><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select></label>
          </details>
          <p className="preview-warning">Mock 开发预览 · 未连接真实 DSH<br />本机 Desktop 接入与审批所有权待验证。</p>
        </div>
        <footer><span className="connection"><span className={`dot ${connected ? 'online' : 'offline'}`} />{connectionLabel}</span><button className={pinned ? 'active' : ''} aria-label="置顶开关" aria-pressed={pinned} onClick={() => void action('pin')}>{pinned ? '已置顶' : '置顶'}</button><button aria-label="退出 Glass" onClick={() => void action('quit')}>退出</button></footer>
      </>}
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
