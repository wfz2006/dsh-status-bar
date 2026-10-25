import { expect, it } from 'vitest';
import { initialProjection, type Projection } from '../packages/protocol/src/index';
import { mockSnapshot } from '../packages/adapters/mock/src/index';
import { ProjectionPublisher, ProjectionReceiver, type ProjectionMessage } from '../apps/desktop/src/shared/projection-channel';
function seed(count = 3): Projection {
  const frame = mockSnapshot(); if (frame.kind !== 'glass.snapshot') throw new Error('snapshot fixture');
  const original = frame.payload.sessions[0]!;
  return { ...initialProjection(), connection: 'connected', stale: false, source: 'dsh', runtimeId: original.runtimeId, epoch: 'epoch',
    sessions: Object.fromEntries(Array.from({ length: count }, (_, i) => ['s' + i, { ...structuredClone(original), sessionId: 's' + i }])) };
}
it('keeps a newly added __proto__ session as an own entry through deltas and later removal', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); const before = seed();
  receiver.accept(structuredClone(publisher.snapshot(before)));
  const session = { ...before.sessions.s0!, sessionId: '__proto__' };
  const after = { ...before, sessions: { ...before.sessions, ['__proto__']: session } };
  const next = receiver.accept(structuredClone(publisher.next(after)!)).state!;
  expect(Object.hasOwn(next.sessions, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(next.sessions)).toBe(Object.prototype);
  expect(next).toStrictEqual(after);
  const updated = { ...after, sessions: { ...after.sessions, ['__proto__']: { ...session, title: 'Updated safely' } } };
  expect(receiver.accept(structuredClone(publisher.next(updated)!)).state).toStrictEqual(updated);
  expect(receiver.accept(structuredClone(publisher.next(before)!)).state).toStrictEqual(before);
});
it('sends only the changed session and preserves unchanged nested arrays across real structured clones', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); const before = seed(100);
  const initial = receiver.accept(structuredClone(publisher.snapshot(before))).state!;
  const after = { ...before, seen: ['message'], sessions: { ...before.sessions, s0: { ...before.sessions.s0!, title: 'Changed', lastSourceSeq: 99 } } };
  const delta = publisher.next(after)!; expect(delta.kind).toBe('delta');
  const next = receiver.accept(structuredClone(delta)).state!; expect(next).toEqual(after);
  expect(next.sessions.s1).toBe(initial.sessions.s1); expect(next.sessions.s0?.todos).toBe(initial.sessions.s0?.todos);
  expect(Buffer.byteLength(JSON.stringify(delta))).toBeLessThan(Buffer.byteLength(JSON.stringify(after)) / 15);
});
it('requests a fresh snapshot on gaps, rejects duplicates, and ignores a late sync response', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); let state = seed();
  receiver.accept(publisher.snapshot(state)); const first = publisher.next({ ...state, seen: ['one'] })!;
  state = { ...state, seen: ['one', 'two'] }; const missingBase = publisher.next(state)!;
  expect(receiver.accept(missingBase)).toEqual({ needsSync: true });
  const sync = publisher.snapshot(state); expect(receiver.accept(sync).state).toEqual(state);
  expect(receiver.accept(first)).toEqual({ needsSync: false });
  const latest = { ...state, stale: true }; receiver.accept(publisher.next(latest)!);
  expect(receiver.accept(sync)).toEqual({ needsSync: false }); expect(receiver.current).toEqual(latest);
});
it('periodically repairs the baseline and starts a full baseline for each source epoch', () => {
  const publisher = new ProjectionPublisher(3); const state = seed(); publisher.snapshot(state);
  expect(publisher.next({ ...state, seen: ['1'] })?.kind).toBe('delta');
  expect(publisher.next({ ...state, seen: ['2'] })?.kind).toBe('delta');
  expect(publisher.next({ ...state, seen: ['3'] })?.kind).toBe('snapshot');
  expect(publisher.next({ ...state, epoch: 'next' })?.kind).toBe('snapshot');
});
it('applies deletion, cleared request arrays, failed connections and truncated seen windows exactly', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); const before = seed();
  before.seen = Array.from({ length: 512 }, (_, i) => 'frame' + i);
  receiver.accept(structuredClone(publisher.snapshot(before)));
  const after = { ...before, connection: 'disconnected' as const, stale: true, sessions: { s1: before.sessions.s1! }, approvals: [], questions: [],
    removedSessions: { s0: 55, s2: 56 }, seen: [...before.seen.slice(3), 'a', 'b', 'c'] };
  expect(receiver.accept(structuredClone(publisher.next(after)!)).state).toEqual(after);
  const stale: ProjectionMessage = { kind: 'delta', revision: 1, baseRevision: 0, fields: { stale: false }, sessions: {}, removed: [], seen: { append: [] } };
  expect(receiver.accept(stale)).toEqual({ needsSync: false }); expect(receiver.current).toEqual(after);
});
it('streams one note without serializing unchanged history, todos or activities', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); const before = seed();
  const session = before.sessions.s0!;
  session.todos = Array.from({ length: 1000 }, (_, i) => ({ content: 'todo ' + i, status: 'pending' }));
  session.notes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i, kind: 'message', text: 'history '.repeat(240), sourceSeq: i }));
  const initial = receiver.accept(structuredClone(publisher.snapshot(before))).state!;
  const nextSession = structuredClone(session);
  nextSession.notes![0] = { ...nextSession.notes![0]!, text: 'new token', streaming: true };
  nextSession.lastSourceSeq++;
  const after = { ...before, sessions: { ...before.sessions, s0: nextSession } };
  const delta = publisher.next(after)!;
  expect(Buffer.byteLength(JSON.stringify(delta))).toBeLessThan(1000);
  const next = receiver.accept(structuredClone(delta)).state!;
  expect(next).toEqual(after);
  expect(next.sessions.s0!.todos).toBe(initial.sessions.s0!.todos);
  expect(next.sessions.s0!.activities).toBe(initial.sessions.s0!.activities);
  expect(next.sessions.s0!.notes![1]).toBe(initial.sessions.s0!.notes![1]);
});
it('preserves array order, duplicate row IDs, truncation and removal of optional session fields', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); let state = seed();
  state.sessions.s0!.notes = [0, 1, 2].map(i => ({ id: 'same', kind: 'message', text: String(i), sourceSeq: i }));
  state.sessions.s0!.stats = { turns: 2, steps: 4 };
  receiver.accept(structuredClone(publisher.snapshot(state)));
  const variants = [
    { ...state.sessions.s0!, notes: [...state.sessions.s0!.notes!].reverse(), stats: { turns: 3, steps: 4 } },
    { ...state.sessions.s0!, notes: state.sessions.s0!.notes!.slice(1), activities: [] },
    { ...state.sessions.s0!, notes: [], stats: undefined },
    { ...state.sessions.s0! },
  ];
  delete variants[3]!.notes; delete variants[3]!.stats;
  for (const session of variants) {
    state = { ...state, sessions: { ...state.sessions, s0: session } };
    expect(receiver.accept(structuredClone(publisher.next(state)!)).state).toStrictEqual(state);
  }
});
it('reconstructs mixed streaming, request changes, new sessions and periodic baselines exactly', () => {
  const publisher = new ProjectionPublisher(17); const receiver = new ProjectionReceiver(); let state = seed();
  receiver.accept(structuredClone(publisher.snapshot(state)));
  for (let i = 0; i < 100; i++) {
    const session = structuredClone(state.sessions.s0!);
    session.lastSourceSeq++;
    session.notes = [{ id: 'n' + i % 7, kind: 'reasoning' as const, text: String(i), sourceSeq: i }, ...(session.notes ?? [])].slice(0, 8);
    if (i % 3 === 0) session.activities = [{ callId: 'a' + i, toolName: 'read', summary: String(i), sourceSeq: i }, ...session.activities].slice(0, 4);
    if (i % 5 === 0) session.todos = session.todos.slice(1);
    const sessions: Projection['sessions'] = { ...state.sessions, s0: session };
    if (i % 10 === 0) sessions.temporary = { ...session, sessionId: 'temporary' }; else delete sessions.temporary;
    state = { ...state, sessions, stale: i % 11 === 0, seen: [...state.seen, String(i)] };
    expect(receiver.accept(structuredClone(publisher.next(state)!)).state).toStrictEqual(state);
  }
});
it('resynchronizes without partially applying a session patch when its baseline is missing', () => {
  const publisher = new ProjectionPublisher(); const receiver = new ProjectionReceiver(); const before = seed();
  const baseline = publisher.snapshot(before);
  if (baseline.kind !== 'snapshot') throw new Error('fixture');
  receiver.accept({ ...baseline, projection: { ...before, sessions: {} } });
  const after = { ...before, sessions: { ...before.sessions, s0: { ...before.sessions.s0!, title: 'changed' } } };
  const delta = publisher.next(after)!;
  expect(receiver.accept(structuredClone(delta))).toEqual({ needsSync: true });
  expect(receiver.current!.sessions).toEqual({}); expect(receiver.version).toBe(baseline.revision);
  expect(receiver.accept(structuredClone(publisher.snapshot(after))).state).toStrictEqual(after);
});
