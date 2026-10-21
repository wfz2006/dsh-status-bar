import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Projection } from '@glass/protocol';
import { formatTokens, taskUsage, deriveTask, deriveSessionSummary } from '../shared/view-model';
import { Icon, type IconName } from './icon';
import { WhaleCompanion, WhaleEmpty } from './whale-companion';
export type Task = ReturnType<typeof deriveTask>;
export function StatusOrb({ task }: { task: Task }) {
  const symbol = task.status === 'completed' ? '✓' : task.status === 'disconnected' || task.status === 'error' || task.status === 'limit_reached' ? '!' : task.status === 'waiting_approval' || task.status === 'waiting_answer' ? '◇' : task.status === 'cancelled' ? '−' : task.status === 'archived' ? '▦' : '';
  return <span className={'status-orb ' + task.status} aria-label={task.label} title={task.label}>{symbol}</span>;
}
function Progress({ task }: { task: Task }) {
  return task.total ? <div className="task-progress" role="progressbar" aria-label="Todo 完成步骤" aria-valuemin={0} aria-valuemax={task.total} aria-valuenow={task.completed}><span style={{ width: task.completed / task.total * 100 + '%' }} /></div> : null;
}
function ContextRing({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  const circumference = 2 * Math.PI * 7;
  return <span className="context-ring" role="img" aria-label={'上下文占用 ' + value + '%'} title={'上下文 ' + value + '%'}>
    <svg viewBox="0 0 20 20" aria-hidden="true"><circle className="ring-track" cx="10" cy="10" r="7" /><circle className="ring-value" cx="10" cy="10" r="7" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} /></svg>
    <b>{value}%</b>
  </span>;
}
function SessionPicker({ projection, selected, select }: { projection: Projection; selected: string; select: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const menuId = useId();
  const ids = Object.keys(projection.sessions);
  const current = projection.sessions[selected];
  const sessions = useMemo(() => open || closing ? Object.keys(projection.sessions).map(id => deriveSessionSummary(projection, id)) : [], [projection, open, closing]);
  useEffect(() => () => { clearTimeout(closeTimer.current); if (pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current); }, []);
  function show() { clearTimeout(closeTimer.current); setClosing(false); setOpen(true); }
  function dismiss() {
    if (!open && !closing) return;
    if (pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current);
    pendingFocus.current = null; setOpen(false);
    setClosing(true); clearTimeout(closeTimer.current);
    // Preserve the existing 240ms close transition, then release the hidden
    // options instead of reconciling 100 invisible buttons for every token.
    closeTimer.current = setTimeout(() => setClosing(false), 250);
  }
  function close() { dismiss(); root.current?.querySelector<HTMLButtonElement>('.picker-trigger')?.focus(); }
  function focusOption(index: number) {
    if (pendingFocus.current !== null) cancelAnimationFrame(pendingFocus.current);
    const focus = () => { pendingFocus.current = null; root.current?.querySelectorAll<HTMLButtonElement>('[role=option]')[index]?.focus(); };
    // Once mounted, keyboard movement must be synchronous so a fast Enter uses
    // the newly focused option rather than the previous animation-frame target.
    if (open) focus(); else pendingFocus.current = requestAnimationFrame(focus);
  }
  return <div ref={root} className="session-picker" data-open={open} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dismiss(); }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); event.preventDefault(); close(); }
    if (['ArrowDown','ArrowUp','Home','End'].includes(event.key) && (open || event.key.startsWith('Arrow'))) {
      event.preventDefault(); event.stopPropagation();
      const options = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? []);
      const index = options.findIndex(option => option === document.activeElement);
      const selectedIndex = Math.max(0, ids.indexOf(selected));
      const next = !open ? selectedIndex : event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
        : index < 0 ? selectedIndex : (index + (event.key === 'ArrowDown' ? 1 : -1) + ids.length) % ids.length;
      show(); focusOption(next);
    }
  }}>
    <button type="button" className="picker-trigger" aria-haspopup="listbox" aria-controls={menuId} aria-expanded={open} aria-label={'选择会话' + (current ? '：' + current.title : '')} title={current?.title} onClick={() => { if (open) dismiss(); else show(); }}>
      <span className="picker-label">{current?.title ?? '选择会话'}</span><span className="picker-count" aria-hidden="true">{ids.length}</span><Icon name="chevron" />
    </button>
    <ul id={menuId} className="picker-menu" role="listbox" aria-label="选择会话" aria-hidden={!open} inert={!open}>
      {sessions.map(session => <li key={session.sessionId} role="presentation"><button type="button" role="option" tabIndex={-1} aria-selected={session.sessionId === selected} className="picker-option" onClick={() => { select(session.sessionId); close(); }}>
        <span className="picker-status" data-status={session.status} aria-hidden="true" /><span className="picker-option-title">{session.title}</span><small>{session.label}</small>{session.sessionId === selected && <Icon name="check" />}
      </button></li>)}
    </ul>
  </div>;
}
export function TaskCapsule({ task, activate }: { task: Task; activate: () => void }) {
  const title = task.status === 'disconnected' ? task.label + ' · ' + task.title : task.title;
  const metrics = taskUsage(task);
  const metricsTitle = metrics ? (metrics.stale ? '离线快照 · ' : '') + metrics.turns + ' 轮 · ' + metrics.steps + ' 次执行' + (metrics.speedText ? ' · ' + metrics.speedText : '') : '';
  const working = task.status === 'running' || task.status === 'starting';
  // Only the leading characters can be visible in a 288px capsule; animating
  // the clipped tail of a long session title wastes style and paint work.
  const titleChars = working ? Array.from(title) : [];
  const titleNode = working
    ? <span className="capsule-title" aria-hidden="true">{titleChars.slice(0, 32).map((char, index) => char === ' '
      ? <span className="wave-char wave-space" key={index} />
      : <span className="wave-char" key={index} style={{ animationDelay: (index % 24) * 0.045 + 's' }}>{char}</span>)}{titleChars.length > 32 && titleChars.slice(32).join('')}</span>
    : <span className="capsule-title">{title}</span>;
  return <button className="task-capsule" aria-label={task.attentionCount ? '展开待处理请求' : '展开速览'} aria-description="可拖动；右键打开菜单。数据来源与调试状态见设置。" title={title + ' · ' + task.label + (metricsTitle ? ' · ' + metricsTitle : '') + (task.attentionCount ? ' · ' + task.attentionCount + ' 项待处理' : '')} onClick={activate}>
    <WhaleCompanion state={task.status}><StatusOrb task={task} /></WhaleCompanion>{titleNode}
    {task.attentionCount > 0 && <span className="pending-count" aria-label={task.attentionCount + ' 项待处理请求'}>{task.attentionCount} 待处理</span>}
    {metrics && <span className="capsule-metrics" title={metricsTitle} aria-label={metrics.turns + ' 轮，Agent 执行 ' + metrics.steps + ' 步'}><b>{metrics.turns}</b>轮 · <b>{metrics.steps}</b>步</span>}
    {task.total > 0 && <span className="step-count" aria-label={task.completed + '/' + task.total + ' Todo 步骤完成'}><span className="progress-caption">任务 </span>{task.completed}/{task.total}</span>}
    {task.status === 'completed' && <span className="capsule-state">已完成</span>}
    {task.status === 'limit_reached' && <span className="capsule-state">达到上限</span>}
  </button>;
}
export function TaskPeek({ task, expand, approval, reconnect }: { task: Task; expand: () => void; approval: () => void; reconnect: () => void }) {
  const failure = task.status === 'disconnected' || task.status === 'error';
  const metrics = taskUsage(task);
  const recent = useMemo(() => {
    const notes = task.session?.notes ?? [];
    const activities = task.session?.activities ?? [];
    return [
      ...notes.map(note => ({ key: note.id, seq: note.sourceSeq, icon: noteIcons[note.kind], label: noteLabels[note.kind], text: note.text })),
      ...activities.map(activity => ({ key: 'tool:' + activity.callId, seq: activity.sourceSeq ?? 0, icon: toolIcon(activity.toolName), label: activity.toolName, text: activity.summary })),
    ].sort((a, b) => b.seq - a.seq).slice(0, 3);
  }, [task.session]);
  return <section className="task-peek" data-attention={task.attentionCount > 0}>
    <button className="peek-main" aria-label="展开任务详情" onClick={expand}>
      <div className="task-heading"><h1 title={task.title}>{task.title}</h1>{task.total > 0 && <span className="step-count">{task.completed}/{task.total}</span>}</div>
      <Progress task={task} />
      {recent.length > 0 && <div className="peek-process">
        {recent.map(row => <div className="peek-entry" key={row.key}><Icon name={row.icon} /><span className="peek-entry-title">{row.label}</span><span className="peek-entry-text">{row.text}</span></div>)}
      </div>}
      <div className="current-step"><StatusOrb task={task} /><span>{failure ? task.label + '，当前内容可能已过时' : task.current.map(t => t.content).join('、') || task.label}</span>{task.status === 'running' && task.current.length === 0 && <Icon name="whale" className="whale-tail" />}</div>
      {metrics && <div className="peek-usage">
        <div className="peek-stats">
          <span><b>{metrics.turns}</b> 轮 · 执行 <b>{metrics.steps}</b> 次{metrics.speedText && <span className="usage-speed" data-live={metrics.live}> · {metrics.speedText}</span>}{metrics.stale && <span className="metrics-snapshot"> · 离线快照</span>}</span>
          <span>{metrics.totalTokens !== undefined && <><b>{formatTokens(metrics.totalTokens)}</b> tok</>}{metrics.cacheHitPercent !== undefined && <span> · 缓存 {metrics.cacheHitPercent}%</span>}</span>
        </div>
        {metrics.contextPercent !== undefined && <ContextRing percent={metrics.contextPercent} />}
      </div>}
    </button>
    {failure ? <button className="attention-link" onClick={reconnect}><span className="control-label">重新连接</span> <span aria-hidden="true">↗</span></button> : task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
const noteLabels = { reasoning: '思考', message: 'DSH', user: '你' } as const;
const noteIcons = { reasoning: 'brain', message: 'whale', user: 'user' } as const;
const activityLabels = { pending: '等待执行', running: '执行中', success: '已完成', error: '执行失败', cancelled: '已取消' } as const;
function toolIcon(name: string): IconName {
  const value = name.toLowerCase();
  if (/read|cat|view/.test(value)) return 'file';
  if (/image|screenshot/.test(value)) return 'image';
  if (/pwsh|powershell|bash|shell|exec|terminal/.test(value)) return 'terminal';
  if (/edit|write|patch|apply/.test(value)) return 'pencil';
  if (/grep|search|find|glob/.test(value)) return 'search';
  if (/web|fetch|browser|http/.test(value)) return 'globe';
  if (/todo|task|plan/.test(value)) return 'list';
  if (/code/.test(value)) return 'code';
  return 'wrench';
}
type ProcessRowData =
  | { kind: 'note'; key: string; sourceSeq: number; note: NonNullable<NonNullable<Task['session']>['notes']>[number] }
  | { kind: 'tool'; key: string; sourceSeq: number; activity: NonNullable<NonNullable<Task['session']>['activities']>[number] };

const ProcessRow = memo(function ProcessRow({ row, index }: { row: ProcessRowData; index: number }) {
  // The entry animation only runs on mount; shifting list positions must not
  // rewrite every row's delay, so capture the first index once.
  const delay = useRef(Math.min(index, 10) * 16).current;
  return row.kind === 'note'
    ? <details className="process-entry" data-kind={row.note.kind} data-streaming={row.note.streaming} style={{ animationDelay: `${delay}ms` }}>
      <summary>
        <span className="entry-icon" aria-hidden="true"><Icon name={noteIcons[row.note.kind]} /></span>
        <span className="entry-title">{noteLabels[row.note.kind]}</span>
        <span className="entry-preview">{row.note.text}</span>
        <span className={row.note.streaming ? 'entry-status' : row.note.kind === 'user' ? 'entry-status entry-status-quiet' : 'entry-status entry-status-done'}>{row.note.streaming ? '生成中' : row.note.kind === 'user' ? '已发送' : '已完成'}</span>
        <Icon name="chevron" />
      </summary>
      <p className="entry-body">{row.note.text}</p>
    </details>
    : <details className="process-entry" data-kind="tool" data-tool-status={row.activity.status ?? 'running'} style={{ animationDelay: `${delay}ms` }}>
      <summary>
        <span className="entry-icon" aria-hidden="true"><Icon name={toolIcon(row.activity.toolName)} /></span>
        <span className="entry-title">{row.activity.toolName}</span>
        <span className="entry-preview">{row.activity.summary}</span>
        <span className="entry-status">{activityLabels[row.activity.status ?? 'running']}</span>
        <Icon name="chevron" />
      </summary>
      <div className="entry-body">
        <p>{row.activity.summary}</p>
        {row.activity.resultSummary && <p className="activity-result">{row.activity.resultSummary}</p>}
      </div>
    </details>;
}, (before, after) => {
  if (before.row.kind !== after.row.kind || before.row.key !== after.row.key) return false;
  if (before.row.kind === 'note') {
    const previous = before.row.note, next = (after.row as Extract<ProcessRowData, { kind: 'note' }>).note;
    return previous.id === next.id && previous.text === next.text && previous.kind === next.kind && previous.streaming === next.streaming;
  }
  const previous = before.row.activity, next = (after.row as Extract<ProcessRowData, { kind: 'tool' }>).activity;
  return previous.callId === next.callId && previous.toolName === next.toolName && previous.summary === next.summary
    && previous.status === next.status && previous.resultSummary === next.resultSummary;
});

function ProcessList({ task }: { task: Task }) {
  const notes = task.session?.notes;
  const activities = task.session?.activities;
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ top: false, bottom: false });
  // Fade the transcript at whichever edge still hides content, so a clipped row
  // dissolves instead of ending on a hard line.
  const syncFade = () => {
    const el = listRef.current;
    if (!el) return;
    const top = el.scrollTop > 2;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setFade(current => current.top === top && current.bottom === bottom ? current : { top, bottom });
  };
  // The adapter emits the whole session on every change; only re-merge when the
  // transcript or activity arrays actually changed.
  const rows = useMemo(() => [
    ...(notes ?? []).map(note => ({ kind: 'note' as const, key: note.id, sourceSeq: note.sourceSeq, note })),
    ...(activities ?? []).map(activity => ({ kind: 'tool' as const, key: activity.callId, sourceSeq: activity.sourceSeq ?? 0, activity })),
  ].sort((a, b) => b.sourceSeq - a.sourceSeq), [notes, activities]);
  useEffect(() => { syncFade(); }, [rows]);
  if (!rows.length) return <WhaleEmpty>此会话尚无过程；开始工作后，这里会按时间出现思考与工具调用。</WhaleEmpty>;
  return <div ref={listRef} onScroll={syncFade} data-fade-top={fade.top ? 'true' : undefined} data-fade-bottom={fade.bottom ? 'true' : undefined} className="activity-list process-list" role="tabpanel" aria-label="AI 工作过程">
    {rows.map((row, index) => <ProcessRow row={row} index={index} key={row.key} />)}
  </div>;
}
const TodoList = memo(function TodoList({ todos }: { todos: Task['todos'] }) {
  if (!todos.length) return <WhaleEmpty>此会话尚无 Todo，不显示百分比。</WhaleEmpty>;
  return <ol className="todo-list" aria-label="Todo 列表">{todos.map((todo, i) => <li className={'todo ' + todo.status} key={i + todo.content} aria-current={todo.status === 'in_progress' ? 'step' : undefined}><span className="todo-symbol" aria-label={todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待开始'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span><span className="todo-text">{todo.content}</span>{todo.status === 'completed' && <span className="todo-note">已完成</span>}</li>)}</ol>;
});
export function TaskExpanded({ task, projection, selected, select, approval, reconnect }: { task: Task; projection: Projection; selected: string; select: (id: string) => void; approval: () => void; reconnect: () => void }) {
  const [tab, setTab] = useState<'process' | 'steps'>('process');
  const metrics = taskUsage(task);
  const todos = task.todos;
  return <section className="task-expanded">
    <div className="task-heading"><h1 title={task.title}>{task.title}</h1></div>
    {Object.keys(projection.sessions).length > 1 && <div className="task-picker-row"><SessionPicker projection={projection} selected={selected} select={select} /></div>}
    <div className="task-meta"><StatusOrb task={task} /><span>{task.label}{projection.stale ? ' · 状态可能过时' : ''}</span>{task.status === 'running' && <Icon name="whale" className="whale-tail" />}{task.total > 0 && <span className="step-count">任务 {task.completed}/{task.total}</span>}</div>
    {metrics && <div className="task-metrics">
      <div className="metrics-primary"><span><b>{metrics.turns}</b> 轮 · 执行 <b>{metrics.steps}</b> 次</span>
        {metrics.speedText && <span className="usage-speed" data-live={metrics.live}>{metrics.speedText}</span>}
        {metrics.stale && <span className="metrics-snapshot">离线快照</span>}
      </div>
      <div className="metrics-secondary">
        {metrics.totalTokens !== undefined && <span><b>{formatTokens(metrics.totalTokens)}</b> tok</span>}
        {metrics.cacheHitPercent !== undefined && <span>缓存 <b>{metrics.cacheHitPercent}%</b></span>}
        {metrics.contextPercent !== undefined && <span>上下文 <b>{metrics.contextPercent}%</b></span>}
      </div>
    </div>}
    <Progress task={task} />
    <div className="task-tabs" role="tablist" aria-label="任务详情视图" data-active={tab}>
      <button className="task-tab" role="tab" aria-selected={tab === 'process'} onClick={() => setTab('process')}>过程</button>
      <button className="task-tab" role="tab" aria-selected={tab === 'steps'} onClick={() => setTab('steps')}>步骤{task.total > 0 ? ' ' + task.completed + '/' + task.total : ''}</button>
    </div>
    <div className="task-panel" key={tab}>
      {tab === 'process' ? <ProcessList task={task} /> : <TodoList todos={todos} />}
    </div>
    {task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
    {(task.status === 'disconnected' || task.status === 'error') && <button className="attention-link" onClick={reconnect}><span className="control-label">检查连接并重试</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
