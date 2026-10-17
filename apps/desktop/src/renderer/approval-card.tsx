import { useState } from 'react';
import type { Task } from './task-views';
export function ApprovalCard({ task, openDSH }: { task: Task; openDSH: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState({ identity: '', text: '' });
  const identity = (sessionId: string, requestId: string) => JSON.stringify([sessionId, requestId]);
  const request = task.pending.find(a => identity(a.sessionId, a.requestId) === selected) ?? task.pending[0];
  const key = request ? identity(request.sessionId, request.requestId) : '';
  async function copy(sessionId: string, requestId: string) {
    try { await window.glass.copyApproval({ sessionId, requestId }); setCopyResult({ identity: identity(sessionId, requestId), text: '已复制预览' }); }
    catch { setCopyResult({ identity: identity(sessionId, requestId), text: '预览不可用' }); }
  }
  return <section className="approval-view" aria-label="待处理请求">
    <header className="approval-header"><div className="task-heading"><h1>{request ? '需要你的确认' : '目前没有待处理请求'}</h1>{task.pending.length > 1 && <span className="step-count">{task.pending.length} 项</span>}</div>
      <p className="request-session" title={task.title}>{task.title}</p></header>
    {task.pending.length > 1 && <nav className="request-selector" aria-label="待处理请求队列">{task.pending.map((a, index) => <button key={identity(a.sessionId, a.requestId)} data-request-id={a.requestId} className="quiet-button" aria-label={'查看请求 ' + (index + 1)} aria-current={a === request ? 'true' : undefined} onClick={() => setSelected(identity(a.sessionId, a.requestId))}>{index + 1}</button>)}</nav>}
    {request && <>
      <div className="approval-body"><article className="approval-card" key={key}>
        <div className="request-heading"><strong>{request.toolName === 'bash' ? '终端命令' : request.toolName}</strong><button className="text-button" onClick={() => void copy(request.sessionId, request.requestId)} disabled={!request.commandPreview}>复制预览</button></div>
        <pre className="command-preview" tabIndex={0} aria-label="命令预览">{request.commandPreview ?? '参数暂不可用'}</pre>
        <details className="request-details"><summary>查看完整命令与请求</summary><pre className="command-full">{request.commandPreview ?? '参数暂不可用'}</pre><p>{request.reason}</p><dl><dt>Session</dt><dd>{request.sessionId}</dd><dt>Request</dt><dd>{request.requestId}</dd><dt>Call</dt><dd>{request.callId ?? '未提供'}</dd></dl></details>
      </article></div>
      <footer className="approval-footer" data-request-id={request.requestId} data-session-id={request.sessionId}>
        <p className="safety-note">{task.status === 'disconnected' ? '连接已断开，无法提交。' : request.displayDetails !== 'complete' ? '仅供预览，完整参数缺失。请在 DSH 核实。' : '审批通道未验证。请在 DSH 处理。'}</p>
        <div className="decision-buttons"><button disabled>拒绝</button><button disabled>允许一次</button></div>
        <button className="text-button open-original" onClick={openDSH}>在 DSH 原窗口处理 <span aria-hidden="true">↗</span></button>
      </footer>
    </>}
    <span className="sr-only" role="status">{copyResult.identity === key ? copyResult.text : ''}</span>
  </section>;
}
