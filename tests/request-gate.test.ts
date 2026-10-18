import { describe, expect, it } from 'vitest';
import { initialProjection, type Projection } from '../packages/protocol/src/index';
import { assertApprovalResponse, assertQuestionResponse } from '../apps/desktop/src/main/request-gate';

const identity = { runtimeId: 'runtime', sourceEpoch: 'epoch', sessionId: 'session', requestId: 'request' };
function fixture(): Projection {
  return { ...initialProjection(), connection: 'connected', stale: false, source: 'dsh', runtimeId: 'runtime', epoch: 'epoch',
    capabilities: { observeSessions: true, observeTodos: true, observeTools: true, respondApproval: true, respondQuestion: true },
    sessions: { session: { runtimeId: 'runtime', sessionId: 'session', title: '', workspaceLabel: '', agentStatus: 'running',
      phase: 'waiting-approval', todos: [], lastSourceSeq: 4, activities: [] } },
    approvals: [{ ...identity, reason: '', toolName: 'bash', displayDetails: 'complete', status: 'pending', actionable: true, createdAt: '2026-10-18T00:00:00Z' }],
    questions: [{ ...identity, status: 'pending', actionable: true, createdAt: '2026-10-18T00:00:00Z', questions: [
      { id: 'single', question: 'One', type: 'single', options: [{ label: 'A' }, { label: 'B' }] },
      { id: 'multiple', question: 'Several', type: 'multiple', options: [{ label: 'X' }, { label: 'Y' }] },
      { id: 'free', question: 'Text', type: 'freeText' },
    ] }] };
}
const answers = () => [{ questionId: 'single', values: ['A'] }, { questionId: 'multiple', values: ['X', 'Y'] }, { questionId: 'free', values: ['文字答复'] }];

describe('main request response gate', () => {
  it('returns detached validated input without changing projection', () => {
    const state = fixture(); const before = structuredClone(state); const input = answers();
    const approval = assertApprovalResponse(state, identity, 'allowed-once');
    const question = assertQuestionResponse(state, identity, input);
    input[0]!.values.push('B');
    expect(approval).toEqual({ identity, outcome: 'allowed-once' });
    expect(question.answers[0]!.values).toEqual(['A']);
    expect(state).toEqual(before);
  });

  it('rejects stale or disconnected state, mock sources, and revoked capabilities', () => {
    for (const patch of [{ connection: 'disconnected' as const }, { stale: true }, { source: 'mock' as const },
      { capabilities: { ...fixture().capabilities, respondApproval: false, respondQuestion: false } }]) {
      const state = { ...fixture(), ...patch };
      expect(() => assertApprovalResponse(state, identity, 'rejected')).toThrow();
      expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
    }
  });

  it('rejects old epochs, cross runtime/session/request identities and injected properties', () => {
    for (const value of [{ ...identity, sourceEpoch: 'old' }, { ...identity, runtimeId: 'other' },
      { ...identity, sessionId: 'other' }, { ...identity, requestId: 'other' }, { ...identity, token: 'private' },
      Object.create(identity), { ...identity, sessionId: '__proto__' }, { ...identity, requestId: 'x'.repeat(201) }]) {
      expect(() => assertApprovalResponse(fixture(), value, 'allowed-once')).toThrow();
      expect(() => assertQuestionResponse(fixture(), value, answers())).toThrow();
    }
    const getter = { ...identity };
    Object.defineProperty(getter, 'requestId', { enumerable: true, get() { throw new Error('must not execute accessor'); } });
    expect(() => assertApprovalResponse(fixture(), getter, 'rejected')).toThrow('请求已失效');
  });

  it('rechecks request and session lifetimes even if UI retained an enabled button', () => {
    for (const phase of ['finished', 'limit-reached', 'error', 'cancelled', 'archived'] as const) {
      const state = fixture(); state.sessions.session!.phase = phase;
      expect(() => assertApprovalResponse(state, identity, 'rejected')).toThrow();
      expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
    }
    for (const status of ['submitting', 'rejected', 'expired', 'unavailable', 'cancelled'] as const) {
      const state = fixture(); state.approvals[0]!.status = status;
      expect(() => assertApprovalResponse(state, identity, 'allowed-once')).toThrow();
    }
    const state = fixture(); state.questions[0]!.status = 'submitting';
    expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
  });

  it('requires complete actionable unique approvals and only an explicit allow-once or reject', () => {
    for (const patch of [{ actionable: false }, { displayDetails: 'partial' as const }, { sourceEpoch: 'old' }]) {
      const state = fixture(); Object.assign(state.approvals[0]!, patch);
      expect(() => assertApprovalResponse(state, identity, 'allowed-once')).toThrow();
    }
    const state = fixture(); state.approvals.push({ ...state.approvals[0]! });
    expect(() => assertApprovalResponse(state, identity, 'rejected')).toThrow();
    for (const outcome of ['always-allow', true, 'unavailable', undefined]) expect(() => assertApprovalResponse(fixture(), identity, outcome)).toThrow();
  });

  it('rejects removal, identity replacement and duplicate or already settled question requests', () => {
    const removed = fixture(); delete removed.sessions.session;
    const replaced = fixture(); replaced.sessions.session!.runtimeId = 'new-runtime';
    const duplicate = fixture(); duplicate.questions.push({ ...duplicate.questions[0]! });
    const mismatched = fixture(); mismatched.questions[0]!.sourceEpoch = 'old';
    for (const state of [removed, replaced, duplicate, mismatched]) {
      expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
    }
    for (const status of ['answered', 'expired', 'unavailable', 'cancelled'] as const) {
      const state = fixture(); state.questions[0]!.status = status;
      expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
    }
    const state = fixture(); state.questions[0]!.questions[1]!.id = 'single';
    expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
  });

  it('enforces each response capability independently', () => {
    const state = fixture(); state.capabilities.respondApproval = false;
    expect(() => assertApprovalResponse(state, identity, 'rejected')).toThrow();
    expect(assertQuestionResponse(state, identity, answers()).answers).toHaveLength(3);
    state.capabilities.respondApproval = true; state.capabilities.respondQuestion = false;
    expect(assertApprovalResponse(state, identity, 'rejected').outcome).toBe('rejected');
    expect(() => assertQuestionResponse(state, identity, answers())).toThrow();
  });

  it('requires exactly one answer for every known question, with known choice values', () => {
    const invalid = [answers().slice(1), [...answers(), answers()[0]], [answers()[0], answers()[0], answers()[2]],
      [{ questionId: 'unknown', values: ['A'] }, ...answers().slice(1)],
      [{ questionId: 'single', values: ['A', 'B'] }, ...answers().slice(1)],
      [{ questionId: 'single', values: ['unknown'] }, ...answers().slice(1)],
      [answers()[0], { questionId: 'multiple', values: ['X', 'X'] }, answers()[2]],
      [answers()[0], { questionId: 'multiple', values: [] }, answers()[2]],
      [answers()[0], answers()[1], { questionId: 'free', values: ['   '] }],
      [answers()[0], answers()[1], { questionId: 'free', values: ['x'.repeat(4097)] }],
      [answers()[0], answers()[1], { questionId: 'free', values: ['first', 'second'] }]];
    for (const answer of invalid) expect(() => assertQuestionResponse(fixture(), identity, answer)).toThrow();
  });

  it('accepts custom choices only when explicitly supported and rejects malformed answer objects', () => {
    const state = fixture(); state.questions[0]!.questions[0]!.allowCustom = true;
    const input = answers(); input[0]!.values = ['custom'];
    expect(assertQuestionResponse(state, identity, input).answers[0]!.values).toEqual(['custom']);
    expect(() => assertQuestionResponse(state, identity, [{ ...input[0], outcome: 'allowed-once' }, ...input.slice(1)])).toThrow();
    state.questions[0]!.actionable = false;
    expect(() => assertQuestionResponse(state, identity, input)).toThrow();
  });

  it('never reflects arbitrary rejected input into an error', () => {
    const secret = 'private-user-content';
    try { assertApprovalResponse(fixture(), { ...identity, requestId: secret }, 'allowed-once'); }
    catch (error) { expect(String(error)).not.toContain(secret); return; }
    throw new Error('Invalid identity was accepted');
  });
});
