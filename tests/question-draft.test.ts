import { expect, it } from 'vitest';
import type { Question } from '../packages/protocol/src/index';
import { initialProjection } from '../packages/protocol/src/index';
import { questionAnswers, requestKey } from '../apps/desktop/src/renderer/request-model';
import { useGlass } from '../apps/desktop/src/renderer/store';

const request = (id: string): Question => ({ runtimeId: 'r', sourceEpoch: 'e', sessionId: 's', requestId: 'q', createdAt: '2026-10-25T00:00:00Z', status: 'pending', actionable: true,
  questions: [{ id, question: 'Choose', type: 'single', options: [{ label: 'A' }], allowCustom: true }] });
it.each(['__proto__', 'constructor', 'toString'])('treats a valid question id %s as an empty draft, not an inherited object', id => {
  expect(questionAnswers(request(id), {}, {})).toEqual([{ questionId: id, values: [] }]);
  expect(questionAnswers(request(id), { [id]: ['A'] }, {})).toEqual([{ questionId: id, values: ['A'] }]);
  expect(questionAnswers(request(id), {}, { [id]: ' typed answer ' })).toEqual([{ questionId: id, values: ['typed answer'] }]);
});

it('keeps drafts for each pending request across session changes and prunes on resolution or a new epoch', () => {
  const a = request('same');
  const b = { ...a, sessionId: 'b' };
  const projection = { ...initialProjection(), runtimeId: 'r', epoch: 'e', questions: [a, b] };
  const { replace, updateDraft } = useGlass.getState();
  replace({ ...projection, selectedSession: a.sessionId });
  updateDraft(requestKey(a), draft => ({ ...draft, custom: { same: 'draft A' } }));
  replace({ ...projection, selectedSession: b.sessionId });
  expect(useGlass.getState().drafts[requestKey(b)]).toBeUndefined();
  updateDraft(requestKey(b), draft => ({ ...draft, values: { same: ['A'] } }));
  replace({ ...projection, selectedSession: a.sessionId });
  expect(useGlass.getState().drafts[requestKey(a)]?.custom).toEqual({ same: 'draft A' });
  expect(useGlass.getState().drafts[requestKey(b)]?.values).toEqual({ same: ['A'] });
  replace({ ...projection, questions: [{ ...a, status: 'answered' }, b] });
  updateDraft(requestKey(a), draft => ({ ...draft, custom: { same: 'late' } }));
  expect(Object.keys(useGlass.getState().drafts)).toEqual([requestKey(b)]);
  replace({ ...projection, epoch: 'new' });
  expect(useGlass.getState().drafts).toEqual({});
});

it('recovers only an identical durable unanswered question after a fresh snapshot from the same authenticated host', () => {
  const a = { ...request('text'), requestId: 'question:call-1' };
  const session = { runtimeId: 'r', sessionId: 's', title: 'A', workspaceLabel: 'w', agentStatus: 'running' as const,
    phase: 'waiting-question' as const, todos: [], activities: [], lastSourceSeq: 1 };
  const initial = { ...initialProjection(), connection: 'connected' as const, stale: false, runtimeId: 'r', epoch: 'e',
    draftScope: 'alpha', sessions: { s: session }, questions: [a] };
  const { replace, updateDraft } = useGlass.getState();
  const next = { ...a, runtimeId: 'r2', sourceEpoch: 'e2' };
  const restored = { ...initial, runtimeId: 'r2', epoch: 'e2', sessions: { s: { ...session, runtimeId: 'r2' } }, questions: [next] };
  function interrupt() {
    replace(initial);
    updateDraft(requestKey(a), draft => ({ ...draft, custom: { text: '原回答' } }));
    replace({ ...initialProjection(), draftScope: 'alpha' });
    expect(useGlass.getState().drafts).toEqual({});
  }
  interrupt(); replace(restored);
  expect(useGlass.getState().drafts[requestKey(next)]?.custom.text).toBe('原回答');
  for (const mismatch of [
    { ...restored, draftScope: 'another-host' }, { ...restored, questions: [] },
    { ...restored, questions: [{ ...next, questions: [{ ...next.questions[0]!, question: 'Replacement' }] }] },
    { ...restored, questions: [{ ...next, status: 'answered' as const }] },
    { ...restored, sessions: { s: { ...restored.sessions.s, phase: 'finished' as const } } },
  ]) {
    interrupt(); replace(mismatch); expect(useGlass.getState().drafts).toEqual({});
    expect(useGlass.getState().heldDrafts).toEqual({});
  }
});
