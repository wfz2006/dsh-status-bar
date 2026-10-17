import { describe, expect, it } from 'vitest';
import { frameSchema, initialProjection, reduceProjection, type Approval, type Frame, type Projection, type Question } from '../packages/protocol/src/index';
import { mockFrames, mockSnapshot, mockWelcome } from '../packages/adapters/mock/src/index';

let revision = 0;
function frame(kind: Frame['kind'], payload: unknown, overrides: Record<string, unknown> = {}): Frame {
  return frameSchema.parse({ ...mockWelcome(), kind, payload, messageId: 'lifecycle-' + ++revision, ...overrides });
}
function connected(source: 'dsh' | 'mock' = 'dsh', control = true): Projection {
  const welcome = mockWelcome();
  if (welcome.kind !== 'glass.welcome') throw new Error('fixture');
  return reduceProjection(reduceProjection(initialProjection(), { ...welcome, payload: { ...welcome.payload, source,
    capabilities: { ...welcome.payload.capabilities, respondApproval: control, respondQuestion: control } } }), mockSnapshot());
}
function approval(changes: Partial<Approval> = {}): Approval {
  const existing = mockFrames().find(f => f.kind === 'approval.requested');
  if (!existing || existing.kind !== 'approval.requested') throw new Error('fixture');
  return { ...existing.payload, displayDetails: 'complete', actionable: true, revision: 1, ...changes };
}
function question(changes: Partial<Question> = {}): Question {
  return { requestId: 'question-1', runtimeId: 'mock-runtime', sourceEpoch: 'mock-epoch-1', sessionId: 'demo-main', createdAt: '2026-10-18T00:00:00.000Z',
    status: 'pending', actionable: true, revision: 1, questions: [{ id: 'q-1', question: '选择方案', type: 'single', options: [{ label: '方案 A' }, { label: '方案 B' }] }], ...changes };
}

describe('backward-compatible source boundary', () => {
  it('normalizes missing snapshot questions and activity state', () => {
    const snapshot = frameSchema.parse(mockSnapshot());
    if (snapshot.kind !== 'glass.snapshot') throw new Error('fixture');
    expect(snapshot.payload.questions).toEqual([]);
    const tool = mockFrames().find(f => f.kind === 'session.tool.activity');
    const parsed = frameSchema.parse(tool);
    if (parsed.kind !== 'session.tool.activity') throw new Error('fixture');
    expect(parsed.payload.status).toBe('running');
    expect(initialProjection().questions).toEqual([]);
  });
  it.each(['single', 'multiple', 'freeText'] as const)('accepts the %s question shape and defaults actionable closed', type => {
    const q = question({ questions: [{ id: 'q', question: '问题', type }] });
    delete q.actionable;
    const parsed = frame('question.requested', q);
    expect(parsed.kind === 'question.requested' && parsed.payload.actionable).toBe(false);
  });
});

describe('verified source capability gates', () => {
  it.each([['mock', true, false], ['dsh', false, false], ['dsh', true, true]] as const)('%s control=%s yields actionable=%s', (source, control, expected) => {
    let p = connected(source, control);
    p = reduceProjection(p, frame('approval.requested', approval()));
    p = reduceProjection(p, frame('question.requested', question()));
    expect(p.approvals[0]?.actionable).toBe(expected);
    expect(p.questions[0]?.actionable).toBe(expected);
    p = reduceProjection(p, { kind: 'transport.closed' });
    expect(p.approvals[0]?.actionable).toBe(false);
    expect(p.questions[0]?.actionable).toBe(false);
  });
  it.each(['partial', 'unknown'] as const)('never enables approval with %s details', displayDetails => {
    const p = reduceProjection(connected(), frame('approval.requested', approval({ displayDetails })));
    expect(p.approvals[0]?.actionable).toBe(false);
  });
  it('gates approval and question capabilities independently', () => {
    const base = connected();
    const p = { ...base, capabilities: { ...base.capabilities, respondApproval: false, respondQuestion: true } };
    expect(reduceProjection(p, frame('approval.requested', approval())).approvals[0]?.actionable).toBe(false);
    expect(reduceProjection(p, frame('question.requested', question())).questions[0]?.actionable).toBe(true);
  });
  it('accepts validated actionable snapshots but rejects mismatched or duplicate identities atomically', () => {
    const base = connected();
    const waiting = reduceProjection(base, { kind: 'transport.connecting' });
    const payload = { sessions: Object.values(base.sessions), approvals: [approval()], questions: [question()] };
    const p = reduceProjection(waiting, frame('glass.snapshot', payload));
    expect(p.approvals[0]?.actionable).toBe(true); expect(p.questions[0]?.actionable).toBe(true);
    expect(reduceProjection(waiting, frame('glass.snapshot', { ...payload, questions: [question({ sourceEpoch: 'old' })] }))).toBe(waiting);
    expect(reduceProjection(waiting, frame('glass.snapshot', { ...payload, questions: [question(), question()] }))).toBe(waiting);
  });
  it('rejects old epoch, runtime and unknown session request frames', () => {
    const p = connected();
    expect(reduceProjection(p, frame('question.requested', question(), { epoch: 'old' }))).toBe(p);
    expect(reduceProjection(p, frame('question.requested', question({ runtimeId: 'other' })))).toBe(p);
    expect(reduceProjection(p, frame('approval.requested', approval({ sessionId: 'constructor' })))).toBe(p);
  });
});

describe('request lifecycle and session isolation', () => {
  it('preserves same request IDs in different sessions and never revives resolved requests', () => {
    let p = connected();
    p = reduceProjection(p, frame('approval.requested', approval()));
    p = reduceProjection(p, frame('approval.requested', approval({ sessionId: 'demo-other' })));
    p = reduceProjection(p, frame('approval.resolved', approval({ status: 'rejected', revision: 2 })));
    const resolved = p;
    expect(reduceProjection(p, frame('approval.requested', approval({ revision: 3 })))).toBe(resolved);
    expect(p.approvals.find(a => a.sessionId === 'demo-main')?.status).toBe('rejected');
    expect(p.approvals.find(a => a.sessionId === 'demo-other')?.actionable).toBe(true);
  });
  it.each(['answered', 'cancelled', 'unavailable', 'expired'] as const)('never revives a question after %s', status => {
    let p = reduceProjection(connected(), frame('question.requested', question()));
    p = reduceProjection(p, frame('question.resolved', question({ status, revision: 2 })));
    expect(p.questions[0]?.actionable).toBe(false);
    expect(reduceProjection(p, frame('question.requested', question({ revision: 9 })))).toBe(p);
  });
  it('rejects stale revisions, duplicate submitting and resolved frames carrying pending', () => {
    let p = reduceProjection(connected(), frame('question.requested', question({ status: 'submitting', revision: 2 })));
    expect(p.questions[0]?.actionable).toBe(false);
    expect(reduceProjection(p, frame('question.requested', question({ revision: 3 })))).toBe(p);
    expect(reduceProjection(p, frame('question.resolved', question({ revision: 3 })))).toBe(p);
    p = reduceProjection(p, frame('approval.requested', approval({ revision: 2 })));
    expect(reduceProjection(p, frame('approval.resolved', approval({ revision: 1, status: 'allowed-once' })))).toBe(p);
  });
  it('clears questions authoritatively on reconnect and keeps interactions closed until the snapshot', () => {
    let p = reduceProjection(connected(), frame('question.requested', question()));
    p = reduceProjection(p, { kind: 'transport.connecting' });
    expect(p.questions[0]?.actionable).toBe(false);
    expect(reduceProjection(p, frame('question.requested', question({ revision: 2 })))).toBe(p);
    p = reduceProjection(p, mockWelcome());
    p = reduceProjection(p, mockSnapshot());
    expect(p.questions).toEqual([]);
  });
});

describe('session and tool lifecycle projection', () => {
  it('upserts, renames and removes sessions without stale resurrection or orphan requests', () => {
    let p = connected();
    const original = p.sessions['demo-main']!;
    p = reduceProjection(p, frame('session.upserted', { ...original, title: '改名', lastSourceSeq: 2 }));
    expect(p.sessions['demo-main']?.title).toBe('改名');
    p = reduceProjection(p, frame('question.requested', question()));
    p = reduceProjection(p, frame('approval.requested', approval()));
    p = reduceProjection(p, frame('session.removed', { sessionId: 'demo-main', sourceSeq: 3 }));
    expect(p.sessions['demo-main']).toBeUndefined(); expect(p.questions).toEqual([]); expect(p.approvals).toEqual([]);
    expect(reduceProjection(p, frame('session.upserted', { ...original, lastSourceSeq: 2 }))).toBe(p);
    expect(reduceProjection(p, frame('session.upserted', { ...original, runtimeId: 'wrong', lastSourceSeq: 4 }))).toBe(p);
    p = reduceProjection(p, frame('session.upserted', { ...original, lastSourceSeq: 4 }));
    expect(p.sessions['demo-main']).toBeDefined();
  });
  it.each(['finished', 'error', 'cancelled', 'archived'] as const)('invalidates actionable requests when the session becomes %s', phase => {
    let p = reduceProjection(connected(), frame('approval.requested', approval()));
    p = reduceProjection(p, frame('question.requested', question()));
    p = reduceProjection(p, frame('session.updated', { sessionId: 'demo-main', sourceSeq: 2, fields: { agentStatus: 'idle', phase } }));
    expect(p.approvals[0]?.actionable).toBe(false); expect(p.questions[0]?.actionable).toBe(false);
  });
  it('updates tools by call ID, preserves another session and rejects terminal rollback', () => {
    let p = connected();
    const activity = { sessionId: 'demo-main', sourceSeq: 2, callId: 'call', toolName: 'read_file', summary: '读取文件', status: 'running' };
    p = reduceProjection(p, frame('session.tool.activity', activity));
    p = reduceProjection(p, frame('session.tool.activity', { ...activity, sourceSeq: 3, status: 'success', resultSummary: '已完成读取' }));
    expect(p.sessions['demo-main']?.activities).toHaveLength(1);
    expect(p.sessions['demo-main']?.activities[0]?.resultSummary).toBe('已完成读取');
    expect(p.sessions['demo-other']?.activities).toEqual([]);
    expect(reduceProjection(p, frame('session.tool.activity', { ...activity, sourceSeq: 4 }))).toBe(p);
    expect(reduceProjection(p, frame('session.tool.activity', { ...activity, sourceSeq: 3, callId: 'another' }))).toBe(p);
  });
  it('keeps transcript notes newest-first, deduplicated and stale-safe', () => {
    let p = connected();
    p = reduceProjection(p, frame('session.note', { sessionId: 'demo-main', note: { id: 'n1', kind: 'message', text: '第一段', sourceSeq: 2 } }));
    p = reduceProjection(p, frame('session.note', { sessionId: 'demo-main', note: { id: 'n2', kind: 'reasoning', text: '第二段', sourceSeq: 3 } }));
    expect(p.sessions['demo-main']?.notes?.slice(0, 2).map(n => n.text)).toEqual(['第二段', '第一段']);
    expect(p.sessions['demo-main']?.notes).toHaveLength(4);
    expect(reduceProjection(p, frame('session.note', { sessionId: 'demo-main', note: { id: 'n0', kind: 'message', text: '过期', sourceSeq: 2 } }))).toBe(p);
    const updated = reduceProjection(p, frame('session.note', { sessionId: 'demo-main', note: { id: 'n2', kind: 'reasoning', text: '第二段（更新）', sourceSeq: 4 } }));
    expect(updated.sessions['demo-main']?.notes?.[0]).toMatchObject({ id: 'n2', text: '第二段（更新）' });
    expect(updated.sessions['demo-main']?.notes).toHaveLength(4);
  });
});
