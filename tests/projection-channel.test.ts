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
