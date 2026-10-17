import { useState } from 'react';
import type { Task } from './task-views';
export function ApprovalCard({ task, openDSH }: { task: Task; openDSH: () => void }) {
  const [copyResult, setCopyResult] = useState('');
  async function copy(sessionId: string, requestId: string) {
    try { await window.glass.copyApproval({ sessionId, requestId }); setCopyResult('已复制预览'); }
    catch { setCopyResult('预览不可用'); }
  }
  return <section className="approval-view" aria-label="待处理请求">
    <div className="task-heading"><h1>{task.pending.length ? '需要你的确认' : '目前没有待处理请求'}</h1>{task.pending.length > 1 && <span className="step-count">{task.pending.length} 项</span>}</div>
    <p className="request-session">{task.title}</p>
    <div className="approval-queue">{task.pending.map((a, index) => <article className="approval-card" key={a.sessionId + '/' + a.requestId} data-request-id={a.requestId}>
      <div className="request-heading"><strong>{a.toolName === 'bash' ? '终端命令' : a.toolName}</strong><span>{index + 1}/{task.pending.length}</span></div>
      <pre className="command-preview" tabIndex={0} aria-label="命令预览">{a.commandPreview ?? '参数暂不可用'}</pre>
      <button className="quiet-button" onClick={() => void copy(a.sessionId, a.requestId)} disabled={!a.commandPreview}>复制预览</button>
      <details className="request-details"><summary>查看请求信息</summary><p>{a.reason}</p><dl><dt>Session</dt><dd>{a.sessionId}</dd><dt>Request</dt><dd>{a.requestId}</dd><dt>Call</dt><dd>{a.callId ?? '未提供'}</dd></dl></details>
      <p className="safety-note">{task.status === 'disconnected' ? '连接已断开，此请求不能提交。' : a.displayDetails !== 'complete' ? '仅有参数预览，完整参数不可用。请在 DSH 核实。' : '当前通道未验证审批所有权，请在 DSH 处理。'}</p>
      <div className="decision-buttons"><button disabled>拒绝</button><button disabled>允许一次</button></div>
    </article>)}</div>
    {task.pending.length > 0 && <button className="quiet-button open-original" onClick={openDSH}>查看 DSH 原窗口 ↗</button>}
    <span className="sr-only" role="status">{copyResult}</span>
  </section>;
}
