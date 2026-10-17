import { randomUUID } from 'node:crypto';
import type { Approval, Frame, Question, Session } from '@glass/protocol';
import { HostTransport, bounded, record, type RecordValue } from './transport';

export const dshIntegration = Object.freeze({ status: 'AVAILABLE', mode: 'authenticated-host', respondApproval: true, respondQuestion: true,
  reason: '通过用户提供的本机 Host 认证链接连接；具体答复能力仅由本次连接的有效请求授予。' });
export type RequestIdentity = { runtimeId: string; sourceEpoch: string; sessionId: string; requestId: string };
export type QuestionAnswer = { questionId: string; values: string[] };
type Delivery = { eventId: string; clientId: string; identity: RequestIdentity; kind: 'approval' | 'question'; submitting: boolean; cancelled?: boolean };
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

/** All Host credentials and delivery IDs remain in this main-process adapter. */
export function createDshAdapter(options: Options) {
  let runtimeId = randomUUID(); let epoch = randomUUID(); let clientId = ''; let connected = false; let generation = 0;
  let transport: HostTransport | undefined; let poll: ReturnType<typeof setInterval> | undefined;
  const sessions = new Map<string, Session>(); const approvals = new Map<string, Approval>(); const questions = new Map<string, Question>();
  const revisions = new Map<string, number>(); const deliveries = new Map<string, Delivery>(); const followed = new Set<string>();
  const terminal = new Map<string, Session['phase']>(); const archived = new Set<string>();
  const toolArguments = new Map<string, { name: string; preview: string; complete: boolean }>();
  const auditApprovals = new Map<string, string>(); const continuedQuestions = new Map<string, string>();
  let readyResolve: (() => void) | undefined; let readyReject: ((error: Error) => void) | undefined;
  let baseline = false; let gatewayReady = false;
  const revision = (id: string) => { const next = (revisions.get(id) ?? 0) + 1; revisions.set(id, next); return next; };
  function frame(kind: Frame['kind'], payload: unknown): Frame { return { protocolVersion: 1, messageId: randomUUID(), sentAt: new Date().toISOString(), runtimeId, epoch, kind, payload } as Frame; }
  function welcome(): Frame { return frame('glass.welcome', { source: 'dsh', capabilities: { observeSessions: connected, observeTodos: connected, observeTools: connected,
    // Connection-level support only: each concrete decision still requires a matching live delivery (see deliveryFor).
    respondApproval: connected, respondQuestion: connected } }); }
  function snapshot(): Frame { return frame('glass.snapshot', { sessions: [...sessions.values()].slice(-100), approvals: [...approvals.values()].slice(-100), questions: [...questions.values()].slice(-100) }); }
  function emitSession(id: string) {
    const session = sessions.get(id); if (!session) return;
    const waitingApproval = [...approvals.values()].some(a => a.sessionId === id && isPending(a.status));
    const waitingQuestion = [...questions.values()].some(q => q.sessionId === id && isPending(q.status));
    session.phase = archived.has(id) ? 'archived' : waitingApproval ? 'waiting-approval' : waitingQuestion ? 'waiting-question' : terminal.get(id) ?? (session.agentStatus === 'idle' ? 'finished' : session.agentStatus === 'unknown' ? 'unknown' : 'working');
    session.lastSourceSeq = revision(id);
    if (connected) options.publish(frame('session.upserted', structuredClone(session)));
  }
  function ensureSession(id: string, row: RecordValue = {}): Session | undefined {
    if (!id || id.length > 200) return;
    let session = sessions.get(id);
    if (!session) {
      if (sessions.size >= 100) return;
      session = { runtimeId, sessionId: id, title: '未命名会话', workspaceLabel: bounded(row.cwd, 'DSH', 160), agentStatus: row.running === true ? 'running' : 'idle', phase: row.running === true ? 'working' : 'finished', todos: [], activities: [], lastSourceSeq: 0 };
      sessions.set(id, session);
    }
    if (typeof row.cwd === 'string') session.workspaceLabel = bounded(row.cwd, 'DSH', 160);
    if (typeof row.running === 'boolean') session.agentStatus = row.running ? 'running' : 'idle';
    return session;
  }
  function applyProjections(id: string, values: unknown) {
    const session = ensureSession(id); if (!session) return;
    const p = record(values);
    if ('title' in p) session.title = bounded(p.title, '未命名会话');
    if ('todos' in p) session.todos = Array.isArray(p.todos) ? p.todos.slice(0, 1000).map(record).filter(t => typeof t.content === 'string' && ['pending', 'in_progress', 'completed'].includes(String(t.status))).map(t => ({ content: bounded(t.content), status: t.status as 'pending' | 'in_progress' | 'completed' })) : [];
    const userQuestions = record(p.userQuestions);
    if (Array.isArray(userQuestions.active)) {
      const activeIds = new Set<string>();
      for (const value of userQuestions.active) {
        const q = record(value); const callId = bounded(q.callId, '', 180); if (!callId) continue;
        const requestId = `question:${callId}`; activeIds.add(requestId);
        const items = questionItems(q.questions); if (!items.length) continue;
        const previous = questions.get(`${id}:${requestId}`);
        if (!previous || ![...deliveries.values()].some(d => d.identity.sessionId === id && d.identity.requestId === requestId)) {
          const canContinue = q.state === 'continued' && session.agentStatus === 'running';
          if (canContinue) continuedQuestions.set(`${id}:${requestId}`, callId);
          else continuedQuestions.delete(`${id}:${requestId}`);
          questions.set(`${id}:${requestId}`, { requestId, runtimeId, sessionId: id, sourceEpoch: epoch, createdAt: previous?.createdAt ?? new Date().toISOString(), status: 'pending', actionable: canContinue, revision: revision(id), questions: items });
        }
      }
      for (const [key, q] of questions) if (q.sessionId === id && q.requestId.startsWith('question:') && isPending(q.status) && !activeIds.has(q.requestId)) {
        q.status = 'answered'; q.actionable = false; q.revision = revision(id); questions.set(key, q); continuedQuestions.delete(key);
        if (connected) options.publish(frame('question.resolved', q));
      }
      if (connected) for (const q of questions.values()) if (q.sessionId === id && activeIds.has(q.requestId)) options.publish(frame('question.requested', q));
    }
    emitSession(id);
  }
  function follow(id: string) {
    if (followed.has(id) || sessions.get(id)?.agentStatus !== 'running') return;
    followed.add(id); transport?.subscribe(`audit:${id}`, 'session/follow', { request: { address: { kind: 'session', sessionId: id }, maxMessages: 80 } });
  }
  function event(id: string, value: unknown) {
    const session = ensureSession(id); if (!session) return;
    const e = record(value); const data = record(e.data); const type = bounded(e.type);
    if (type === 'turn/start') { terminal.delete(id); session.agentStatus = 'running'; }
    if (type === 'turn/end') {
      session.agentStatus = 'idle'; const reason = bounded(record(data.reason).kind);
      terminal.set(id, reason === 'aborted' ? 'cancelled' : reason === 'error' || reason === 'blocked' ? 'error' : 'finished');
      if (reason === 'aborted' || reason === 'error') session.activities = session.activities.map(a => a.status === 'running' || a.status === 'pending' ? { ...a, status: reason === 'aborted' ? 'cancelled' : 'error' } : a);
    }
    if (type === 'todo/write') applyProjections(id, { todos: data.todos });
    if (type === 'tool/call') {
      const callId = bounded(data.callId, '', 200); const name = bounded(data.name, 'tool', 200);
      if (callId) {
        let parsed: unknown; try { parsed = JSON.parse(bounded(data.arguments)); } catch { parsed = undefined; }
        const containsSensitive = (v: unknown): boolean => Array.isArray(v) ? v.some(containsSensitive) : Object.entries(record(v)).some(([key, nested]) => /(?:secret|password|token|authorization|api.?key|^env$)/i.test(key) || containsSensitive(nested));
        const args = record(parsed); const encoded = JSON.stringify(args); const complete = parsed !== undefined && Object.keys(args).length > 0 && !containsSensitive(parsed) && encoded.length <= 4096;
        toolArguments.set(`${id}:${callId}`, { name, preview: complete ? bounded(args.command, encoded) : '参数包含敏感字段、过长或格式不可验证，请在 DSH 中确认。', complete });
        session.activities = [{ callId, toolName: name, summary: name, sourceSeq: revision(id), status: 'running' as const }, ...session.activities.filter(a => a.callId !== callId)].slice(0, 100);
        for (const a of approvals.values()) if (a.sessionId === id && a.callId === callId && a.toolName === name && isPending(a.status)) {
          const tool = toolArguments.get(`${id}:${callId}`)!; a.commandPreview = tool.preview; a.displayDetails = tool.complete ? 'complete' : 'partial'; a.actionable = tool.complete && [...deliveries.values()].some(d => d.identity.requestId === a.requestId); a.revision = revision(id);
          if (connected) options.publish(frame('approval.requested', structuredClone(a)));
        }
      }
    }
    if (type === 'tool/result') {
      const message = record(data.message); const callId = bounded(message.toolCallId, '', 200);
      session.activities = session.activities.map(a => a.callId === callId ? { ...a, status: message.isError === true || data.error ? 'error' : 'success', resultSummary: message.isError === true || data.error ? '工具执行失败' : '工具执行完成', sourceSeq: revision(id) } : a);
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
        for (const d of [...deliveries.values()]) if (d.identity.sessionId === id && d.identity.requestId === requestId) deliveries.delete(d.eventId);
        if (connected) options.publish(frame('approval.resolved', structuredClone(a)));
      }
    }
    emitSession(id);
  }
  function finalizeDelivery(delivery: Delivery, status: Approval['status'] | Question['status']) {
    deliveries.delete(delivery.eventId); const key = `${delivery.identity.sessionId}:${delivery.identity.requestId}`;
    if (delivery.kind === 'approval') { const a = approvals.get(key); if (a) { a.status = status as Approval['status']; a.actionable = false; a.revision = revision(a.sessionId); if (connected) options.publish(frame('approval.resolved', structuredClone(a))); } }
    else { const q = questions.get(key); if (q) { q.status = status as Question['status']; q.actionable = false; q.revision = revision(q.sessionId); if (connected) options.publish(frame('question.resolved', structuredClone(q))); } }
    emitSession(delivery.identity.sessionId);
  }
  function gateway(value: unknown) {
    const g = record(value);
    if (g.type === 'ready') { clientId = bounded(g.clientId, '', 200); gatewayReady = !!clientId; checkReady(); return; }
    if (g.type === 'cancel') { const d = deliveries.get(bounded(g.eventId)); if (d) { if (d.submitting) d.cancelled = true; else finalizeDelivery(d, 'cancelled'); } return; }
    if (g.type === 'emit') {
      const args = Array.isArray(g.args) ? g.args : []; const id = bounded(args[0], '', 200);
      if (g.event === 'api-session/added') { const row = record(args[0]); const sid = bounded(row.sessionId, '', 200); if (ensureSession(sid, row)) { applyProjections(sid, record(row.projections).values); follow(sid); } }
      if (g.event === 'api-session/removed' && sessions.has(id)) { const sourceSeq = revision(id); sessions.delete(id); terminal.delete(id); for (const d of [...deliveries.values()]) if (d.identity.sessionId === id) finalizeDelivery(d, 'unavailable'); if (connected) options.publish(frame('session.removed', { sessionId: id, sourceSeq })); }
      if (g.event === 'api-session/status' && ensureSession(id)) { sessions.get(id)!.agentStatus = args[1] === true ? 'running' : 'idle'; if (args[1] === true) { terminal.delete(id); follow(id); } emitSession(id); }
      if (g.event === 'api-session/error' && sessions.has(id)) { terminal.set(id, 'error'); sessions.get(id)!.agentStatus = 'idle'; emitSession(id); }
      return;
    }
    const eventId = bounded(g.eventId, '', 200); const sessionId = bounded(g.agentId, '', 200); const request = record(g.request);
    if (g.type !== 'waterfall' || !clientId || !eventId || !sessionId || !ensureSession(sessionId) || deliveries.has(eventId)) return;
    const createdAt = new Date().toISOString();
    if (g.event === 'approval/request') {
      const toolName = bounded(request.toolName, '', 200); if (!toolName) return;
      const requestId = `approval:${randomUUID()}`; const identity = { runtimeId, sourceEpoch: epoch, sessionId, requestId };
      const callId = bounded(request.callId, '', 200); const tool = toolArguments.get(`${sessionId}:${callId}`); const complete = !!tool?.complete && tool.name === toolName;
      const a: Approval = { ...identity, toolName, ...(callId ? { callId } : {}), reason: bounded(request.displayReason, bounded(request.reason, '需要确认此操作')), ...(tool ? { commandPreview: tool.preview } : {}), displayDetails: complete ? 'complete' : 'partial', status: 'pending', actionable: complete, createdAt, revision: revision(sessionId) };
      approvals.set(`${sessionId}:${requestId}`, a); deliveries.set(eventId, { eventId, clientId, identity, kind: 'approval', submitting: false });
      if (connected) options.publish(frame('approval.requested', structuredClone(a))); emitSession(sessionId);
    }
    if (g.event === 'user-questions/request') {
      const items = questionItems(request.questions); if (!items.length) return;
      const callId = bounded(record(request.wait).callId, '', 180); const requestId = callId ? `question:${callId}` : `question:${randomUUID()}`;
      const identity = { runtimeId, sourceEpoch: epoch, sessionId, requestId };
      const q: Question = { ...identity, createdAt, revision: revision(sessionId), status: 'pending', actionable: true, questions: items };
      questions.set(`${sessionId}:${requestId}`, q); deliveries.set(eventId, { eventId, clientId, identity, kind: 'question', submitting: false });
      if (connected) options.publish(frame('question.requested', structuredClone(q))); emitSession(sessionId);
    }
  }
  function checkReady() { if (baseline && gatewayReady) readyResolve?.(); }
  function item(stream: string, value: unknown) {
    if (stream === 'gateway') return gateway(value);
    const v = record(value);
    if (stream === 'control') {
      if (v.type === 'baseline') { const projections = record(record(v.value).projections); for (const [id, p] of Object.entries(projections)) if (sessions.has(id)) applyProjections(id, record(p).values); baseline = true; checkReady(); }
      if (v.type === 'projection') { const id = bounded(v.sessionId, '', 200); if (sessions.has(id)) applyProjections(id, { [bounded(v.key)]: v.value }); }
      return;
    }
    if (stream === 'workspace') {
      const w = v.type === 'baseline' ? record(v.value) : v;
      if (Array.isArray(w.archivedSessionIds)) { archived.clear(); for (const id of w.archivedSessionIds) if (typeof id === 'string') archived.add(id); for (const id of sessions.keys()) emitSession(id); }
      return;
    }
    if (stream.startsWith('audit:')) {
      const id = stream.slice(6);
      if (v.type === 'snapshot') { applyProjections(id, record(v.projections).values); if (Array.isArray(v.records)) for (const entry of v.records) { const row = record(entry); if (row.type === 'event') event(id, row.event); } }
      if (v.type === 'event') event(id, v.event);
    }
  }
  function disconnected() {
    if (!transport) return;
    connected = false; transport.close(); transport = undefined; clearInterval(poll); poll = undefined;
    for (const d of [...deliveries.values()]) finalizeDelivery(d, 'unavailable'); clientId = '';
    for (const a of approvals.values()) a.actionable = false;
    for (const q of questions.values()) q.actionable = false; continuedQuestions.clear();
    readyReject?.(new Error('DSH 实时连接已断开。')); options.onConnection('disconnected');
  }
  async function refreshList() {
    const current = transport; if (!current) return;
    const result = record(await current.request('session/list', { _request: {} }));
    if (current !== transport) return;
    if (!Array.isArray(result.items)) throw new Error('DSH 会话列表格式不兼容。');
    for (const value of result.items.slice(0, 100)) { const row = record(value); const id = bounded(row.sessionId, '', 200); if (ensureSession(id, row)) { applyProjections(id, record(row.projections).values); follow(id); } }
  }
  async function connect(link: string): Promise<void> {
    disconnect(); const attempt = ++generation; runtimeId = randomUUID(); epoch = randomUUID(); baseline = false; gatewayReady = false;
    sessions.clear(); approvals.clear(); questions.clear(); revisions.clear(); deliveries.clear(); followed.clear(); terminal.clear(); archived.clear(); toolArguments.clear(); auditApprovals.clear(); continuedQuestions.clear(); options.onConnection('connecting');
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
      poll = setInterval(() => { void refreshList().catch(() => disconnected()); }, 5000); poll.unref();
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
    try { await transport!.request('$events/result', { clientId: d.clientId, eventId: d.eventId, outcome: { kind: 'result', value: outcome } }); if (deliveries.has(d.eventId)) finalizeDelivery(d, outcome); }
    catch { if (deliveries.has(d.eventId)) finalizeDelivery(d, 'unavailable'); throw new Error('审批提交失败，请回到 DSH 确认状态。'); }
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
    else { q.status = 'submitting'; q.actionable = false; }
    try {
      if (continued) {
        const accepted = await transport!.request('userQuestions/answer', { agentId: identity.sessionId, callId: continued, answer: { answers: mapped } });
        if (accepted !== true) throw new Error('DSH 未接收此答案。');
        continuedQuestions.delete(key); q.status = 'answered'; q.actionable = false; q.revision = revision(identity.sessionId); options.publish(frame('question.resolved', structuredClone(q))); emitSession(identity.sessionId);
      } else if (d) { await transport!.request('$events/result', { clientId: d.clientId, eventId: d.eventId, outcome: { kind: 'result', value: { answers: mapped } } }); if (deliveries.has(d.eventId)) finalizeDelivery(d, 'answered'); }
    } catch { if (d && deliveries.has(d.eventId)) finalizeDelivery(d, 'unavailable'); else { q.status = 'unavailable'; q.actionable = false; q.revision = revision(identity.sessionId); options.publish(frame('question.resolved', structuredClone(q))); emitSession(identity.sessionId); } throw new Error('答案提交失败，请回到 DSH 确认状态。'); }
  }
  return { connect, disconnect, welcome, snapshot, respondApproval, respondQuestion, stop: disconnect };
}
