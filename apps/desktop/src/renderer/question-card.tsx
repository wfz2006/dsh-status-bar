import { useRef, useState } from 'react';
import type { Question } from '@glass/protocol';
import type { Task } from './task-views';
import { questionAnswers, requestIdentity, requestKey } from './request-model';
import { ApprovalCard } from './approval-card';
import { Icon } from './icon';

function QuestionForm({ request, disconnected }: { request: Question; disconnected: boolean }) {
  const [values,setValues]=useState<Record<string,string[]>>({});
  const [custom,setCustom]=useState<Record<string,string>>({});
  const [stage,setStage]=useState<'idle'|'busy'|'sent'|'error'>('idle');
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
        <input type={q.type==='multiple'?'checkbox':'radio'} name={q.id} checked={(values[q.id]??[]).includes(option.label)} onChange={event=>{
          const checked=event.target.checked;
          setValues(current=>({...current,[q.id]:q.type==='single'?[option.label]:checked?[...(current[q.id]??[]),option.label]:(current[q.id]??[]).filter(value=>value!==option.label)}));
          if(q.type==='single')setCustom(current=>({...current,[q.id]:''}));
        }}/><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
      </label>)}</div>}
      {(q.type==='freeText' || q.allowCustom) && <label className="question-custom"><span>{q.type==='freeText'?'你的回答':'其他回答'}</span>
        <textarea rows={2} maxLength={4096} value={custom[q.id]??''} onChange={event=>{
          setCustom(current=>({...current,[q.id]:event.target.value}));
          if(q.type==='single')setValues(current=>({...current,[q.id]:[]}));
        }} placeholder={q.type==='freeText'?'输入回答…':'也可以输入自己的答案…'}/></label>}
    </fieldset>)}</div>
    <footer className="approval-footer" data-request-id={request.requestId} data-session-id={request.sessionId} data-stage={busy ? 'waiting' : stage}>
      <p className="safety-note" role="status">{disconnected?'连接已断开，暂不可提交。':stage==='error'?'提交未确认，请在 DSH 中核实或重试。':busy?'已提交，等待 DSH 确认结果…':!request.actionable?'当前问题只读，请在 DSH 中回答。':!complete?'请回答所有问题后提交。':'回答仅发送给当前会话。'}</p>
      <button className="quiet-button question-submit" type="submit" disabled={!enabled || !complete}><span className="control-label">{busy?'等待确认…':'提交回答'}</span></button>
    </footer>
  </form>;
}
function QuestionCard({task}:{task:Task}) {
  const [selected,setSelected]=useState<string|null>(null);
  const request=task.questions.find(q=>requestKey(q)===selected)??task.questions[0];
  return <>
    {task.questions.length>1 && <nav className="request-selector" aria-label="问题请求队列">{task.questions.map((q,index)=><button className="quiet-button" key={requestKey(q)} onClick={()=>setSelected(requestKey(q))} aria-current={q===request?'true':undefined}><span className="control-label">问题 {index+1}</span></button>)}</nav>}
    {request && <QuestionForm key={requestKey(request)} request={request} disconnected={task.status==='disconnected'}/>}
  </>;
}
export function RequestPanel({task,openDSH}:{task:Task;openDSH:()=>void}) {
  const [kind,setKind]=useState<'approval'|'question'>('approval');
  const approvalCount=task.pending.length;
  const hasApproval=approvalCount>0;
  const hasQuestion=task.questions.length>0;
  const displayed=hasApproval&&hasQuestion?kind:hasQuestion?'question':'approval';
  const approval=task.pending.length&&hasApproval?task.pending[0]:undefined;
  const question=task.questions[0];
  return <section className="approval-view request-panel" aria-label="待处理请求">
    <header className="approval-header">
      <div className="approval-headline">
        <span className="approval-mark" aria-hidden="true"><Icon name="shield" /></span>
        <h1>{displayed==='question' ? (question?'需要你的回答':'目前没有待回答问题') : (approval?'需要你的确认':'目前没有待处理请求')}</h1>
        {displayed==='approval' && approvalCount>1 && <span className="step-count">{approvalCount} 项</span>}
      </div>
      <p className="request-session" title={task.title}>{task.title}</p>
    </header>
    {hasApproval && hasQuestion && <nav className="request-kind" aria-label="请求类型">
      <button className="text-button" aria-pressed={displayed==='approval'} onClick={()=>setKind('approval')}><span className="control-label">确认 {approvalCount}</span></button>
      <button className="text-button" aria-pressed={displayed==='question'} onClick={()=>setKind('question')}><span className="control-label">回答 {task.questions.length}</span></button>
    </nav>}
    <div className="request-content" hidden={displayed!=='approval'}><ApprovalCard task={task} openDSH={openDSH}/></div>
    <div className="request-content" hidden={displayed!=='question'}><QuestionCard task={task}/></div>
  </section>;
}
