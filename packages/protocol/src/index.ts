import { z } from 'zod';

const id = z.string().min(1).max(200);
const text = z.string().max(4096);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const todoSchema = z.object({ content: text, status: z.enum(['pending', 'in_progress', 'completed']) }).strict();
export const sessionStatsSchema = z.object({
  turns: seq, steps: seq,
  tokensPerSecond: z.number().nonnegative().max(1_000_000).optional(),
  cacheHitPercent: z.number().min(0).max(100).optional(),
  contextPercent: z.number().min(0).max(100).optional(),
  tokens: z.object({ input: seq, cacheRead: seq, cacheWrite: seq, output: seq, total: seq }).strict().optional(),
}).strict();
export const capabilitiesSchema = z.object({
  observeSessions: z.boolean(), observeTodos: z.boolean(), observeTools: z.boolean(),
  respondApproval: z.boolean(), respondQuestion: z.boolean(),
}).strict();
export const activitySchema = z.object({ callId: id, toolName: id, summary: text, sourceSeq: seq,
  status: z.enum(['pending', 'running', 'success', 'error', 'cancelled']).default('running'), resultSummary: text.optional() });
export const noteSchema = z.object({ id: id, kind: z.enum(['reasoning', 'message', 'user']), text: z.string().min(1).max(2000), sourceSeq: seq,
  streaming: z.boolean().optional() }).strict();
export const sessionSchema = z.object({
  runtimeId: id, sessionId: id, title: text, workspaceLabel: text,
  agentStatus: z.enum(['starting', 'running', 'stopping', 'idle', 'unknown']),
  phase: z.enum(['working', 'waiting-approval', 'waiting-question', 'finished', 'limit-reached', 'error', 'cancelled', 'archived', 'unknown']),
  todos: z.array(todoSchema).max(1000), lastSourceSeq: seq,
  activities: z.array(activitySchema).max(100),
  notes: z.array(noteSchema).max(60).optional(),
  stats: sessionStatsSchema.optional(),
});
export const approvalSchema = z.object({
  requestId: id, runtimeId: id, sessionId: id, toolName: id, callId: id.optional(),
  reason: text, commandPreview: text.optional(), displayDetails: z.enum(['complete', 'partial', 'unknown']),
  status: z.enum(['pending', 'submitting', 'allowed-once', 'rejected', 'cancelled', 'unavailable', 'expired']),
  actionable: z.boolean(), createdAt: z.iso.datetime(), sourceEpoch: id, revision: seq.optional(),
});
export const questionSchema = z.object({
  requestId: id, runtimeId: id, sessionId: id, sourceEpoch: id, createdAt: z.iso.datetime(), revision: seq.optional(),
  status: z.enum(['pending', 'submitting', 'answered', 'cancelled', 'unavailable', 'expired']), actionable: z.boolean().default(false),
  questions: z.array(z.object({ id, question: text, type: z.enum(['single', 'multiple', 'freeText']),
    options: z.array(z.object({ label: text, description: text.optional() }).strict()).max(100).optional(),
    allowCustom: z.boolean().optional(),
  }).strict()).min(1).max(100),
}).strict();
const envelope = { protocolVersion: z.literal(1), messageId: id, sentAt: z.iso.datetime(), runtimeId: id, epoch: id };
function frame<K extends string, S extends z.ZodType>(kind: K, payload: S) {
  return z.object({ ...envelope, kind: z.literal(kind), payload }).strict();
}
export const frameSchema = z.discriminatedUnion('kind', [
  frame('glass.welcome', z.object({ source: z.enum(['mock', 'dsh']), capabilities: capabilitiesSchema }).strict()),
  frame('glass.snapshot', z.object({ sessions: z.array(sessionSchema).max(100), approvals: z.array(approvalSchema).max(100), questions: z.array(questionSchema).max(100).default([]) }).strict()),
  frame('session.upserted', sessionSchema),
  frame('session.removed', z.object({ sessionId: id, sourceSeq: seq }).strict()),
  frame('session.todo.snapshot', z.object({ sessionId: id, sourceSeq: seq, todos: z.array(todoSchema).max(1000) }).strict()),
  frame('session.updated', z.object({ sessionId: id, sourceSeq: seq, fields: sessionSchema.pick({ agentStatus: true, phase: true }) }).strict()),
  frame('session.tool.activity', activitySchema.extend({ sessionId: id }).strict()),
  frame('session.note', z.object({ sessionId: id, note: noteSchema }).strict()),
  frame('approval.requested', approvalSchema),
  frame('approval.resolved', approvalSchema),
  frame('question.requested', questionSchema),
  frame('question.resolved', questionSchema),
  frame('glass.heartbeat', z.object({ counter: seq }).strict()),
]);
export const clientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('glass.hello'), protocolVersion: z.literal(1), clientNonce: id }).strict(),
  z.object({ kind: z.literal('glass.snapshot.request'), reason: z.enum(['initial', 'reconnect', 'refresh']) }).strict(),
]);
// Input types keep pre-existing producers compatible; the schema supplies defaults at the boundary.
export type Frame = z.input<typeof frameSchema>;
export type Session = z.input<typeof sessionSchema>;
export type SessionStats = z.infer<typeof sessionStatsSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Question = z.input<typeof questionSchema>;
export type Activity = z.input<typeof activitySchema>;
export type SessionNote = z.infer<typeof noteSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'incompatible';
export type Projection = {
  connection: Connection; stale: boolean; source: 'mock' | 'dsh' | null;
  runtimeId: string | null; epoch: string | null; capabilities: Capabilities;
  sessions: Record<string, Session>; approvals: Approval[]; questions: Question[]; seen: string[];
  removedSessions?: Record<string, number>;
};
export type LocalEvent = { kind: 'transport.closed' | 'transport.connecting' | 'transport.incompatible' };
export function initialProjection(): Projection {
  return { connection: 'connecting', stale: true, source: null, runtimeId: null, epoch: null,
    capabilities: { observeSessions: false, observeTodos: false, observeTools: false, respondApproval: false, respondQuestion: false },
    sessions: {}, approvals: [], questions: [], seen: [], removedSessions: {} };
}
function sessionAcceptsRequests(state: Projection, sessionId: string) {
  return Object.hasOwn(state.sessions, sessionId) && !['finished', 'limit-reached', 'error', 'cancelled', 'archived'].includes(state.sessions[sessionId]!.phase);
}
function safeApprovals(approvals: Approval[], state?: Projection): Approval[] {
  return approvals.map(a => ({ ...a, actionable: !!(a.actionable && state?.source === 'dsh' && state.connection === 'connected' && !state.stale &&
    state.capabilities.respondApproval && a.status === 'pending' && a.displayDetails === 'complete' && a.runtimeId === state.runtimeId && a.sourceEpoch === state.epoch && sessionAcceptsRequests(state, a.sessionId)) }));
}
function safeQuestions(questions: Question[], state?: Projection): Question[] {
  return questions.map(q => ({ ...q, actionable: !!(q.actionable && state?.source === 'dsh' && state.connection === 'connected' && !state.stale &&
    state.capabilities.respondQuestion && q.status === 'pending' && q.runtimeId === state.runtimeId && q.sourceEpoch === state.epoch && sessionAcceptsRequests(state, q.sessionId)) }));
}
function pending(status: string) { return status === 'pending' || status === 'submitting'; }
/** Resolved history must never evict an unresolved request from the UI window. */
export function requestWindow<T extends { status: string }>(values: readonly T[], limit = 100): T[] {
  const active = values.filter(value => pending(value.status));
  const count = Math.max(0, limit - active.length);
  return [...(count ? values.filter(value => !pending(value.status)).slice(-count) : []), ...active.slice(-limit)];
}
function canUpdateRequest(previous: { status: string; revision?: number } | undefined, incoming: { status: string; revision?: number }) {
  if (!previous) return true;
  if (!pending(previous.status)) return false;
  if (previous.status === 'submitting' && incoming.status === 'pending') return false;
  return previous.revision === undefined || incoming.revision !== undefined && incoming.revision > previous.revision;
}
export function reduceProjection(state: Projection, event: Frame | LocalEvent): Projection {
  if (event.kind.startsWith('transport.')) {
    const connection: Connection = event.kind === 'transport.incompatible' ? 'incompatible'
      : event.kind === 'transport.connecting' ? 'connecting' : 'disconnected';
    return { ...state, connection, stale: true, approvals: safeApprovals(state.approvals), questions: safeQuestions(state.questions) };
  }
  const parsed = frameSchema.safeParse(event);
  if (!parsed.success) return state;
  const f = parsed.data;
  if (f.kind === 'glass.welcome') {
    if (state.connection === 'connected') return state;
    return { ...state, runtimeId: f.runtimeId, epoch: f.epoch, source: f.payload.source,
      capabilities: { ...f.payload.capabilities, respondApproval: f.payload.source === 'dsh' && f.payload.capabilities.respondApproval,
        respondQuestion: f.payload.source === 'dsh' && f.payload.capabilities.respondQuestion },
      connection: 'connecting', stale: true, seen: [], approvals: safeApprovals(state.approvals), questions: safeQuestions(state.questions) };
  }
  if (f.runtimeId !== state.runtimeId || f.epoch !== state.epoch || state.seen.includes(f.messageId)) return state;
  if (f.kind === 'glass.snapshot') {
    if (state.connection !== 'connecting') return state;
    if (f.payload.sessions.some(s => s.runtimeId !== f.runtimeId) ||
      new Set(f.payload.sessions.map(s => s.sessionId)).size !== f.payload.sessions.length ||
      f.payload.approvals.some(a => a.runtimeId !== f.runtimeId || a.sourceEpoch !== f.epoch || !f.payload.sessions.some(s => s.sessionId === a.sessionId)) ||
      f.payload.questions.some(q => q.runtimeId !== f.runtimeId || q.sourceEpoch !== f.epoch || !f.payload.sessions.some(s => s.sessionId === q.sessionId)) ||
      new Set(f.payload.approvals.map(a => JSON.stringify([a.sessionId, a.requestId]))).size !== f.payload.approvals.length ||
      new Set(f.payload.questions.map(q => JSON.stringify([q.sessionId, q.requestId]))).size !== f.payload.questions.length) return state;
    const fresh: Projection = { ...state, connection: 'connected', stale: false,
      sessions: Object.fromEntries(f.payload.sessions.map(s => [s.sessionId, s])),
      approvals: [], questions: [], seen: [f.messageId], removedSessions: {} };
    return { ...fresh, approvals: safeApprovals(f.payload.approvals, fresh), questions: safeQuestions(f.payload.questions, fresh) };
  }
  if (state.connection !== 'connected' || state.stale) return state;
  const next = { ...state, seen: [...state.seen.slice(-511), f.messageId] };
  if (f.kind === 'glass.heartbeat') return next;
  if (f.kind === 'approval.requested' || f.kind === 'approval.resolved') {
    const a = f.payload;
    if (a.runtimeId !== state.runtimeId || a.sourceEpoch !== state.epoch || !Object.hasOwn(state.sessions, a.sessionId)) return state;
    if (f.kind === 'approval.resolved' && pending(a.status)) return state;
    if (!canUpdateRequest(state.approvals.find(x => x.sessionId === a.sessionId && x.requestId === a.requestId), a)) return state;
    return { ...next, approvals: safeApprovals(requestWindow([...state.approvals.filter(x => !(x.sessionId === a.sessionId && x.requestId === a.requestId)), a]), next) };
  }
  if (f.kind === 'question.requested' || f.kind === 'question.resolved') {
    const q = f.payload;
    if (q.runtimeId !== state.runtimeId || q.sourceEpoch !== state.epoch || !Object.hasOwn(state.sessions, q.sessionId)) return state;
    if (f.kind === 'question.resolved' && pending(q.status)) return state;
    if (!canUpdateRequest(state.questions.find(x => x.sessionId === q.sessionId && x.requestId === q.requestId), q)) return state;
    return { ...next, questions: safeQuestions(requestWindow([...state.questions.filter(x => !(x.sessionId === q.sessionId && x.requestId === q.requestId)), q]), next) };
  }
  if (f.kind === 'session.upserted') {
    const s = f.payload;
    if (s.runtimeId !== state.runtimeId || s.lastSourceSeq <= (state.removedSessions?.[s.sessionId] ?? -1) ||
      Object.hasOwn(state.sessions, s.sessionId) && s.lastSourceSeq <= state.sessions[s.sessionId]!.lastSourceSeq) return state;
    const updated = { ...next, sessions: { ...state.sessions, [s.sessionId]: s } };
    return { ...updated, approvals: safeApprovals(updated.approvals, updated), questions: safeQuestions(updated.questions, updated) };
  }
  if (f.kind === 'session.removed') {
    const { sessionId, sourceSeq } = f.payload;
    if (sourceSeq <= (state.removedSessions?.[sessionId] ?? -1) || Object.hasOwn(state.sessions, sessionId) && sourceSeq <= state.sessions[sessionId]!.lastSourceSeq) return state;
    const sessions = { ...state.sessions }; delete sessions[sessionId];
    return { ...next, sessions, approvals: state.approvals.filter(a => a.sessionId !== sessionId),
      questions: state.questions.filter(q => q.sessionId !== sessionId), removedSessions: { ...state.removedSessions, [sessionId]: sourceSeq } };
  }
  if (!Object.hasOwn(state.sessions, f.payload.sessionId)) return state;
  const previous = state.sessions[f.payload.sessionId];
  const sourceSeq = f.kind === 'session.note' ? f.payload.note.sourceSeq : f.payload.sourceSeq;
  if (!previous || sourceSeq <= previous.lastSourceSeq) return state;
  let session: Session = { ...previous, lastSourceSeq: sourceSeq };
  if (f.kind === 'session.todo.snapshot') session = { ...session, todos: f.payload.todos };
  if (f.kind === 'session.updated') session = { ...session, ...f.payload.fields };
  if (f.kind === 'session.tool.activity') {
    const old = previous.activities.find(a => a.callId === f.payload.callId);
    if (old && !['pending', 'running'].includes(old.status ?? 'running') && ['pending', 'running'].includes(f.payload.status)) return state;
    session = { ...session, activities: [f.payload, ...previous.activities.filter(a => a.callId !== f.payload.callId)].slice(0, 100) };
  }
  if (f.kind === 'session.note') {
    const notes = [f.payload.note, ...(previous.notes ?? []).filter(n => n.id !== f.payload.note.id)].slice(0, 60);
    session = { ...session, notes };
  }
  const updated = { ...next, sessions: { ...state.sessions, [session.sessionId]: session } };
  return { ...updated, approvals: safeApprovals(updated.approvals, updated), questions: safeQuestions(updated.questions, updated) };
}
