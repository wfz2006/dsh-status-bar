import { expect, it } from 'vitest';
import { AssistantPreview } from '../packages/adapters/dsh/src/assistant-preview';

const start = { type: 'start', revision: 1, attemptId: 'attempt', turn: 2, step: 3, startedAfterSeq: 10 };
const delta = (revision: number, index: number, text: string, block = 0) => ({ type: 'chunk', attemptId: 'attempt', revision, index, chunk: { type: 'text-delta', index: block, text } });
it('updates stable preview rows, accepts final blocks, and ignores duplicate or closed deltas', () => {
  const p = new AssistantPreview(); p.accept(start); p.accept(delta(2, 0, 'partial'));
  const id = p.notes()[0]?.id;
  p.accept(delta(2, 0, 'duplicate')); p.accept(delta(3, 1, ' text'));
  expect(p.notes()).toEqual([expect.objectContaining({ id, text: 'partial text', streaming: true, sourceSeq: 11 })]);
  p.accept({ ...delta(4, 2, ''), chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'corrected final' } } });
  p.accept(delta(5, 3, 'ignored'));
  expect(p.notes()[0]?.text).toBe('corrected final');
  p.settle({ type: 'assistant/message', seq: 11, data: { turn: 2, step: 3 } });
  expect(p.notes()).toEqual([]);
});
it('bounds prefixes and block count while never projecting partial tool arguments', () => {
  const p = new AssistantPreview(); p.accept(start);
  p.accept({ ...delta(2, 0, ''), chunk: { type: 'tool-call-delta', index: 90, id: 'call', name: 'bash', argumentsDelta: '{"token":"secret"' } });
  expect(p.notes()).toEqual([]);
  for (let i = 0; i < 70; i++) p.accept(delta(i + 3, i + 1, 'x'.repeat(3000), i));
  expect(p.notes()).toHaveLength(60);
  expect(p.notes().every(n => n.text.length === 2000)).toBe(true);
  expect(JSON.stringify(p.notes())).not.toContain('secret');
});
it('discards incomplete prefixes on sequence gaps and restores the next Agent lifecycle', () => {
  const p = new AssistantPreview(); p.accept(start); p.accept(delta(2, 0, 'old'));
  p.accept(delta(4, 2, 'missing revision')); expect(p.notes()).toEqual([]);
  p.accept(delta(5, 3, 'unusable suffix')); expect(p.notes()).toEqual([]);
  p.accept(start); p.accept(delta(2, 0, 'new')); expect(p.notes()[0]?.text).toBe('new');
  p.accept({ type: 'end', attemptId: 'attempt', revision: 3, index: 1, outcome: { kind: 'abandoned' } });
  expect(p.notes()).toEqual([]);
});
it('ignores mismatched attempts and discards out-of-order chunk indices', () => {
  const p = new AssistantPreview(); p.accept(start);
  p.accept({ ...delta(2, 0, 'foreign'), attemptId: 'other' }); expect(p.notes()).toEqual([]);
  p.accept(delta(3, 1, 'missing chunk')); expect(p.notes()).toEqual([]);
});
it('restores compact reconnect snapshots and resumes at the exact next chunk', () => {
  const p = new AssistantPreview();
  p.restore({ revision: 3, activeAttempt: { ...start, nextIndex: 2, stream: [
    { type: 'reasoning-chunks', index: 0, time0: 100, dt: [10], texts: ['restore ', 'prefix'] },
  ] } });
  expect(p.notes()[0]).toMatchObject({ kind: 'reasoning', text: 'restore prefix', streaming: true });
  p.accept({ ...delta(4, 2, ''), chunk: { type: 'reasoning-delta', index: 0, text: ' live' } });
  expect(p.notes()[0]?.text).toBe('restore prefix live');
  p.settle({ type: 'assistant/attempt', seq: 11, data: { turn: 2, step: 3 } });
  expect(p.notes()).toEqual([]);
});
it('rejects malformed starts and baselines without throwing', () => {
  const p = new AssistantPreview();
  for (const startedAfterSeq of [NaN, Infinity, -2, Number.MAX_SAFE_INTEGER]) {
    p.accept({ ...start, startedAfterSeq }); p.accept(delta(2, 0, 'bad')); expect(p.notes()).toEqual([]);
  }
  p.restore({ revision: 3, activeAttempt: { ...start, nextIndex: 1, stream: [{ type: 'text-chunks', index: 0, texts: [null] }] } });
  expect(p.notes()).toEqual([]);
});
