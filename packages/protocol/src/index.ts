import { z } from 'zod';

const id = z.string().min(1).max(200);
const text = z.string().max(4096);
const seq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const todoSchema = z.object({ content: text, status: z.enum(['pending', 'in_progress', 'completed']) }).strict();
export const capabilitiesSchema = z.object({
  observeSessions: z.boolean(), observeTodos: z.boolean(), observeTools: z.boolean(),
  respondApproval: z.boolean(), respondQuestion: z.boolean(),
}).strict();
export const activitySchema = z.object({ callId: id, toolName: id, summary: text, sourceSeq: seq });
export const sessionSchema = z.object({
  runtimeId: id, sessionId: id, title: text, workspaceLabel: text,
  agentStatus: z.enum(['running', 'idle', 'unknown']),
  phase: z.enum(['working', 'waiting-approval', 'waiting-question', 'finished', 'error', 'unknown']),
  todos: z.array(todoSchema).max(1000), lastSourceSeq: seq,
  activities: z.array(activitySchema).max(100),
});
export const approvalSchema = z.object({
  requestId: id, runtimeId: id, sessionId: id, toolName: id, callId: id.optional(),
  reason: text, commandPreview: text.optional(), displayDetails: z.enum(['complete', 'partial', 'unknown']),
  status: z.enum(['pending', 'submitting', 'allowed-once', 'rejected', 'cancelled', 'unavailable', 'expired']),
  actionable: z.boolean(), createdAt: z.iso.datetime(), sourceEpoch: id,
});
const envelope = { protocolVersion: z.literal(1), messageId: id, sentAt: z.iso.datetime(), runtimeId: id, epoch: id };
function frame<K extends string, S extends z.ZodType>(kind: K, payload: S) {
  return z.object({ ...envelope, kind: z.literal(kind), payload }).strict();
}
export const frameSchema = z.discriminatedUnion('kind', [
  frame('glass.welcome', z.object({ source: z.enum(['mock', 'dsh']), capabilities: capabilitiesSchema }).strict()),
  frame('glass.snapshot', z.object({ sessions: z.array(sessionSchema).max(100), approvals: z.array(approvalSchema).max(100) }).strict()),
  frame('session.todo.snapshot', z.object({ sessionId: id, sourceSeq: seq, todos: z.array(todoSchema).max(1000) }).strict()),
  frame('session.updated', z.object({ sessionId: id, sourceSeq: seq, fields: sessionSchema.pick({ agentStatus: true, phase: true }) }).strict()),
  frame('session.tool.activity', activitySchema.extend({ sessionId: id }).strict()),
  frame('approval.requested', approvalSchema),
  frame('glass.heartbeat', z.object({ counter: seq }).strict()),
]);
export const clientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('glass.hello'), protocolVersion: z.literal(1), clientNonce: id }).strict(),
  z.object({ kind: z.literal('glass.snapshot.request'), reason: z.enum(['initial', 'reconnect', 'refresh']) }).strict(),
]);
export type Frame = z.infer<typeof frameSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Approval = z.infer<typeof approvalSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type Connection = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'incompatible';
export type Projection = {
  connection: Connection; stale: boolean; source: 'mock' | 'dsh' | null;
  runtimeId: string | null; epoch: string | null; capabilities: Capabilities;
  sessions: Record<string, Session>; approvals: Approval[]; seen: string[];
};
export type LocalEvent = { kind: 'transport.closed' | 'transport.connecting' | 'transport.incompatible' };
export function initialProjection(): Projection {
  return { connection: 'connecting', stale: true, source: null, runtimeId: null, epoch: null,
    capabilities: { observeSessions: false, observeTodos: false, observeTools: false, respondApproval: false, respondQuestion: false },
    sessions: {}, approvals: [], seen: [] };
}
function safeApprovals(approvals: Approval[]): Approval[] {
  // The preview does not implement a decision channel, including in Mock mode.
  return approvals.map(a => ({ ...a, actionable: false }));
}
export function reduceProjection(state: Projection, event: Frame | LocalEvent): Projection {
  if (event.kind.startsWith('transport.')) {
    const connection: Connection = event.kind === 'transport.incompatible' ? 'incompatible'
      : event.kind === 'transport.connecting' ? 'connecting' : 'disconnected';
    return { ...state, connection, stale: true, approvals: safeApprovals(state.approvals) };
  }
  const parsed = frameSchema.safeParse(event);
  if (!parsed.success) return state;
  const f = parsed.data;
  if (f.kind === 'glass.welcome') {
    if (state.connection === 'connected') return state;
    return { ...state, runtimeId: f.runtimeId, epoch: f.epoch, source: f.payload.source,
      capabilities: { ...f.payload.capabilities, respondApproval: false, respondQuestion: false },
      connection: 'connecting', stale: true, seen: [] };
  }
  if (f.runtimeId !== state.runtimeId || f.epoch !== state.epoch || state.seen.includes(f.messageId)) return state;
  if (f.kind === 'glass.snapshot') {
    if (state.connection !== 'connecting') return state;
    if (f.payload.sessions.some(s => s.runtimeId !== f.runtimeId) ||
      new Set(f.payload.sessions.map(s => s.sessionId)).size !== f.payload.sessions.length ||
      f.payload.approvals.some(a => a.runtimeId !== f.runtimeId || a.sourceEpoch !== f.epoch || !f.payload.sessions.some(s => s.sessionId === a.sessionId))) return state;
    return { ...state, connection: 'connected', stale: false,
      sessions: Object.fromEntries(f.payload.sessions.map(s => [s.sessionId, s])),
      approvals: safeApprovals(f.payload.approvals), seen: [f.messageId] };
  }
  if (state.connection !== 'connected' || state.stale) return state;
  const next = { ...state, seen: [...state.seen.slice(-511), f.messageId] };
  if (f.kind === 'glass.heartbeat') return next;
  if (f.kind === 'approval.requested') {
    const a = f.payload;
    if (a.runtimeId !== state.runtimeId || a.sourceEpoch !== state.epoch || !Object.hasOwn(state.sessions, a.sessionId)) return state;
    return { ...next, approvals: safeApprovals([...state.approvals.filter(x => !(x.sessionId === a.sessionId && x.requestId === a.requestId)), a]).slice(-100) };
  }
  if (!Object.hasOwn(state.sessions, f.payload.sessionId)) return state;
  const previous = state.sessions[f.payload.sessionId];
  if (!previous || f.payload.sourceSeq <= previous.lastSourceSeq) return state;
  let session: Session = { ...previous, lastSourceSeq: f.payload.sourceSeq };
  if (f.kind === 'session.todo.snapshot') session = { ...session, todos: f.payload.todos };
  if (f.kind === 'session.updated') session = { ...session, ...f.payload.fields };
  if (f.kind === 'session.tool.activity') session = { ...session, activities: [f.payload, ...previous.activities].slice(0, 100) };
  return { ...next, sessions: { ...state.sessions, [session.sessionId]: session } };
}
