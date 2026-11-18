import { useEffect, useRef, useState } from 'react';
import type { Question } from '@glass/protocol';
import type { Task } from './task-views';
import { draftValue, EMPTY_QUESTION_DRAFT, questionAnswers, requestIdentity, requestKey, type QuestionDraft } from './request-model';
import { ApprovalCard } from './approval-card';
import { Icon } from './icon';
import { useGlass } from './store';
import type { RequestKind, SubmissionResult } from '../shared/api';

type UpdateDraft = (update: (draft: QuestionDraft) => QuestionDraft) => void;
function QuestionForm({ request, disconnected, draft, update }: { request: Question; disconnected: boolean; draft: QuestionDraft; update: UpdateDraft }) {
  const { values, custom, stage } = draft;
  const setStage = (stage: QuestionDraft['stage']) => update(current => ({ ...current, stage }));
  const submitting=useRef(false);
  const busy=request.status==='submitting' || stage==='busy' || stage==='sent';
  const enabled=request.actionable && !disconnected && !busy;
  const answers=questionAnswers(request,values,custom);
  const complete=answers.every(answer=>answer.values.length>0);
  async function submit() {
    if(!enabled || !complete || submitting.current)return;
    submitting.current=true;setStage('busy');
    try {await window.glass.respondQuestion(requestIdentity(request),answers);setStage('sent');}
    catch {setStage('error');}
    finally {submitting.current=false;}
  }
  return <form className="question-form" onSubmit={event=>{event.preventDefault();void submit();}}>
    <div className="approval-body question-body">{request.questions.map((q,index)=><fieldset className="question-field" key={q.id} disabled={!enabled}>
      <legend>{request.questions.length>1 && <span className="question-number">{index+1}. </span>}{q.question}</legend>
      {q.type!=='freeText' && <div className="question-options">{q.options?.map((option,optionIndex)=><label className="question-option" key={optionIndex}>
        <input type={q.type==='multiple'?'checkbox':'radio'} name={q.id} checked={draftValue(values,q.id,[]).includes(option.label)} onChange={event=>{
          const checked=event.target.checked;
          update(current=>({...current,values:{...current.values,[q.id]:q.type==='single'?[option.label]:checked?[...draftValue(current.values,q.id,[]),option.label]:draftValue(current.values,q.id,[]).filter(value=>value!==option.label)},
            custom:q.type==='single'?{...current.custom,[q.id]:''}:current.custom}));
        }}/><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}</div>}
      {(q.type==='freeText' || q.allowCustom) && <label className="question-custom"><span>{q.type==='freeText'?'你的回答':'其他回答'}</span>
        <textarea rows={2} maxLength={4096} value={draftValue(custom,q.id,'')} onChange={event=>{
          const text=event.target.value;
          update(current=>({...current,custom:{...current.custom,[q.id]:text},values:q.type==='single'?{...current.values,[q.id]:[]}:current.values}));
        }} placeholder={q.type==='freeText'?'输入回答…':'也可以输入自己的答案…'}/></label>}
    </fieldset>)}</div>
    <footer className="approval-footer" data-request-id={request.requestId} data-session-id={request.sessionId} data-stage={busy ? 'waiting' : stage}>
      <p className="safety-note" role="status">{disconnected?'连接已断开，暂不可提交。':stage==='error'?'DSH 未确认，请在 DSH 中核实。':busy?'等待 DSH 确认结果…':!request.actionable?'当前问题只读，请在 DSH 中回答。':!complete?'请回答所有问题后提交。':'回答仅发送给当前会话。'}</p>
      <button className="quiet-button question-submit" type="submit" disabled={!enabled || !complete}><span className="control-label">{busy?'等待确认…':'提交回答'}</span></button>
    </footer>
  </form>;
}
function QuestionCard({task,initialKey,onInspect}:{task:Task;initialKey?:string;onInspect?:(key:string)=>void}) {
  const [selected,setSelected]=useState(initialKey);
  const request=task.questions.find(q=>requestKey(q)===selected)??task.questions[0];
  const key=request?requestKey(request):'';
  useEffect(() => { if (key) onInspect?.(key); }, [key, onInspect]);
  const draft=useGlass(state=>state.drafts[key]??EMPTY_QUESTION_DRAFT);
  const updateDraft=useGlass(state=>state.updateDraft);
  return <>
    {task.questions.length>1 && <nav className="request-selector" aria-label="问题请求队列">{task.questions.map((q,index)=><button className="quiet-button" key={requestKey(q)} onClick={()=>setSelected(requestKey(q))} aria-current={q===request?'true':undefined}><span className="control-label">问题 {index+1}</span></button>)}</nav>}
    {request && <QuestionForm key={key} request={request} disconnected={task.status==='disconnected'} draft={draft} update={update=>updateDraft(key,update)}/>}
  </>;
}
export function RequestPanel({ task, openDSH, focused, submissions, dismiss, inspectApproval, inspectQuestion, inPool = false }: {
  task: Task; openDSH: () => void; focused?: { kind: RequestKind; key: string };
  submissions: SubmissionResult[]; dismiss: (id: string) => void;
  inspectApproval?: (key: string) => void; inspectQuestion?: (key: string) => void; inPool?: boolean;
}) {
  const [kind,setKind]=useState<RequestKind>(focused?.kind ?? 'approval');
  const approvalCount=task.pending.length;
  const hasApproval=approvalCount>0;
  const hasQuestion=task.questions.length>0;
  const displayed=hasApproval&&hasQuestion?kind:hasQuestion?'question':'approval';
  const approval=task.pending.length&&hasApproval?task.pending[0]:undefined;
  const question=task.questions[0];
  const previousReceipts = inPool && (hasQuestion || hasApproval) && submissions.every(r => r.status === 'confirmed');
  const receipts = submissions.map(result => <article className="submission-result" key={result.id} data-status={result.status}>
    <div><strong>{result.status === 'unconfirmed' ? 'DSH 未确认' : result.status === 'submitting' ? '正在等待 DSH 确认'
      : result.decision === 'rejected' ? 'DSH 已记录拒绝' : result.decision === 'allowed-once' ? 'DSH 已允许本次操作' : 'DSH 已确认'}</strong>
      <p>{result.kind === 'approval' ? '审批决定' : '问题回答'} · {result.sessionTitle}</p></div>
    {result.status === 'unconfirmed' && <button type="button" className="text-button" onClick={openDSH}>打开 DSH 核实</button>}
    {result.status !== 'submitting' && <button type="button" className="text-button" aria-label="关闭此提交结果" onClick={() => dismiss(result.id)}><Icon name="x" /></button>}
  </article>);
  const receiptList = submissions.length > 0 && <div className="submission-results" aria-label="DSH 提交结果" aria-live="polite">
    {previousReceipts ? <details><summary>已确认的提交（{submissions.length}）</summary>{receipts}</details> : receipts}
  </div>;
  return <section className="approval-view request-panel" aria-label="待处理请求">
    <header className="approval-header">
      <div className="approval-headline">
        <span className="approval-mark" aria-hidden="true"><Icon name="shield" /></span>
        <h1>{displayed==='question' ? (question?'需要你的回答':'目前没有待回答问题') : approval?'需要你的确认':submissions.length?'提交结果':'目前没有待处理请求'}</h1>
        {displayed==='approval' && approvalCount>1 && <span className="step-count">{approvalCount} 项</span>}
      </div>
      <p className="request-session" title={task.title}>{task.title}</p>
    </header>
    {hasApproval && hasQuestion && <nav className="request-kind" aria-label="请求类型">
      <button className="text-button" aria-pressed={displayed==='approval'} onClick={()=>setKind('approval')}><span className="control-label">确认 {approvalCount}</span></button>
      <button className="text-button" aria-pressed={displayed==='question'} onClick={()=>setKind('question')}><span className="control-label">回答 {task.questions.length}</span></button>
    </nav>}
    {!previousReceipts && receiptList}
    <div className="request-content" hidden={displayed!=='approval'}><ApprovalCard task={task} openDSH={openDSH} initialKey={focused?.kind === 'approval' ? focused.key : undefined} onInspect={displayed==='approval'?inspectApproval:undefined}/></div>
    <div className="request-content" hidden={displayed!=='question'}><QuestionCard task={task} initialKey={focused?.kind === 'question' ? focused.key : undefined} onInspect={displayed==='question'?inspectQuestion:undefined}/></div>
    {previousReceipts && receiptList}
  </section>;
}
