import type { Question } from '@glass/protocol';

export type QuestionDraft = { values: Record<string, string[]>; custom: Record<string, string>; stage: 'idle' | 'busy' | 'sent' | 'error' };
export const EMPTY_QUESTION_DRAFT: QuestionDraft = { values: {}, custom: {}, stage: 'idle' };
/** Protocol IDs may coincide with inherited Object properties. */
export function draftValue<T>(values: Record<string, T>, id: string, fallback: T): T {
  return Object.hasOwn(values, id) ? values[id]! : fallback;
}

export type RequestIdentity = { runtimeId: string; sourceEpoch: string; sessionId: string; requestId: string };
export function requestIdentity(request: RequestIdentity): RequestIdentity {
  return { runtimeId: request.runtimeId, sourceEpoch: request.sourceEpoch, sessionId: request.sessionId, requestId: request.requestId };
}
export function requestKey(request: RequestIdentity) {
  return JSON.stringify([request.runtimeId, request.sourceEpoch, request.sessionId, request.requestId]);
}
export function questionAnswers(request: Question, values: Record<string, string[]>, custom: Record<string, string>) {
  return request.questions.map(q => {
    const allowed = new Set(q.options?.map(option => option.label) ?? []);
    const selected = draftValue(values, q.id, []).filter(value => allowed.has(value));
    const text = draftValue(custom, q.id, '').trim();
    const result = q.type === 'freeText' ? text ? [text] : [] : q.type === 'single' ? selected.slice(0, 1) : [...new Set(selected)];
    if (q.type !== 'freeText' && q.allowCustom && text) {
      if (q.type === 'single') result.splice(0, result.length, text);
      else if (!result.includes(text)) result.push(text);
    }
    return { questionId: q.id, values: result };
  });
}
