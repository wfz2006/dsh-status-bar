import { afterEach, expect, it, vi } from 'vitest';
import { createMockAdapter } from '../packages/adapters/mock/src/index';
import type { Frame } from '../packages/protocol/src/index';
afterEach(() => vi.useRealTimers());
it('retains the entire long preview without claiming complete parameters or control', () => {
  vi.useFakeTimers();
  const adapter = createMockAdapter(() => {}, () => {}, 'long-approval');
  adapter.start(); vi.advanceTimersByTime(10000);
  const snapshot = adapter.snapshot();
  if (snapshot.kind !== 'glass.snapshot') throw new Error('fixture');
  const approval = snapshot.payload.approvals[0];
  expect(approval?.commandPreview?.split('\n')).toHaveLength(31);
  expect(approval?.commandPreview?.endsWith('# END OF MOCK PREVIEW')).toBe(true);
  expect(approval?.displayDetails).toBe('partial'); expect(approval?.actionable).toBe(false);
  adapter.stop();
});
it('completed fixture reconnects to a genuine finished phase, independent of Todo counts', () => {
  vi.useFakeTimers();
  const adapter = createMockAdapter(() => {}, () => {}, 'completed');
  adapter.start(); vi.advanceTimersByTime(10000);
  const snapshot = adapter.snapshot();
  if (snapshot.kind !== 'glass.snapshot') throw new Error('fixture');
  expect(snapshot.payload.sessions[0]?.phase).toBe('finished');
  expect(snapshot.payload.approvals).toHaveLength(0);
  adapter.stop();
});
it('retains concurrent approval identities in authoritative reconnect snapshots', () => {
  vi.useFakeTimers();
  const adapter = createMockAdapter(() => {}, () => {}, 'approval-queue');
  adapter.start(); vi.advanceTimersByTime(10000);
  const snapshot = adapter.snapshot();
  if (snapshot.kind !== 'glass.snapshot') throw new Error('fixture');
  expect(snapshot.payload.approvals.map(a => a.requestId)).toEqual(['mock-approval-1', 'mock-approval-2']);
  adapter.stop();
});
it('reconnect snapshot retains the latest whole Todo list and pending set', () => {
  vi.useFakeTimers();
  const received: Frame[] = [];
  const adapter = createMockAdapter(f => received.push(f), () => {}, 'out-of-order');
  adapter.start(); vi.advanceTimersByTime(10000);
  const snapshot = adapter.snapshot();
  if (snapshot.kind !== 'glass.snapshot') throw new Error('expected snapshot');
  expect(snapshot.payload.sessions[0]?.todos.map(t => t.content)).toEqual(['梳理项目与接口边界', '验证悬浮窗与状态同步']);
  expect(snapshot.payload.approvals).toHaveLength(1);
  expect(received).toHaveLength(5);
  adapter.stop(); vi.advanceTimersByTime(10000); expect(received).toHaveLength(5);
});
it('disconnect scenario closes once and never fabricates an outcome', () => {
  vi.useFakeTimers();
  let disconnected = 0; const frames: Frame[] = [];
  const adapter = createMockAdapter(f => frames.push(f), () => { disconnected++; }, 'disconnect');
  adapter.start(); vi.advanceTimersByTime(20000);
  expect(disconnected).toBe(1);
  expect(frames.filter(f => f.kind === 'approval.requested').map(f => f.payload.status)).toEqual(['pending']);
  adapter.stop();
});
