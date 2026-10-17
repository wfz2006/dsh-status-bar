import { describe, expect, it } from 'vitest';
import { frameSchema, initialProjection, reduceProjection } from '../packages/protocol/src/index';
import { mockSnapshot, mockFrames } from '../packages/adapters/mock/src/index';

describe('schema boundary', () => {
  it('rejects unknown version and invalid Todo status', () => {
    expect(frameSchema.safeParse({ ...mockFrames()[0], protocolVersion: 2 }).success).toBe(false);
    const frame = mockFrames().find(f => f.kind === 'session.todo.snapshot');
    expect(frameSchema.safeParse({ ...frame, payload: { sessionId: 'a', sourceSeq: 3, todos: [{ content: 'x', status: 'done' }] } }).success).toBe(false);
  });
});
describe('authoritative projection', () => {
  it('rejects inherited object keys as unknown session identities', () => {
    let state = initialProjection();
    for (const f of mockFrames()) state = reduceProjection(state, f);
    const tool = mockFrames().find(f => f.kind === 'session.tool.activity');
    if (!tool || tool.kind !== 'session.tool.activity') throw new Error('fixture');
    for (const sessionId of ['toString', 'constructor', '__proto__']) {
      expect(reduceProjection(state, { ...tool, messageId: `unknown-${sessionId}`, payload: { ...tool.payload, sessionId, sourceSeq: 90 } })).toBe(state);
    }
    const approval = mockFrames().find(f => f.kind === 'approval.requested');
    if (!approval || approval.kind !== 'approval.requested') throw new Error('fixture');
    expect(reduceProjection(state, { ...approval, messageId: 'unknown-approval', payload: { ...approval.payload, sessionId: 'constructor' } })).toBe(state);
  });
  it('rejects unsolicited older snapshots after live deltas', () => {
    let state = initialProjection();
    for (const f of mockFrames()) state = reduceProjection(state, f);
    expect(reduceProjection(state, { ...mockSnapshot(), messageId: 'late-snapshot' })).toBe(state);
  });
  it('keeps multiple active Todos and does not infer session completion', () => {
    let state = initialProjection();
    for (const f of mockFrames()) state = reduceProjection(state, f);
    const base = mockFrames().find(f => f.kind === 'session.todo.snapshot')!;
    state = reduceProjection(state, { ...base, messageId: 'parallel', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 100, todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] } });
    expect(state.sessions['demo-main']?.todos.filter(t => t.status === 'in_progress')).toHaveLength(2);
    state = reduceProjection(state, { ...base, messageId: 'all-done', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 110, todos: [{ content: 'a', status: 'completed' }] } });
    expect(state.sessions['demo-main']?.phase).toBe('working');
    state = reduceProjection(state, { ...base, messageId: 'empty-todo', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 120, todos: [] } });
    expect(state.sessions['demo-main']?.todos).toHaveLength(0);
  });
  it('replaces the whole Todo list, leaving another session independent', () => {
    let state = initialProjection();
    for (const frame of mockFrames()) state = reduceProjection(state, frame);
    expect(state.sessions['demo-main']?.todos.map(t => t.content)).toEqual(['梳理项目与接口边界', '验证悬浮窗与状态同步']);
    expect(state.sessions['demo-other']?.todos.map(t => t.content)).toEqual(['整理设计参考']);
    expect(state.sessions['demo-main']?.phase).toBe('working');
  });
  it('ignores duplicate, out of order and wrong-epoch deltas', () => {
    let state = initialProjection();
    const frames = mockFrames();
    for (const frame of frames) state = reduceProjection(state, frame);
    const old = frames.find(f => f.kind === 'session.todo.snapshot');
    expect(old).toBeDefined();
    if (!old) return;
    expect(reduceProjection(state, old)).toBe(state);
    expect(reduceProjection(state, { ...old, messageId: 'new-id', epoch: 'old' })).toBe(state);
  });
  it('disconnect invalidates pending interactions; deltas cannot revive them', () => {
    let state = initialProjection();
    for (const frame of mockFrames()) state = reduceProjection(state, frame);
    state = reduceProjection(state, { kind: 'transport.closed' });
    expect(state.connection).toBe('disconnected');
    expect(state.stale).toBe(true);
    expect(state.approvals.every(a => !a.actionable)).toBe(true);
    expect(reduceProjection(state, mockFrames().at(-1)!)).toBe(state);
  });
  it('snapshot restores authoritative empty lists and clears old pending', () => {
    let state = initialProjection();
    for (const frame of mockFrames()) state = reduceProjection(state, frame);
    const snapshot = mockSnapshot();
    if (snapshot.kind !== 'glass.snapshot') throw new Error('fixture');
    const empty = { ...snapshot, messageId: 'empty', payload: { sessions: [], approvals: [] } };
    state = reduceProjection(state, { kind: 'transport.closed' });
    state = reduceProjection(state, mockFrames()[0]!);
    state = reduceProjection(state, empty);
    expect(Object.keys(state.sessions)).toHaveLength(0);
    expect(state.approvals).toHaveLength(0);
    expect(state.stale).toBe(false);
  });
});
