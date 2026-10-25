import { expect, it } from 'vitest';
import type { Question } from '../packages/protocol/src/index';
import { questionAnswers } from '../apps/desktop/src/renderer/request-model';

const request = (id: string): Question => ({ runtimeId: 'r', sourceEpoch: 'e', sessionId: 's', requestId: 'q', createdAt: '2026-10-25T00:00:00Z', status: 'pending', actionable: true,
  questions: [{ id, question: 'Choose', type: 'single', options: [{ label: 'A' }], allowCustom: true }] });
it.each(['__proto__', 'constructor', 'toString'])('treats a valid question id %s as an empty draft, not an inherited object', id => {
  expect(questionAnswers(request(id), {}, {})).toEqual([{ questionId: id, values: [] }]);
  expect(questionAnswers(request(id), { [id]: ['A'] }, {})).toEqual([{ questionId: id, values: ['A'] }]);
  expect(questionAnswers(request(id), {}, { [id]: ' typed answer ' })).toEqual([{ questionId: id, values: ['typed answer'] }]);
});
