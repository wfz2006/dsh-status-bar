import { useState } from 'react';
import type { Projection } from '@glass/protocol';
import { formatTokens, taskMetrics, type deriveTask } from '../shared/view-model';
import { Icon, type IconName } from './icon';
export type Task = ReturnType<typeof deriveTask>;
export function StatusOrb({ task }: { task: Task }) {
  const symbol = task.status === 'completed' ? '✓' : task.status === 'disconnected' || task.status === 'error' ? '!' : task.status === 'waiting_approval' || task.status === 'waiting_answer' ? '◇' : task.status === 'cancelled' ? '−' : task.status === 'archived' ? '▦' : '';
  return <span className={'status-orb ' + task.status} aria-label={task.label} title={task.label}>{symbol}</span>;
}
function Progress({ task }: { task: Task }) {
  return task.total ? <div className="task-progress" role="progressbar" aria-label="Todo 完成步骤" aria-valuemin={0} aria-valuemax={task.total} aria-valuenow={task.completed}><span style={{ width: task.completed / task.total * 100 + '%' }} /></div> : null;
}
export function TaskCapsule({ task, activate }: { task: Task; activate: () => void }) {
  const title = task.status === 'disconnected' ? task.label + ' · ' + task.title : task.title;
  const metrics = taskMetrics(task.session);
  const metricsTitle = metrics ? metrics.turns + ' 轮 · ' + metrics.steps + ' 步' + (metrics.tokensPerSecond !== undefined ? ' · ' + metrics.tokensPerSecond + ' tok/s' : '') : '';
  const working = task.status === 'running' || task.status === 'starting';
  const titleNode = working
    ? <span className="capsule-title" aria-hidden="true">{Array.from(title).map((char, index) => char === ' '
      ? <span className="wave-char wave-space" key={index} />
      : <span className="wave-char" key={index} style={{ animationDelay: (index % 24) * 0.045 + 's' }}>{char}</span>)}</span>
    : <span className="capsule-title">{title}</span>;
  return <button className="task-capsule" aria-label={task.attentionCount ? '展开待处理请求' : '展开速览'} aria-description="可拖动；右键打开菜单。数据来源与调试状态见设置。" title={title + ' · ' + task.label + (metricsTitle ? ' · ' + metricsTitle : '') + (task.attentionCount ? ' · ' + task.attentionCount + ' 项待处理' : '')} onClick={activate}>
    <StatusOrb task={task} />{titleNode}
    {task.attentionCount > 0 && <span className="pending-count" aria-label={task.attentionCount + ' 项待处理请求'}>{task.attentionCount} 待处理</span>}
    {metrics && <span className="capsule-metrics" title={metricsTitle}><b>{metrics.turns}</b>轮 · <b>{metrics.steps}</b>步</span>}
    {task.total > 0 && <span className="step-count" aria-label={task.completed + '/' + task.total + ' Todo 步骤完成'}>{task.completed}/{task.total}</span>}
    {task.status === 'completed' && <span className="capsule-state">已完成</span>}
  </button>;
}
export function TaskPeek({ task, expand, approval, reconnect }: { task: Task; expand: () => void; approval: () => void; reconnect: () => void }) {
  const failure = task.status === 'disconnected' || task.status === 'error';
  const metrics = taskMetrics(task.session);
  return <section className="task-peek" data-attention={task.attentionCount > 0}>
    <button className="peek-main" aria-label="展开任务详情" onClick={expand}>
      <div className="task-heading"><h1 title={task.title}>{task.title}</h1>{task.total > 0 && <span className="step-count">{task.completed}/{task.total}</span>}</div>
      <Progress task={task} />
      <div className="current-step"><StatusOrb task={task} /><span>{failure ? task.label + '，当前内容可能已过时' : task.current.map(t => t.content).join('、') || task.label}</span></div>
      {metrics && <div className="peek-stats">
        <span><b>{metrics.turns}</b> 轮 · <b>{metrics.steps}</b> 步{metrics.tokensPerSecond !== undefined ? ' · ' + metrics.tokensPerSecond + ' tok/s' : ''}</span>
        <span><b>{formatTokens(metrics.totalTokens ?? 0)}</b> tok{metrics.cacheHitPercent !== undefined ? ' · 缓存 ' + metrics.cacheHitPercent + '%' : ''}{metrics.contextPercent !== undefined ? ' · 上下文 ' + metrics.contextPercent + '%' : ''}</span>
      </div>}
    </button>
    {failure ? <button className="attention-link" onClick={reconnect}><span className="control-label">重新连接</span> <span aria-hidden="true">↗</span></button> : task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
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
function ProcessList({ task }: { task: Task }) {
  const notes = task.session?.notes ?? [];
  const activities = task.session?.activities ?? [];
  const rows = [
    ...notes.map(note => ({ kind: 'note' as const, key: note.id, sourceSeq: note.sourceSeq, note })),
    ...activities.map(activity => ({ kind: 'tool' as const, key: activity.callId, sourceSeq: activity.sourceSeq ?? 0, activity })),
  ].sort((a, b) => b.sourceSeq - a.sourceSeq);
  if (!rows.length) return <p className="empty-state">此会话尚无过程；开始工作后，这里会按时间出现思考与工具调用。</p>;
  return <div className="activity-list process-list" role="tabpanel" aria-label="AI 工作过程">
    {rows.map(row => row.kind === 'note'
      ? <details className="process-entry" data-kind={row.note.kind} key={row.key}>
        <summary>
          <span className="entry-icon" aria-hidden="true"><Icon name={row.note.kind === 'reasoning' ? 'brain' : 'chat'} /></span>
          <span className="entry-title">{row.note.kind === 'reasoning' ? '思考' : 'DSH'}</span>
          <span className="entry-preview">{row.note.text}</span>
          <span className="entry-status" />
          <Icon name="chevron" />
        </summary>
        <p className="entry-body">{row.note.text}</p>
      </details>
      : <details className="process-entry" data-kind="tool" data-tool-status={row.activity.status ?? 'running'} key={row.key}>
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
      </details>)}
  </div>;
}
export function TaskExpanded({ task, projection, selected, select, approval, reconnect }: { task: Task; projection: Projection; selected: string; select: (id: string) => void; approval: () => void; reconnect: () => void }) {
  const rank = { in_progress: 0, pending: 1, completed: 2 };
  const [tab, setTab] = useState<'process' | 'steps'>('process');
  const metrics = taskMetrics(task.session);
  const todos = [...task.todos].sort((a, b) => rank[a.status] - rank[b.status]);
  return <section className="task-expanded">
    <div className="task-heading"><h1 title={task.title}>{task.title}</h1>
      {Object.keys(projection.sessions).length > 1 && <select className="session-picker" aria-label="选择会话" value={selected} onChange={e => select(e.target.value)}>{Object.values(projection.sessions).map(s => <option value={s.sessionId} key={s.sessionId}>{s.title}</option>)}</select>}
    </div>
    <div className="task-meta"><StatusOrb task={task} /><span>{task.label}{projection.stale ? ' · 状态可能过时' : ''}</span>{task.total > 0 && <span className="step-count">{task.completed}/{task.total} 步骤</span>}</div>
    {metrics && <div className="task-metrics">
      <span><b>{metrics.turns}</b> 轮 · <b>{metrics.steps}</b> 步</span>
      {metrics.tokensPerSecond !== undefined && <span><b>{metrics.tokensPerSecond}</b> tok/s</span>}
      {metrics.totalTokens !== undefined && <span><b>{formatTokens(metrics.totalTokens)}</b> tok</span>}
      {metrics.cacheHitPercent !== undefined && <span>缓存 <b>{metrics.cacheHitPercent}%</b></span>}
      {metrics.contextPercent !== undefined && <span>上下文 <b>{metrics.contextPercent}%</b></span>}
    </div>}
    <Progress task={task} />
    <div className="task-tabs" role="tablist" aria-label="任务详情视图">
      <button className="task-tab" role="tab" aria-selected={tab === 'process'} onClick={() => setTab('process')}>过程</button>
      <button className="task-tab" role="tab" aria-selected={tab === 'steps'} onClick={() => setTab('steps')}>步骤{task.total > 0 ? ' ' + task.completed + '/' + task.total : ''}</button>
    </div>
    {tab === 'process' ? <ProcessList task={task} /> : <>
      <ol className="todo-list" aria-label="Todo 列表">{todos.map((todo, i) => <li className={'todo ' + todo.status} key={i + todo.content} aria-current={todo.status === 'in_progress' ? 'step' : undefined}><span className="todo-symbol" aria-label={todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待开始'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span><span>{todo.content}</span></li>)}</ol>
      {!todos.length && <p className="empty-state">此会话尚无 Todo，不显示百分比。</p>}
    </>}
    {task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
    {(task.status === 'disconnected' || task.status === 'error') && <button className="attention-link" onClick={reconnect}><span className="control-label">检查连接并重试</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
