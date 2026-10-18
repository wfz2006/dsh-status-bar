import { randomUUID } from 'node:crypto';
import type { Approval, Frame, Question, Session, SessionNote } from '@glass/protocol';
import { HostTransport, bounded, record, type RecordValue } from './transport';

export const dshIntegration = Object.freeze({ status: 'AVAILABLE', mode: 'authenticated-host', respondApproval: true, respondQuestion: true,
  reason: '通过用户提供的本机 Host 认证链接连接；具体答复能力仅由本次连接的有效请求授予。' });
export type RequestIdentity = { runtimeId: string; sourceEpoch: string; sessionId: string; requestId: string };
export type QuestionAnswer = { questionId: string; values: string[] };
type Delivery = { eventId: string; clientId: string; identity: RequestIdentity; kind: 'approval' | 'question'; submitting: boolean; cancelled?: boolean; durableCallId?: string };
type Options = { publish: (frame: Frame) => void; onConnection: (connection: 'connecting' | 'connected' | 'disconnected') => void };
type QuestionItem = Question['questions'][number];
const isPending = (status: string) => status === 'pending' || status === 'submitting';
function questionItems(value: unknown): QuestionItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map(record).filter(q => bounded(q.id) && bounded(q.question)).map(q => {
    const options = Array.isArray(q.options) ? q.options.slice(0, 100).map(record).filter(o => bounded(o.label)).map(o => ({ label: bounded(o.label), ...(bounded(o.description) ? { description: bounded(o.description) } : {}) })) : undefined;
    return { id: bounded(q.id, '', 200), question: bounded(q.question), type: options?.length ? q.multiSelect === true ? 'multiple' : 'single' : 'freeText', options, allowCustom: true };
  });
}
const statNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Derive the compact usage line DSH shows from cached session projections; anything unparsable is omitted. */
function sessionStats(stats: RecordValue, tokens: RecordValue, pressure: RecordValue): Session['stats'] {
  const turns = statNumber(stats.turns); const steps = statNumber(stats.steps);
  const input = statNumber(tokens.uncachedInputTokens); const cacheRead = statNumber(tokens.cacheReadTokens);
  const cacheWrite = statNumber(tokens.cacheWriteTokens); const output = statNumber(tokens.outputTokens);
  const decodeMs = statNumber(stats.decodeMs); const decodeTokens = statNumber(stats.decodeTokens);
  const projected = statNumber(pressure.projectedTokens); const contextWindow = statNumber(pressure.contextWindow);
  if (turns === undefined && steps === undefined && input === undefined && cacheRead === undefined) return undefined;
  const tokenTotal = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) + (output ?? 0);
  const cacheHit = cacheRead !== undefined && input !== undefined && cacheRead + input > 0 ? round(cacheRead / (cacheRead + input) * 100, 1) : undefined;
  return {
    turns: Math.floor(turns ?? 0), steps: Math.floor(steps ?? 0),
    ...(decodeMs !== undefined && decodeMs > 0 && decodeTokens !== undefined ? { tokensPerSecond: round(decodeTokens / decodeMs * 1000, 0) } : {}),
    ...(cacheHit !== undefined ? { cacheHitPercent: cacheHit } : {}),
    ...(projected !== undefined && contextWindow !== undefined && contextWindow > 0 ? { contextPercent: round(projected / contextWindow * 100, 1) } : {}),
    ...(tokenTotal > 0 ? { tokens: { input: input ?? 0, cacheRead: cacheRead ?? 0, cacheWrite: cacheWrite ?? 0, output: output ?? 0, total: tokenTotal } } : {}),
  };
}

/** All Host credentials and delivery IDs remain in this main-process adapter. */
export function createDshAdapter(options: Options) {
  let runtimeId = randomUUID(); let epoch = randomUUID(); let clientId = ''; let connected = false; let generation = 0;
  let transport: HostTransport | undefined; let poll: ReturnType<typeof setInterval> | undefined;
  const sessions = new Map<string, Session>(); const approvals = new Map<string, Approval>(); const questions = new Map<string, Question>();
  /** Projections arrive one key at a time; keep the merged view so stats never flicker back to partial zeros. */
  const projectionValues = new Map<string, RecordValue>();
  const projectionClocks = new Map<string, number>();
  const revisions = new Map<string, number>(); const deliveries = new Map<string, Delivery>(); const followed = new Set<string>();
  const terminal = new Map<string, Session['phase']>(); const archived = new Set<string>(); const live = new Set<string>();
  const toolArguments = new Map<string, { name: string; preview: string; complete: boolean }>();
  const auditApprovals = new Map<string, string>(); const continuedQuestions = new Map<string, string>();
  const decisions = new Map<string, (status: string) => void>();
  const coldRead = new Set<string>();
  function watchDecision(key: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<string>(resolve => { decisions.set(key, resolve); timer = setTimeout(() => resolve('unavailable'), 10000); });
    return { promise, stop() { clearTimeout(timer); decisions.delete(key); } };
  }
  let readyResolve: (() => void) | undefined; let readyReject: ((error: Error) => void) | undefined;
  let baseline = false; let gatewayReady = false;
  const revision = (id: string) => { const next = (revisions.get(id) ?? 0) + 1; revisions.set(id, next); return next; };
  // Last emitted shape per session, used to keep idle polls from republishing.
  const emittedSessions = new Map<string, string>();
  function frame(kind: Frame['kind'], payload: unknown): Frame { return { protocolVersion: 1, messageId: randomUUID(), sentAt: new Date().toISOString(), runtimeId, epoch, kind, payload } as Frame; }
  function welcome(): Frame { return frame('glass.welcome', { source: 'dsh', capabilities: { observeSessions: connected, observeTodos: connected, observeTools: connected,
    // Connection-level support only: each concrete decision still requires a matching live delivery (see deliveryFor).
    respondApproval: connected, respondQuestion: connected } }); }
  function snapshot(): Frame { return frame('glass.snapshot', { sessions: [...sessions.values()].slice(-100), approvals: [...approvals.values()].slice(-100), questions: [...questions.values()].slice(-100) }); }
  function emitSession(id: string) {
    const session = sessions.get(id); if (!session) return;
    const waitingApproval = [...approvals.values()].some(a => a.sessionId === id && isPending(a.status));
    const waitingQuestion = [...questions.values()].some(q => q.sessionId === id && isPending(q.status));
    session.phase = archived.has(id) ? 'archived' : terminal.get(id) ?? (waitingApproval ? 'waiting-approval' : waitingQuestion ? 'waiting-question' : session.agentStatus === 'idle' || session.agentStatus === 'unknown' ? 'unknown' : 'working');
    // The 10s session list poll re-projects every known session. Skip publishes
    // that would not change the projection, so an idle dashboard stops paying
    // for 80+ identical renders every tick.
    const fingerprint = JSON.stringify(session, (key, value) => key === 'lastSourceSeq' ? undefined : value);
    if (emittedSessions.get(id) === fingerprint) return;
    emittedSessions.set(id, fingerprint);
    session.lastSourceSeq = revision(id);
    if (connected) options.publish(frame('session.upserted', structuredClone(session)));
  }
  function ensureSession(id: string, row: RecordValue = {}): Session | undefined {
    if (!id || id.length > 200) return;
    let session = sessions.get(id);
    if (!session) {
      if (sessions.size >= 100) return;
      session = { runtimeId, sessionId: id, title: '未命名会话', workspaceLabel: bounded(row.cwd, 'DSH', 160), agentStatus: row.running === true ? 'running' : 'idle', phase: row.running === true ? 'working' : 'unknown', todos: [], activities: [], notes: [], lastSourceSeq: 0 };
      sessions.set(id, session);
    }
    if (typeof row.cwd === 'string') session.workspaceLabel = bounded(row.cwd, 'DSH', 160);
    if (typeof row.running === 'boolean') session.agentStatus = row.running ? 'running' : 'idle';
    if (row.agentAvailable === true) live.add(id); else if (row.agentAvailable === false) live.delete(id);
    return session;
  }
  function addNote(id: string, note: SessionNote) {
    const session = sessions.get(id); if (!session) return;
    const normalized = note.text.replace(/\s+/g, ' ').trim(); if (!normalized) return;
    const previous = session.notes?.[0];
    if (previous && previous.sourceSeq === note.sourceSeq && previous.text === normalized) return;
    session.notes = [{ ...note, text: normalized.slice(0, 2000) }, ...(session.notes ?? []).filter(n => n.id !== note.id)].slice(0, 60);
  }
  function applyProjections(id: string, values: unknown, sourceClock?: number, cached = false) {
    const session = ensureSession(id); if (!session) return;
    const previous = projectionValues.get(id) ?? {};
    const incoming = Object.fromEntries(Object.entries(record(values)).filter(([key]) => {
      const clockKey = `${id}:${key}`; const previousClock = projectionClocks.get(clockKey);
      if (cached && key in previous || sourceClock !== undefined && previousClock !== undefined && sourceClock < previousClock) return false;
      if (sourceClock !== undefined) projectionClocks.set(clockKey, sourceClock);
      return true;
    }));
    const merged = { ...previous, ...incoming };
    projectionValues.set(id, merged);
    const p = merged;
    if ('title' in incoming) session.title = bounded(p.title, '未命名会话');
    const stats = sessionStats(record(p.sessionStats), record(p.tokenUsage), record(p.contextPressure));
    if (stats) session.stats = stats;
    if ('todos' in incoming) session.todos = Array.isArray(p.todos) ? p.todos.slice(0, 1000).map(record).filter(t => typeof t.content === 'string' && ['pending', 'in_progress', 'completed'].includes(String(t.status))).map(t => ({ content: bounded(t.content), status: t.status as 'pending' | 'in_progress' | 'completed' })) : [];
    const userQuestions = record(p.userQuestions);
    if ('userQuestions' in incoming && Array.isArray(userQuestions.active)) {
      const activeIds = new Set<string>();
      for (const value of userQuestions.active) {
        const q = record(value); const callId = bounded(q.callId, '', 180); if (!callId) continue;
        const requestId = `question:${callId}`; activeIds.add(requestId);
        const items = questionItems(q.questions); if (!items.length) continue;
        const previous = questions.get(`${id}:${requestId}`);
        if (previous && !isPending(previous.status)) continue;
        const delivered = [...deliveries.values()].some(d => d.identity.sessionId === id && d.identity.requestId === requestId);
        if (!delivered) {
          // A projection-only question still has its durable callId, and the host
          // answers it through userQuestions/answer. The live session is the gate:
          // without it the request can no longer be attributed to a running runtime.
          const canAnswer = live.has(id);
          if (canAnswer) continuedQuestions.set(`${id}:${requestId}`, callId);
          else continuedQuestions.delete(`${id}:${requestId}`);
          if (!previous) questions.set(`${id}:${requestId}`, { requestId, runtimeId, sessionId: id, sourceEpoch: epoch, createdAt: new Date().toISOString(), status: 'pending', actionable: canAnswer, revision: revision(id), questions: items });
          else if (previous.status === 'pending' && previous.actionable !== canAnswer) { previous.actionable = canAnswer; previous.revision = revision(id); questions.set(`${id}:${requestId}`, previous); }
        }
      }
      const settled = new Set(Array.isArray(userQuestions.settled) ? userQuestions.settled.map(s => bounded(record(s).callId, '', 180)) : []);
      for (const [key, q] of questions) if (q.sessionId === id && q.requestId.startsWith('question:') && isPending(q.status) && !activeIds.has(q.requestId)) {
        const delivery = [...deliveries.values()].find(d => d.identity.sessionId === id && d.identity.requestId === q.requestId);
        if (delivery) {
          if (settled.has(q.requestId.slice(9))) finalizeDelivery(delivery, 'answered');
          continue;
        }
        q.status = settled.has(q.requestId.slice(9)) ? 'answered' : 'cancelled'; q.actionable = false; q.revision = revision(id); questions.set(key, q); continuedQuestions.delete(key); decisions.get(key)?.(q.status);
        for (const d of [...deliveries.values()]) if (d.identity.sessionId === id && d.identity.requestId === q.requestId) deliveries.delete(d.eventId);
        if (connected) options.publish(frame('question.resolved', q));
      }
      if (connected) for (const q of questions.values()) if (q.sessionId === id && activeIds.has(q.requestId)) options.publish(frame('question.requested', q));
    }
    emitSession(id);
  }
  function follow(id: string) {
    if (followed.has(id) || !live.has(id)) return;
    followed.add(id); transport?.subscribe(`audit:${id}`, 'session/follow', { request: { address: { kind: 'session', sessionId: id }, maxMessages: 80 } });
  }
  function event(id: string, value: unknown) {
    const session = ensureSession(id); if (!session) return;
    const e = record(value); const data = record(e.data); const type = bounded(e.type);
    const eventSeq = typeof e.seq === 'number' && Number.isInteger(e.seq) && e.seq >= 0 ? e.seq : revision(id);
    if (type === 'turn/start') {
      terminal.delete(id); session.agentStatus = 'running';
      if (typeof e.seq !== 'number' || e.seq >= (projectionClocks.get(`${id}:todos`) ?? -1)) {
        session.todos = []; const p = projectionValues.get(id); if (p) p.todos = [];
        if (typeof e.seq === 'number') projectionClocks.set(`${id}:todos`, e.seq);
      }
    }
    if (type === 'turn/end') {
      session.agentStatus = 'idle'; const reason = bounded(record(data.reason).kind);
      terminal.set(id, reason === 'aborted' ? 'cancelled' : reason === 'error' || reason === 'blocked' ? 'error' : reason === 'max-tokens' ? 'limit-reached' : reason === 'completed' ? 'finished' : 'unknown');
      if (reason === 'aborted' || reason === 'error') session.activities = session.activities.map(a => a.status === 'running' || a.status === 'pending' ? { ...a, status: reason === 'aborted' ? 'cancelled' : 'error' } : a);
    }
    if (type === 'todo/write') applyProjections(id, { todos: data.todos }, typeof e.seq === 'number' ? e.seq : undefined);
    if (type === 'assistant/message') {
      const message = record(data.message); const blocks = Array.isArray(message.content) ? message.content : [];
      let added = false;
      blocks.forEach((block, index) => {
        const b = record(block); const kind = b.type === 'reasoning' ? 'reasoning' as const : b.type === 'text' ? 'message' as const : undefined;
        if (!kind || typeof b.text !== 'string' || !b.text.trim()) return;
        addNote(id, { id: `${id}:${eventSeq}:${index}`, kind, text: b.text, sourceSeq: eventSeq }); added = true;
      });
      if (added) emitSession(id);
    }
    if (type === 'user/message') {
      const message = record(data.message); const blocks = Array.isArray(message.content) ? message.content : [];
      let added = false;
      blocks.forEach((block, index) => {
        const b = record(block);
        if (b.type !== 'text' || typeof b.text !== 'string' || !b.text.trim()) return;
        addNote(id, { id: `${id}:${eventSeq}:u:${index}`, kind: 'user', text: b.text, sourceSeq: eventSeq }); added = true;
      });
      if (added) emitSession(id);
    }
    if (type === 'tool/call') {
      const callId = bounded(data.callId, '', 200); const name = bounded(data.name, 'tool', 200);
      if (callId) {
        let parsed: unknown; try { parsed = JSON.parse(bounded(data.arguments)); } catch { parsed = undefined; }
        const containsSensitive = (v: unknown): boolean => Array.isArray(v) ? v.some(containsSensitive) : Object.entries(record(v)).some(([key, nested]) => /(?:secret|password|token|authorization|api.?key|^env$)/i.test(key) || containsSensitive(nested));
        const args = record(parsed); const encoded = JSON.stringify(args); const complete = parsed !== undefined && Object.keys(args).length > 0 && !containsSensitive(parsed) && encoded.length <= 4096;
        toolArguments.set(`${id}:${callId}`, { name, preview: complete ? bounded(args.command, encoded) : '参数包含敏感字段、过长或格式不可验证，请在 DSH 中确认。', complete });
        session.activities = [{ callId, toolName: name, summary: complete ? bounded(args.command ?? encoded, name, 400) : name, sourceSeq: eventSeq, status: 'running' as const }, ...session.activities.filter(a => a.callId !== callId)].slice(0, 100);
        for (const a of approvals.values()) if (a.sessionId === id && a.callId === callId && a.toolName === name && isPending(a.status)) {
          const tool = toolArguments.get(`${id}:${callId}`)!; a.commandPreview = tool.preview; a.displayDetails = tool.complete ? 'complete' : 'partial'; a.actionable = tool.complete && [...deliveries.values()].some(d => d.identity.requestId === a.requestId); a.revision = revision(id);
          if (connected) options.publish(frame('approval.requested', structuredClone(a)));
        }
      }
    }
    if (type === 'tool/result') {
      const message = record(data.message); const callId = bounded(message.toolCallId, '', 200);
      const failed = message.isError === true || !!data.error;
      const known = session.activities.some(a => a.callId === callId);
      if (callId && !known) {
        session.activities = [{ callId, toolName: toolArguments.get(`${id}:${callId}`)?.name ?? 'tool', summary: failed ? '工具执行失败' : '工具执行完成', sourceSeq: eventSeq, status: failed ? 'error' as const : 'success' as const, resultSummary: failed ? '工具执行失败' : '工具执行完成' }, ...session.activities].slice(0, 100);
      }
      session.activities = session.activities.map(a => a.callId === callId ? { ...a, status: failed ? 'error' : 'success', resultSummary: failed ? '工具执行失败' : '工具执行完成' } : a);
    }
    if (type === 'approval/asked') {
      const auditId = bounded(data.id, '', 200); const callId = bounded(data.callId, '', 200);
      const matching = [...approvals.values()].find(a => a.sessionId === id && !!callId && a.callId === callId && a.toolName === data.toolName && isPending(a.status));
      if (auditId && matching) auditApprovals.set(`${id}:${auditId}`, matching.requestId);
      else if (auditId) {
        const requestId = `audit:${auditId}`; auditApprovals.set(`${id}:${auditId}`, requestId);
        approvals.set(`${id}:${requestId}`, { requestId, runtimeId, sourceEpoch: epoch, sessionId: id, toolName: bounded(data.toolName, 'tool', 200), ...(callId ? { callId } : {}), reason: bounded(data.reason, 'DSH 审批记录'), createdAt: new Date().toISOString(), status: 'pending', actionable: false, displayDetails: 'partial', revision: revision(id) });
      }
    }
    if (type === 'approval/decided') {
      const requestId = auditApprovals.get(`${id}:${bounded(data.id, '', 200)}`); const a = requestId ? approvals.get(`${id}:${requestId}`) : undefined;
      if (a && ['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(String(data.outcome))) {
        a.status = data.outcome as Approval['status']; a.actionable = false; a.revision = revision(id);
        decisions.get(`${id}:${a.requestId}`)?.(a.status);
        for (const d of [...deliveries.values()]) if (d.identity.sessionId === id && d.identity.requestId === requestId) deliveries.delete(d.eventId);
        if (connected) options.publish(frame('approval.resolved', structuredClone(a)));
      }
    }
    emitSession(id);
  }
  function finalizeDelivery(delivery: Delivery, status: Approval['status'] | Question['status']) {
    deliveries.delete(delivery.eventId); const key = `${delivery.identity.sessionId}:${delivery.identity.requestId}`;
    decisions.get(key)?.(status);
    if (delivery.kind === 'approval') { const a = approvals.get(key); if (a) { a.status = status as Approval['status']; a.actionable = false; a.revision = revision(a.sessionId); if (connected) options.publish(frame('approval.resolved', structuredClone(a))); } }
    else { const q = questions.get(key); if (q) { q.status = status as Question['status']; q.actionable = false; q.revision = revision(q.sessionId); if (connected) options.publish(frame('question.resolved', structuredClone(q))); } }
    emitSession(delivery.identity.sessionId);
  }
  function gateway(value: unknown) {
    const g = record(value);
    if (g.type === 'ready') { clientId = bounded(g.clientId, '', 200); gatewayReady = !!clientId; checkReady(); return; }
    if (g.type === 'cancel') {
      const d = deliveries.get(bounded(g.eventId));
      if (d) {
        if (d.submitting) d.cancelled = true;
        else if (d.kind === 'question' && d.durableCallId) {
          // Timed waits continue as durable questions; a lost delivery is not an expiry.
          deliveries.delete(d.eventId); const q = questions.get(`${d.identity.sessionId}:${d.identity.requestId}`);
          if (q) { q.actionable = false; q.revision = revision(q.sessionId); if (connected) options.publish(frame('question.requested', structuredClone(q))); }
          void transport?.request('session/projections', { request: { sessionId: d.identity.sessionId } }).then(p => applyProjections(d.identity.sessionId, record(p).values)).catch(() => {});
        } else finalizeDelivery(d, 'cancelled');
      }
      return;
    }
    if (g.type === 'emit') {
      const args = Array.isArray(g.args) ? g.args : []; const id = bounded(args[0], '', 200);
      if (g.event === 'api-session/added') { const row = record(args[0]); const sid = bounded(row.sessionId, '', 200); if (ensureSession(sid, row)) { applyProjections(sid, record(row.projections).values); follow(sid); } }
      if (g.event === 'api-session/removed' && sessions.has(id)) {
        for (const d of [...deliveries.values()]) if (d.identity.sessionId === id) finalizeDelivery(d, 'unavailable');
        for (const [key, a] of approvals) if (a.sessionId === id) approvals.delete(key);
        for (const [key, q] of questions) if (q.sessionId === id) { questions.delete(key); continuedQuestions.delete(key); }
        const sourceSeq = revision(id); sessions.delete(id); projectionValues.delete(id); terminal.delete(id); live.delete(id); emittedSessions.delete(id);
        if (connected) options.publish(frame('session.removed', { sessionId: id, sourceSeq }));
      }
      if (g.event === 'api-session/status' && ensureSession(id)) { sessions.get(id)!.agentStatus = args[1] === true ? 'running' : 'idle'; if (args[1] === true) { terminal.delete(id); follow(id); } emitSession(id); }
      if (g.event === 'api-session/error' && sessions.has(id)) { terminal.set(id, 'error'); sessions.get(id)!.agentStatus = 'idle'; emitSession(id); }
      return;
    }
    const eventId = bounded(g.eventId, '', 200); const sessionId = bounded(g.agentId, '', 200); const request = record(g.request);
    if (g.type !== 'waterfall' || !clientId || !eventId || !sessionId || !ensureSession(sessionId) || deliveries.has(eventId)) return;
    const createdAt = new Date().toISOString();
    if (g.event === 'approval/request') {
      const toolName = bounded(request.toolName, '', 200); if (!toolName) return;
      const callId = bounded(request.callId, '', 200); const tool = toolArguments.get(`${sessionId}:${callId}`); const complete = !!tool?.complete && tool.name === toolName;
      const existing = callId ? [...approvals.values()].find(a => a.sessionId === sessionId && a.callId === callId && a.toolName === toolName && isPending(a.status)) : undefined;
      const requestId = existing?.requestId ?? `approval:${randomUUID()}`; const identity = { runtimeId, sourceEpoch: epoch, sessionId, requestId }; terminal.delete(sessionId);
      const a: Approval = { ...identity, toolName, ...(callId ? { callId } : {}), reason: bounded(request.displayReason, bounded(request.reason, '需要确认此操作')), ...(tool ? { commandPreview: tool.preview } : {}), displayDetails: complete ? 'complete' : 'partial', status: 'pending', actionable: complete, createdAt, revision: revision(sessionId) };
      approvals.set(`${sessionId}:${requestId}`, a); deliveries.set(eventId, { eventId, clientId, identity, kind: 'approval', submitting: false });
      if (connected) options.publish(frame('approval.requested', structuredClone(a))); emitSession(sessionId);
    }
    if (g.event === 'user-questions/request') {
      const items = questionItems(request.questions); if (!items.length) return;
      const callId = bounded(record(request.wait).callId, '', 180); const requestId = callId ? `question:${callId}` : `question:${randomUUID()}`;
      terminal.delete(sessionId); continuedQuestions.delete(`${sessionId}:${requestId}`);
      const identity = { runtimeId, sourceEpoch: epoch, sessionId, requestId };
      // Legacy ask() has no durable call identity or authoritative answer receipt: observe only.
      // The waterfall delivery itself is the answer channel ($events/result), so a
      // delivered question is answerable even when the host omits wait.callId.
      const q: Question = { ...identity, createdAt, revision: revision(sessionId), status: 'pending', actionable: true, questions: items };
      questions.set(`${sessionId}:${requestId}`, q); deliveries.set(eventId, { eventId, clientId, identity, kind: 'question', submitting: false, ...(callId ? { durableCallId: callId } : {}) });
      if (connected) options.publish(frame('question.requested', structuredClone(q))); emitSession(sessionId);
    }
  }
  function checkReady() { if (baseline && gatewayReady) readyResolve?.(); }
  function item(stream: string, value: unknown) {
    if (stream === 'gateway') return gateway(value);
    const v = record(value);
    if (stream === 'control') {
      if (v.type === 'baseline') { const projections = record(record(v.value).projections); for (const [id, p] of Object.entries(projections)) if (sessions.has(id)) { const projection = record(p); applyProjections(id, projection.values, typeof projection.asOfSeq === 'number' ? projection.asOfSeq : undefined); } baseline = true; checkReady(); }
      if (v.type === 'projection') { const id = bounded(v.sessionId, '', 200); if (sessions.has(id)) applyProjections(id, { [bounded(v.key)]: v.value }, typeof v.seq === 'number' ? v.seq : undefined); }
      return;
    }
    if (stream === 'workspace') {
      const w = v.type === 'baseline' ? record(v.value) : v;
      if (Array.isArray(w.archivedSessionIds)) { archived.clear(); for (const id of w.archivedSessionIds) if (typeof id === 'string') archived.add(id); for (const id of sessions.keys()) emitSession(id); }
      return;
    }
    if (stream.startsWith('audit:')) {
      const id = stream.slice(6);
      if (v.type === 'snapshot') {
        if (Array.isArray(v.records)) for (const entry of v.records) { const row = record(entry); if (row.type === 'event') event(id, row.event); }
        const projection = record(v.projections); applyProjections(id, projection.values, typeof projection.asOfSeq === 'number' ? projection.asOfSeq : undefined);
        const boundary = record(record(projection.values).turnBoundary);
        if (typeof boundary.openTurnStartSeq === 'number') { terminal.delete(id); const session = sessions.get(id); if (session) session.agentStatus = 'running'; emitSession(id); }
      }
      if (v.type === 'event') event(id, v.event);
    }
  }
  function disconnected() {
    if (!transport) return;
    connected = false; transport.close(); transport = undefined; clearInterval(poll); poll = undefined;
    for (const d of [...deliveries.values()]) finalizeDelivery(d, 'unavailable'); clientId = '';
    for (const a of approvals.values()) a.actionable = false;
    for (const q of questions.values()) q.actionable = false; continuedQuestions.clear();
    for (const resolve of decisions.values()) resolve('unavailable');
    emittedSessions.clear();
    readyReject?.(new Error('DSH 实时连接已断开。')); options.onConnection('disconnected');
  }
  async function refreshList() {
    const current = transport; if (!current) return;
    const result = record(await current.request('session/list', { _request: {} }));
    if (current !== transport) return;
    if (!Array.isArray(result.items)) throw new Error('DSH 会话列表格式不兼容。');
    for (const value of result.items.slice(0, 100)) {
      const row = record(value); const id = bounded(row.sessionId, '', 200);
      if (ensureSession(id, row)) {
        const projection = record(row.projections); applyProjections(id, projection.values, projection.kind === 'sequenced' && typeof projection.asOfSeq === 'number' ? projection.asOfSeq : undefined, projection.kind !== 'sequenced'); follow(id);
        if (!live.has(id) && !coldRead.has(id) && typeof projection.asOfSeq === 'number' && Number.isSafeInteger(projection.asOfSeq) && projection.asOfSeq >= 0) {
          coldRead.add(id);
          // page observes existing storage; unlike follow it does not promote a cold session into an Agent.
          try {
            const page = record(await current.request('session/page', { request: { address: { kind: 'session', sessionId: id }, throughSeq: projection.asOfSeq, maxMessages: 1 } }));
            const records = Array.isArray(page.records) ? page.records.map(record).filter(r => r.type === 'event').map(r => record(r.event)) : [];
            const lastBoundary = [...records].reverse().find(e => e.type === 'turn/start' || e.type === 'turn/end');
            if (lastBoundary?.type === 'turn/end') {
              const kind = bounded(record(record(lastBoundary.data).reason).kind);
              terminal.set(id, kind === 'completed' ? 'finished' : kind === 'max-tokens' ? 'limit-reached' : kind === 'aborted' ? 'cancelled' : kind === 'error' || kind === 'blocked' ? 'error' : 'unknown'); emitSession(id);
            }
          } catch {
            // Historical page access may be disabled for this session. Keep it unknown and connected.
          }
        }
      }
    }
  }
  async function connect(link: string): Promise<void> {
    disconnect(); const attempt = ++generation; runtimeId = randomUUID(); epoch = randomUUID(); baseline = false; gatewayReady = false;
    sessions.clear(); approvals.clear(); questions.clear(); revisions.clear(); deliveries.clear(); followed.clear(); terminal.clear(); archived.clear(); live.clear(); toolArguments.clear(); auditApprovals.clear(); continuedQuestions.clear(); projectionValues.clear(); projectionClocks.clear(); coldRead.clear(); options.onConnection('connecting');
    const current = new HostTransport(item, disconnected); transport = current;
    try {
      await current.authenticate(link); await refreshList(); await current.open();
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      current.subscribe('control', 'session/control'); current.subscribe('gateway', '$events'); current.subscribe('workspace', 'workspace/follow');
      for (const id of followed) current.subscribe(`audit:${id}`, 'session/follow', { request: { address: { kind: 'session', sessionId: id }, maxMessages: 80 } });
      const timeout = setTimeout(() => readyReject?.(new Error('DSH 实时通道没有返回完整基线。')), 10000);
      try { await ready; } finally { clearTimeout(timeout); readyResolve = undefined; readyReject = undefined; }
      if (attempt !== generation || current !== transport) throw new Error('DSH 连接已取消。');
      connected = true; options.publish(welcome()); options.publish(snapshot()); options.onConnection('connected');
      poll = setInterval(() => { void refreshList().catch(() => disconnected()); }, 10000); poll.unref();
    } catch { if (attempt === generation) disconnected(); throw new Error('连接 DSH 失败，请检查本机 Host 是否开启以及认证链接是否有效。'); }
  }
  function disconnect() { generation++; disconnected(); }
  function deliveryFor(identity: RequestIdentity, kind: Delivery['kind']): Delivery {
    const d = [...deliveries.values()].find(d => d.kind === kind && d.identity.runtimeId === identity.runtimeId && d.identity.sourceEpoch === identity.sourceEpoch && d.identity.sessionId === identity.sessionId && d.identity.requestId === identity.requestId);
    if (!connected || !d || d.submitting || d.identity.runtimeId !== runtimeId || d.identity.sourceEpoch !== epoch) throw new Error('此请求已失效或正在提交。');
    return d;
  }
  async function respondApproval(identity: RequestIdentity, outcome: 'allowed-once' | 'rejected') {
    if (outcome !== 'allowed-once' && outcome !== 'rejected') throw new Error('无效的审批选择。');
    const d = deliveryFor(identity, 'approval'); d.submitting = true;
    const approval = approvals.get(`${identity.sessionId}:${identity.requestId}`);
    if (!approval?.actionable || approval.displayDetails !== 'complete') { d.submitting = false; throw new Error('操作参数尚未完整验证，请在 DSH 中确认。'); }
    approval.status = 'submitting'; approval.actionable = false; approval.revision = revision(identity.sessionId); options.publish(frame('approval.requested', structuredClone(approval)));
    const decision = watchDecision(`${identity.sessionId}:${identity.requestId}`);
    try { const accepted = await transport!.request('$events/result', { clientId: d.clientId, eventId: d.eventId, outcome: { kind: 'result', value: outcome } });
      if (accepted !== undefined || await decision.promise !== outcome) throw new Error('没有收到匹配的 DSH 决议。');
    }
    catch { if (deliveries.has(d.eventId)) finalizeDelivery(d, 'unavailable'); throw new Error('审批提交失败，请回到 DSH 确认状态。'); }
    finally { decision.stop(); }
  }
  async function respondQuestion(identity: RequestIdentity, answers: QuestionAnswer[]) {
    const key = `${identity.sessionId}:${identity.requestId}`; const q = questions.get(key);
    if (!q || !q.actionable || q.runtimeId !== identity.runtimeId || q.sourceEpoch !== identity.sourceEpoch || !connected || !isPending(q.status)) throw new Error('问题已失效。');
    const continued = continuedQuestions.get(key); const d = continued ? undefined : deliveryFor(identity, 'question');
    if (!Array.isArray(answers) || answers.length !== q.questions.length || new Set(answers.map(a => a.questionId)).size !== answers.length) throw new Error('请完整填写每个问题。');
    const mapped = q.questions.map(question => {
      const answer = answers.find(a => a.questionId === question.id);
      if (!answer || !Array.isArray(answer.values) || !answer.values.length || answer.values.some(v => typeof v !== 'string' || !v.trim() || v.length > 4096) || question.type === 'single' && answer.values.length !== 1) throw new Error('问题答案格式不正确。');
      const labels = new Set(question.options?.map(o => o.label)); const selected = answer.values.filter(v => labels.has(v)); const custom = answer.values.filter(v => !labels.has(v)).join('\n');
      return { id: question.id, selected, ...(custom ? { custom } : {}) };
    });
    if (d) d.submitting = true;
    q.status = 'submitting'; q.actionable = false; q.revision = revision(identity.sessionId); options.publish(frame('question.requested', structuredClone(q)));
    const decision = watchDecision(key);
    try {
      if (continued) {
        const accepted = await transport!.request('userQuestions/answer', { agentId: identity.sessionId, callId: continued, answer: { answers: mapped } });
        if (accepted !== true) throw new Error('DSH 未接收此答案。');
        continuedQuestions.delete(key); q.status = 'answered'; q.actionable = false; q.revision = revision(identity.sessionId); options.publish(frame('question.resolved', structuredClone(q))); emitSession(identity.sessionId);
      } else if (d) {
        const accepted = await transport!.request('$events/result', { clientId: d.clientId, eventId: d.eventId, outcome: { kind: 'result', value: { answers: mapped } } });
        if (accepted !== undefined) throw new Error('没有收到匹配的 DSH 答案确认。');
        if (!d.durableCallId) {
          q.status = 'answered'; q.actionable = false; q.revision = revision(identity.sessionId);
          options.publish(frame('question.resolved', structuredClone(q))); emitSession(identity.sessionId);
        } else if (await decision.promise !== 'answered') throw new Error('没有收到匹配的 DSH 答案确认。');
      }
    } catch { if (d && deliveries.has(d.eventId)) finalizeDelivery(d, 'unavailable'); else { q.status = 'unavailable'; q.actionable = false; q.revision = revision(identity.sessionId); options.publish(frame('question.resolved', structuredClone(q))); emitSession(identity.sessionId); } throw new Error('答案提交失败，请回到 DSH 确认状态。'); }
    finally { decision.stop(); }
  }
  return { connect, disconnect, welcome, snapshot, respondApproval, respondQuestion, stop: disconnect };
}
