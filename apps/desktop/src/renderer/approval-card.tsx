import { useRef, useState } from 'react';
import type { Task } from './task-views';
import { Icon } from './icon';
import { requestIdentity, requestKey } from './request-model';
function DecisionPreview({label,tone,explain}:{label:string;tone:'allow'|'reject';explain:()=>void}) {
  const [pressed,setPressed]=useState(false);
  return <span className="decision-preview" data-no-window-drag data-pressed={pressed} tabIndex={0} role="group" aria-label={label+'，仅预览'} aria-describedby="approval-status" title="仅预览，审批通道尚未接入" onClick={explain}
    onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setPressed(true);if(!e.repeat)explain();}}} onKeyUp={()=>setPressed(false)} onBlur={()=>setPressed(false)}>
    <button className={'decision-'+tone} aria-describedby="approval-status" disabled><Icon name={tone === 'allow' ? 'check' : 'x'}/><span className="control-label">{label}</span></button>
  </span>;
}
export function ApprovalCard({ task, openDSH }: { task: Task; openDSH: () => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState({ identity: '', text: '' });
  const [blocked,setBlocked]=useState({identity:'',text:''});
  const [submissions,setSubmissions]=useState<Record<string,{stage:string;text:string}>>({});
  const inFlight=useRef(new Set<string>());
  const request = task.pending.find(a => requestKey(a) === selected) ?? task.pending[0];
  const key = request ? requestKey(request) : '';
  const submission=submissions[key];
  const busy=!!request && (request.status==='submitting' || !!submission && ['busy','sent'].includes(submission.stage));
  const actionable=!!request?.actionable && task.status!=='disconnected';
  async function respond(outcome:'allowed-once'|'rejected') {
    if(!request || !actionable || busy || inFlight.current.has(key))return;
    inFlight.current.add(key);setSubmissions(current=>({...current,[key]:{stage:'busy',text:'正在提交，请稍候…'}}));
    try {await window.glass.respondApproval(requestIdentity(request),outcome);setSubmissions(current=>({...current,[key]:{stage:'sent',text:'已提交，等待 DSH 确认结果…'}}));}
    catch {setSubmissions(current=>({...current,[key]:{stage:'error',text:'提交未确认，请在 DSH 中核实或重试。'}}));}
    finally {inFlight.current.delete(key);}
  }
  async function copy(sessionId: string, requestId: string) {
    try { await window.glass.copyApproval({ sessionId, requestId }); setCopyResult({ identity: key, text: '已复制预览' }); }
    catch { setCopyResult({ identity: key, text: '预览不可用' }); }
  }
  return <>
    {task.pending.length > 1 && <nav className="request-selector" aria-label="待处理请求队列">{task.pending.map((a, index) => <button key={requestKey(a)} data-request-id={a.requestId} className="quiet-button" aria-label={'查看请求 ' + (index + 1)} aria-current={a === request ? 'true' : undefined} onClick={() => setSelected(requestKey(a))}><span className="control-label">{index + 1}</span></button>)}</nav>}
    {request && <>
      <div className="approval-body"><article className="approval-card" key={key}>
        <div className="request-heading"><strong>{request.toolName === 'bash' ? '终端命令' : request.toolName}</strong><button className="text-button" onClick={() => void copy(request.sessionId, request.requestId)} disabled={!request.commandPreview}><span className="control-label">复制预览</span></button><button className="request-external" aria-label="打开 DSH" title="打开 DSH" onClick={openDSH}><Icon name="external"/></button></div>
        <pre className="command-preview" tabIndex={0} aria-label="命令预览">{request.commandPreview ?? '参数暂不可用'}</pre>
        <details className="request-details"><summary><Icon name="code"/><span>查看完整命令与请求</span><Icon name="chevron"/></summary><pre className="command-full">{request.commandPreview ?? '参数暂不可用'}</pre><p>{request.reason}</p><dl><dt>Session</dt><dd>{request.sessionId}</dd><dt>Request</dt><dd>{request.requestId}</dd><dt>Call</dt><dd>{request.callId ?? '未提供'}</dd></dl></details>
      </article></div>
      <footer className="approval-footer" data-request-id={request.requestId} data-session-id={request.sessionId}>
        <p className="safety-note" id="approval-status" role="status">{task.status === 'disconnected' ? '连接已断开，暂不可提交。' : submission ? submission.text : actionable ? '仅对当前请求生效，等待 DSH 确认后结束。' : blocked.identity===key ? blocked.text : request.displayDetails !== 'complete' ? '仅供预览 · 完整参数缺失' : '当前请求只读 · 请在 DSH 中处理'}</p>
        <div className="decision-buttons">{actionable || busy ? <>
          <button className="decision-reject" disabled={!actionable || busy} onClick={()=>void respond('rejected')}><Icon name="x"/><span className="control-label">拒绝</span></button>
          <button className="decision-allow" disabled={!actionable || busy} onClick={()=>void respond('allowed-once')}><Icon name="check"/><span className="control-label">允许一次</span></button>
        </> : <><DecisionPreview label="拒绝" tone="reject" explain={()=>setBlocked({identity:key,text:'拒绝暂不可提交：当前请求为只读。'})}/><DecisionPreview label="允许一次" tone="allow" explain={()=>setBlocked({identity:key,text:'允许暂不可提交：当前请求为只读。'})}/></>}</div>
      </footer>
    </>}
    <span className="sr-only" role="status">{copyResult.identity === key ? copyResult.text : ''}</span>
  </>;
}
