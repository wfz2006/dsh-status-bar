import { expect, it } from 'vitest';
import { initialProjection, reduceProjection, type Question } from '../packages/protocol/src/index';
import { mockWelcome, mockSnapshot } from '../packages/adapters/mock/src/index';
import { deriveTask } from '../apps/desktop/src/shared/view-model';
import type { SubmissionResult } from '../apps/desktop/src/shared/api';
import { activePoolRequest, poolRequestReaction } from '../apps/desktop/src/renderer/pool-request-reaction';
import { requestKey } from '../apps/desktop/src/renderer/request-model';

it('matches receipt, active tab and source lifetime even when both sessions reuse a title or request ID', () => {
  const base = reduceProjection(reduceProjection(initialProjection(),mockWelcome()),mockSnapshot());
  const selected = 'demo-main';
  const identity = { sessionId:selected, runtimeId:base.runtimeId!, sourceEpoch:base.epoch!, requestId:'q' };
  const q: Question = { ...identity, status:'pending', actionable:true, createdAt:new Date(0).toISOString(),
    questions:[{ id:'one', question:'回答', type:'freeText' }] };
  const p = { ...base, questions:[q], approvals:[] };
  const task = deriveTask(p,selected);
  const receipt: SubmissionResult = { id:'1', kind:'question', identity, sessionTitle:'相同标题', status:'submitting' };
  expect(poolRequestReaction(task,p,selected,[])).toBe('answering');
  expect(poolRequestReaction(task,p,selected,[receipt])).toBe('submitting');
  for (const mismatch of [{sessionId:'another'},{sourceEpoch:'old'},{runtimeId:'old'},{requestId:'other'}]) {
    expect(poolRequestReaction(task,p,selected,[{...receipt,identity:{...identity,...mismatch}}])).toBe('answering');
  }
  expect(poolRequestReaction(task,p,selected,[{...receipt,status:'confirmed'}])).toBe('sent');
  expect(poolRequestReaction(task,p,selected,[{...receipt,status:'unconfirmed'}])).toBe('unconfirmed');
  const readonly = {...p, questions:[{...q,actionable:false}]};
  expect(poolRequestReaction(deriveTask(readonly,selected),readonly,selected,[])).toBe('readonly');
  const both = {...p,approvals:[{...identity,requestId:'approval',toolName:'read',createdAt:q.createdAt,reason:'求确认',
    status:'pending' as const,actionable:true,displayDetails:'complete' as const}]};
  const queue = deriveTask(both,selected);
  expect(poolRequestReaction(queue,both,selected,[],activePoolRequest(queue,{kind:'question',key:requestKey(q)}))).toBe('answering');
  expect(activePoolRequest(queue,{kind:'question',key:'previous session'})).toBe(both.approvals[0]);
  expect(poolRequestReaction(deriveTask(both,selected),both,selected,[])).toBe('approval');
  expect(poolRequestReaction(task,{...p,stale:true},selected,[receipt])).toBeUndefined();
});
