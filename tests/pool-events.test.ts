import { expect, it } from 'vitest';
import { initialProjection, reduceProjection, type Frame } from '../packages/protocol/src/index';
import { mockWelcome, mockSnapshot } from '../packages/adapters/mock/src/index';
import { poolEvent } from '../apps/desktop/src/shared/pool-events';

it('only celebrates the current live transition, never a snapshot, a duplicate, or another session', () => {
  const first = reduceProjection(initialProjection(), mockWelcome());
  const state = reduceProjection(first, mockSnapshot());
  const session = state.sessions['demo-main']!;
  const end: Frame = { ...mockSnapshot(), messageId: 'live-end', kind: 'session.updated', payload: {
    sessionId: session.sessionId, sourceSeq: session.lastSourceSeq + 1, fields: { agentStatus:'idle', phase:'finished' } } };
  const done = reduceProjection(state, end);
  expect(poolEvent(state, done, end, session.sessionId)).toBe('completed');
  expect(poolEvent(first, done, mockSnapshot(), session.sessionId)).toBeUndefined();
  expect(poolEvent(done, reduceProjection(done,end), end, session.sessionId)).toBeUndefined();
  expect(poolEvent(state, done, end, 'another')).toBeUndefined();
  const idleBeforeEnd = {...state,sessions:{...state.sessions,[session.sessionId]:{...session,phase:'unknown' as const,agentStatus:'idle' as const}}};
  expect(poolEvent(idleBeforeEnd,done,end,session.sessionId,true)).toBe('completed');
  expect(poolEvent(state,done,end,session.sessionId,false)).toBeUndefined();
});

it('nudges once for a new pending request in a different session', () => {
  const state = reduceProjection(reduceProjection(initialProjection(), mockWelcome()), mockSnapshot());
  const id = 'demo-main';
  const frame: Frame = { ...mockSnapshot(), messageId:'new-question', kind:'question.requested', payload:{
    runtimeId:state.runtimeId!,sourceEpoch:state.epoch!,sessionId:id,requestId:'same-call',status:'pending',
    createdAt:new Date(0).toISOString(),questions:[{id:'q',question:'Pick?',type:'freeText'}],
  } };
  const next = reduceProjection(state,frame);
  expect(poolEvent(state,next,frame,'other')).toBe('other-request');
  expect(poolEvent(state,next,frame,id)).toBeUndefined();
  expect(poolEvent(next,reduceProjection(next,frame),frame,'other')).toBeUndefined();
});
