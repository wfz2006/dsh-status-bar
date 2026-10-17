import type { Projection } from '@glass/protocol';
import type { deriveTask } from '../shared/view-model';
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
  return <button className="task-capsule" aria-label={task.attentionCount ? '展开待处理请求' : '展开速览'} aria-description="可拖动；右键打开菜单。数据来源与调试状态见设置。" title={title + ' · ' + task.label + (task.attentionCount ? ' · ' + task.attentionCount + ' 项待处理' : '')} onClick={activate}>
    <StatusOrb task={task} /><span className="capsule-title">{title}</span>
    {task.attentionCount > 0 && <span className="pending-count" aria-label={task.attentionCount + ' 项待处理请求'}>{task.attentionCount} 待处理</span>}
    {task.total > 0 && <span className="step-count" aria-label={task.completed + '/' + task.total + ' Todo 步骤完成'}>{task.completed}/{task.total}</span>}
  </button>;
}
export function TaskPeek({ task, expand, approval, reconnect }: { task: Task; expand: () => void; approval: () => void; reconnect: () => void }) {
  const failure = task.status === 'disconnected' || task.status === 'error';
  return <section className="task-peek" data-attention={task.attentionCount > 0}>
    <button className="peek-main" aria-label="展开任务详情" onClick={expand}>
      <div className="task-heading"><h1 title={task.title}>{task.title}</h1>{task.total > 0 && <span className="step-count">{task.completed}/{task.total}</span>}</div>
      <Progress task={task} />
      <div className="current-step"><StatusOrb task={task} /><span>{failure ? task.label + '，当前内容可能已过时' : task.current.map(t => t.content).join('、') || task.label}</span></div>
    </button>
    {failure ? <button className="attention-link" onClick={reconnect}><span className="control-label">重新连接</span> <span aria-hidden="true">↗</span></button> : task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
export function TaskExpanded({ task, projection, selected, select, approval, reconnect }: { task: Task; projection: Projection; selected: string; select: (id: string) => void; approval: () => void; reconnect: () => void }) {
  const rank = { in_progress: 0, pending: 1, completed: 2 };
  const todos = [...task.todos].sort((a, b) => rank[a.status] - rank[b.status]);
  return <section className="task-expanded">
    <div className="task-heading"><h1 title={task.title}>{task.title}</h1>
      {Object.keys(projection.sessions).length > 1 && <select className="session-picker" aria-label="选择会话" value={selected} onChange={e => select(e.target.value)}>{Object.values(projection.sessions).map(s => <option value={s.sessionId} key={s.sessionId}>{s.title}</option>)}</select>}
    </div>
    <div className="task-meta"><StatusOrb task={task} /><span>{task.label}{projection.stale ? ' · 状态可能过时' : ''}</span>{task.total > 0 && <span className="step-count">{task.completed}/{task.total} 步骤</span>}</div>
    <Progress task={task} />
    <ol className="todo-list" aria-label="Todo 列表">{todos.map((todo, i) => <li className={'todo ' + todo.status} key={i + todo.content} aria-current={todo.status === 'in_progress' ? 'step' : undefined}><span className="todo-symbol" aria-label={todo.status === 'completed' ? '已完成' : todo.status === 'in_progress' ? '进行中' : '待开始'}>{todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◉' : '○'}</span><span>{todo.content}</span></li>)}</ol>
    {!todos.length && <p className="empty-state">此会话尚无 Todo，不显示百分比。</p>}
    {task.attentionCount > 0 && <button className="attention-link" onClick={approval}><span className="control-label">{task.attentionCount} 项{task.questions.length ? '请求待处理' : '操作需要确认'}</span> <span aria-hidden="true">↗</span></button>}
    {(task.status === 'disconnected' || task.status === 'error') && <button className="attention-link" onClick={reconnect}><span className="control-label">检查连接并重试</span> <span aria-hidden="true">↗</span></button>}
  </section>;
}
