import type { Projection } from '@glass/protocol';

export type RequestIdentity = { runtimeId: string; sourceEpoch: string; sessionId: string; requestId: string };
export type QuestionAnswer = { questionId: string; values: string[] };

function refuse(): never { throw new Error('请求已失效、不可操作或回答格式不合法。'); }

/** Read data properties only: no inherited identity, accessors, or unexpected fields cross this boundary. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return refuse();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key))) return refuse();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return refuse();
    result[key] = descriptor.value as unknown;
  }
  return result;
}

function identityOf(value: unknown): RequestIdentity {
  const input = record(value, ['runtimeId', 'sourceEpoch', 'sessionId', 'requestId']);
  for (const field of Object.values(input)) {
    if (typeof field !== 'string' || field.length < 1 || field.length > 200 || field.trim() !== field ||
      [...field].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return refuse();
  }
  return { runtimeId: input.runtimeId as string, sourceEpoch: input.sourceEpoch as string,
    sessionId: input.sessionId as string, requestId: input.requestId as string };
}

function currentIdentity(state: Projection, value: unknown, capability: 'respondApproval' | 'respondQuestion'): RequestIdentity {
  const identity = identityOf(value);
  if (state.connection !== 'connected' || state.stale || state.source !== 'dsh' || !state.capabilities[capability] ||
    identity.runtimeId !== state.runtimeId || identity.sourceEpoch !== state.epoch || !Object.hasOwn(state.sessions, identity.sessionId)) return refuse();
  const session = state.sessions[identity.sessionId];
  if (!session || session.runtimeId !== identity.runtimeId || session.sessionId !== identity.sessionId ||
    ['finished', 'limit-reached', 'error', 'cancelled', 'archived'].includes(session.phase)) return refuse();
  return identity;
}

export function assertApprovalResponse(state: Projection, value: unknown, outcome: unknown): {
  identity: RequestIdentity; outcome: 'allowed-once' | 'rejected';
} {
  const identity = currentIdentity(state, value, 'respondApproval');
  if (outcome !== 'allowed-once' && outcome !== 'rejected') return refuse();
  const matches = state.approvals.filter(request => request.sessionId === identity.sessionId && request.requestId === identity.requestId);
  const request = matches[0];
  if (matches.length !== 1 || !request || request.runtimeId !== identity.runtimeId || request.sourceEpoch !== identity.sourceEpoch ||
    request.status !== 'pending' || !request.actionable || request.displayDetails !== 'complete') return refuse();
  return { identity, outcome };
}

export function assertQuestionResponse(state: Projection, value: unknown, answers: unknown): {
  identity: RequestIdentity; answers: QuestionAnswer[];
} {
  const identity = currentIdentity(state, value, 'respondQuestion');
  const matches = state.questions.filter(request => request.sessionId === identity.sessionId && request.requestId === identity.requestId);
  const request = matches[0];
  if (matches.length !== 1 || !request || request.runtimeId !== identity.runtimeId || request.sourceEpoch !== identity.sourceEpoch ||
    request.status !== 'pending' || !request.actionable || request.questions.length < 1 || request.questions.length > 100 ||
    new Set(request.questions.map(question => question.id)).size !== request.questions.length ||
    !Array.isArray(answers) || answers.length !== request.questions.length) return refuse();
  const seen = new Set<string>();
  let totalCharacters = 0;
  const checked: QuestionAnswer[] = [];
  for (const answer of answers) {
    const input = record(answer, ['questionId', 'values']);
    if (typeof input.questionId !== 'string' || input.questionId.length < 1 || input.questionId.length > 200 || seen.has(input.questionId)) return refuse();
    const question = request.questions.find(item => item.id === input.questionId);
    if (!question || !Array.isArray(input.values) || input.values.length < 1 || input.values.length > 100 ||
      question.type !== 'multiple' && input.values.length !== 1) return refuse();
    seen.add(input.questionId);
    const values: string[] = [];
    for (const entry of input.values) {
      if (typeof entry !== 'string' || entry.length > 4096 || entry.trim().length === 0 || values.includes(entry)) return refuse();
      totalCharacters += entry.length;
      if (totalCharacters > 65_536 || question.type !== 'freeText' && !question.allowCustom && !question.options?.some(option => option.label === entry)) return refuse();
      values.push(entry);
    }
    checked.push({ questionId: input.questionId, values });
  }
  return { identity, answers: checked };
}
