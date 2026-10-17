import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';
import { assertApprovalResponse, assertQuestionResponse } from '../apps/desktop/src/main/request-gate';
import { createDshAdapter } from '../packages/adapters/dsh/src/index';
import { initialProjection, reduceProjection, type Frame, type Projection } from '../packages/protocol/src/index';

type Args = Record<string, unknown>;
type Seed = {
  sessionId: string; cwd?: string; running?: boolean; title?: string;
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
};
type AuthMode = 'ok' | 'not-found' | 'foreign' | 'no-cookie';
const TOKEN = 'host-token';
const COOKIE = `glass_host=${TOKEN}`;
const object = (value: unknown): Args => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Args : {};

/** Minimal stand-in for the official DSH Host: cookie handshake, unary JSON-RPC and the remote.mux socket. */
class FakeHost {
  sessions: Seed[] = [];
  auth: AuthMode = 'ok';
  rejectResults = false;
  rpc?: (method: string, args: Args) => unknown;
  readonly requests: { method: string; args: Args }[] = [];
  readonly openStreams: string[] = [];
  readonly auditEvents = new Map<string, Args[]>();
  authAttempts = 0;
  origin = '';
  private server?: Server;
  private wss?: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly streams = new Map<string, WebSocket>();

  async start() {
    this.server = createServer((request, response) => { this.http(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); else response.destroy(); }); });
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', socket => this.attach(socket));
    this.server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/api/remote.mux' || !request.headers.cookie?.includes(COOKIE)) { socket.destroy(); return; }
      this.wss?.handleUpgrade(request, socket, head, client => { this.sockets.add(client); this.wss?.emit('connection', client, request); });
    });
    await new Promise<void>(resolve => { this.server?.listen(0, '127.0.0.1', resolve); });
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  link(token = TOKEN) { return `${this.origin}/?token=${token}`; }

  async stop() {
    if (!this.server) return;
    for (const socket of [...this.sockets]) socket.terminate();
    const wss = this.wss; const server = this.server;
    this.server = undefined; this.wss = undefined; this.streams.clear(); this.sockets.clear();
    await new Promise<void>(resolve => { if (wss) wss.close(() => resolve()); else resolve(); });
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }

  send(stream: string, value: unknown) {
    const socket = this.streams.get(stream);
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify({ type: 'item', streamId: stream, value }));
    return true;
  }

  waterfall(event: { eventId: string; agentId: string; event: string; request: Args }) { return this.send('gateway', { type: 'waterfall', ...event }); }
  gateway(value: Args) { return this.send('gateway', value); }
  audit(sessionId: string, event: Args) { return this.send(`audit:${sessionId}`, { type: 'event', event }); }

  private attach(socket: WebSocket) {
    socket.on('message', raw => {
      let message: Args;
      try { message = object(JSON.parse(raw.toString())); } catch { return; }
      if (message.type !== 'open') return;
      const stream = String(message.streamId ?? '');
      if (!stream) return;
      this.openStreams.push(stream);
      this.streams.set(stream, socket);
      this.reply(stream);
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      this.sockets.delete(socket);
      for (const [stream, current] of this.streams) if (current === socket) this.streams.delete(stream);
    });
  }

  private reply(stream: string) {
    if (stream === 'control') {
      const projections = Object.fromEntries(this.sessions.map(seed => [seed.sessionId, { values: { title: seed.title ?? seed.sessionId, ...(seed.todos ? { todos: seed.todos } : {}) } }]));
      this.send('control', { type: 'baseline', value: { projections } });
      return;
    }
    if (stream === 'gateway') { this.send('gateway', { type: 'ready', clientId: 'client-1' }); return; }
    if (stream === 'workspace') { this.send('workspace', { type: 'baseline', value: { archivedSessionIds: [] } }); return; }
    if (stream.startsWith('audit:')) {
      const records = (this.auditEvents.get(stream.slice(6)) ?? []).map(event => ({ type: 'event', event }));
      this.send(stream, { type: 'snapshot', projections: { values: {} }, records });
    }
  }

  private async http(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      this.authAttempts += 1;
      if (this.auth !== 'ok') { this.failAuth(response); return; }
      if (url.searchParams.getAll('token').length !== 1 || url.searchParams.get('token') !== TOKEN) { response.writeHead(200).end(); return; }
      response.writeHead(303, { Location: '/', 'Set-Cookie': `${COOKIE}; Path=/; HttpOnly; SameSite=Strict` }).end();
      return;
    }
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/')) { response.writeHead(404).end(); return; }
    if (!request.headers.cookie?.includes(COOKIE)) { response.writeHead(401).end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    let body: Args;
    try { body = object(JSON.parse(raw)); } catch { response.writeHead(400).end(); return; }
    const method = decodeURIComponent(url.pathname.slice(5));
    const args = object(object(body.payload).args);
    this.requests.push({ method, args });
    let result: Args = { ok: true, value: true };
    if (method === '$events/result' && this.rejectResults) result = { ok: false };
    else if (this.rpc) result = { ok: true, value: this.rpc(method, args) };
    else if (method === 'session/list') result = { ok: true, value: { items: this.sessions.map(seed => ({ sessionId: seed.sessionId, cwd: seed.cwd ?? 'C:\\ws', running: seed.running ?? false, projections: { values: { title: seed.title ?? seed.sessionId } } })) } };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ type: 'server-response', rpcId: String(body.rpcId ?? ''), result }));
  }

  private failAuth(response: ServerResponse) {
    if (this.auth === 'not-found') { response.writeHead(200).end(); return; }
    if (this.auth === 'foreign') { response.writeHead(303, { Location: 'http://203.0.113.5/', 'Set-Cookie': `${COOKIE}; Path=/` }).end(); return; }
    response.writeHead(303, { Location: '/' }).end();
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(options: { seeds?: Seed[]; auth?: AuthMode } = {}) {
  const host = new FakeHost();
  if (options.seeds) host.sessions = options.seeds;
  if (options.auth) host.auth = options.auth;
  cleanups.push(() => host.stop());
  await host.start();
  const frames: Frame[] = [];
  const connections: string[] = [];
  let projection: Projection = initialProjection();
  const adapter = createDshAdapter({
    publish: frame => { frames.push(frame); projection = reduceProjection(projection, frame); },
    onConnection: connection => {
      connections.push(connection);
      if (connection !== 'connected') projection = reduceProjection(projection, { kind: connection === 'connecting' ? 'transport.connecting' : 'transport.closed' });
    },
  });
  cleanups.push(() => adapter.stop());
  return { host, adapter, frames, connections, state: () => projection };
}

describe('dsh host contract', () => {
  it('rejects malformed links before contacting any host', async () => {
    const h = await setup();
    const links = [
      'http://example.com/?token=x',
      'https://127.0.0.1:1/?token=x&extra=1',
      'http://user:pass@127.0.0.1:1/?token=x',
      `${h.host.link()}#fragment`,
      `${h.host.link()}&token=second`,
      'http://127.0.0.1:1/subpath?token=x',
      'http://127.0.0.1:1/',
    ];
    for (const link of links) await expect(h.adapter.connect(link)).rejects.toThrow(/连接 DSH 失败/);
    expect(h.host.authAttempts).toBe(0);
    expect(h.frames).toHaveLength(0);
  });

  it('refuses authentication that does not establish a host session', async () => {
    for (const auth of ['not-found', 'foreign', 'no-cookie'] as const) {
      const h = await setup({ auth });
      await expect(h.adapter.connect(h.host.link())).rejects.toThrow(/连接 DSH 失败/);
      expect(h.host.requests).toHaveLength(0);
    }
    const wrong = await setup();
    await expect(wrong.adapter.connect(wrong.host.link('wrong-token'))).rejects.toThrow(/连接 DSH 失败/);
    expect(wrong.host.requests).toHaveLength(0);
  });

  it('projects sessions, todos and capabilities after a verified connect', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', title: '构建会话', cwd: 'C:\\ws\\alpha', running: true, todos: [{ content: '读规范', status: 'completed' }] }] });
    await h.adapter.connect(h.host.link());
    expect(h.connections).toEqual(['connecting', 'connected']);
    expect(h.frames.map(frame => frame.kind)).toEqual(['glass.welcome', 'glass.snapshot']);
    const welcome = h.frames[0] as Extract<Frame, { kind: 'glass.welcome' }>;
    expect(welcome.payload.source).toBe('dsh');
    expect(welcome.payload.capabilities).toEqual({ observeSessions: true, observeTodos: true, observeTools: true, respondApproval: true, respondQuestion: true });
    const state = h.state();
    expect(state.connection).toBe('connected');
    expect(state.stale).toBe(false);
    expect(state.runtimeId).toBe(welcome.runtimeId);
    expect(state.sessions['s1']).toMatchObject({ title: '构建会话', workspaceLabel: 'C:\\ws\\alpha', agentStatus: 'running', phase: 'working' });
    expect(state.sessions['s1']?.todos).toEqual([{ content: '读规范', status: 'completed' }]);
    expect(h.host.openStreams).toEqual(expect.arrayContaining(['control', 'gateway', 'workspace', 'audit:s1']));
    expect(h.host.requests.map(request => request.method)).toEqual(['session/list']);
    expect(JSON.stringify(h.frames)).not.toContain(TOKEN);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('applies audit todo and turn events to the followed session', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'todo/write', data: { todos: [{ content: 'A', status: 'pending' }, { content: 'B', status: 'in_progress' }] } });
    await expect.poll(() => h.state().sessions['s1']?.todos.length, { timeout: 3000 }).toBe(2);
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    await expect.poll(() => h.state().sessions['s1']?.phase, { timeout: 3000 }).toBe('finished');
    expect(h.state().sessions['s1']?.agentStatus).toBe('idle');
  });

  it('only actionables complete approvals and submits through the live delivery identity', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }) } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1', reason: '执行测试' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    const approval = h.state().approvals[0]!;
    expect(approval).toMatchObject({ toolName: 'bash', status: 'pending', actionable: true, displayDetails: 'complete', commandPreview: 'pnpm test' });
    expect(h.state().sessions['s1']?.phase).toBe('waiting-approval');
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    expect(() => assertApprovalResponse(h.state(), identity, 'allowed-once')).not.toThrow();
    await h.adapter.respondApproval(identity, 'allowed-once');
    const submitted = h.host.requests.find(request => request.method === '$events/result')!;
    expect(submitted.args).toMatchObject({ clientId: 'client-1', eventId: 'ev1', outcome: { kind: 'result', value: 'allowed-once' } });
    await expect.poll(() => h.state().approvals[0]?.status, { timeout: 3000 }).toBe('allowed-once');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    expect(h.state().sessions['s1']?.phase).toBe('working');
  });

  it('keeps approvals without verifiable arguments non-actionable', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', reason: '执行命令' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    const approval = h.state().approvals[0]!;
    expect(approval).toMatchObject({ displayDetails: 'partial', actionable: false });
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    expect(() => assertApprovalResponse(h.state(), identity, 'allowed-once')).toThrow();
    await expect(h.adapter.respondApproval(identity, 'allowed-once')).rejects.toThrow(/参数尚未完整/);
    expect(h.host.requests.some(request => request.method === '$events/result')).toBe(false);
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: JSON.stringify({ apiKey: 'sk-live-secret' }) } });
    h.host.waterfall({ eventId: 'ev2', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c2' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(2);
    const sensitive = h.state().approvals.find(item => item.callId === 'c2')!;
    expect(sensitive.displayDetails).toBe('partial');
    expect(sensitive.commandPreview).toMatch(/敏感字段/);
    expect(JSON.stringify(h.frames)).not.toContain('sk-live-secret');
  });

  it('finalizes cancelled approvals and host-rejected submissions', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"git push"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    h.host.gateway({ type: 'cancel', eventId: 'ev1' });
    await expect.poll(() => h.state().approvals[0]?.status, { timeout: 3000 }).toBe('cancelled');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '{"command":"deploy"}' } });
    h.host.waterfall({ eventId: 'ev2', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c2' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(2);
    const second = h.state().approvals[1]!;
    h.host.rejectResults = true;
    await expect(h.adapter.respondApproval({ runtimeId: second.runtimeId, sourceEpoch: second.sourceEpoch, sessionId: 's1', requestId: second.requestId }, 'rejected'))
      .rejects.toThrow(/审批提交失败/);
    await expect.poll(() => h.state().approvals[1]?.status, { timeout: 3000 }).toBe('unavailable');
    expect(h.state().approvals[1]?.actionable).toBe(false);
  });

  it('answers questions only through a live delivery and refuses foreign identities', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'q1-ev', agentId: 's1', event: 'user-questions/request', request: {
      wait: { callId: 'w1' }, questions: [{ id: 'q1', question: '选哪个?', options: [{ label: '甲' }, { label: '乙' }] }],
    } });
    await expect.poll(() => h.state().questions.length, { timeout: 3000 }).toBe(1);
    const question = h.state().questions[0]!;
    expect(question.actionable).toBe(true);
    expect(question.questions[0]).toMatchObject({ id: 'q1', type: 'single', allowCustom: true });
    const identity = { runtimeId: question.runtimeId, sourceEpoch: question.sourceEpoch, sessionId: 's1', requestId: question.requestId };
    const answers = [{ questionId: 'q1', values: ['乙'] }];
    expect(() => assertQuestionResponse(h.state(), identity, answers)).not.toThrow();
    expect(() => assertQuestionResponse(h.state(), { ...identity, requestId: 'approval:nope' }, answers)).toThrow();
    await h.adapter.respondQuestion(identity, answers);
    const submitted = h.host.requests.find(request => request.method === '$events/result')!;
    expect(submitted.args).toMatchObject({ eventId: 'q1-ev', outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['乙'] }] } } });
    await expect.poll(() => h.state().questions[0]?.status, { timeout: 3000 }).toBe('answered');
  });

  it('fails closed when the host channel drops', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals[0]?.actionable, { timeout: 3000 }).toBe(true);
    const approval = h.state().approvals[0]!;
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    await h.host.stop();
    await expect.poll(() => h.state().connection, { timeout: 3000 }).toBe('disconnected');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    await expect(h.adapter.respondApproval(identity, 'allowed-once')).rejects.toThrow(/失效/);
  });

  it('tracks session lifecycle events from the gateway', async () => {
    const h = await setup();
    await h.adapter.connect(h.host.link());
    expect(h.state().sessions).toEqual({});
    h.host.gateway({ type: 'emit', event: 'api-session/added', args: [{ sessionId: 's2', cwd: 'C:\\ws\\beta', running: true, projections: { values: { title: '新会话' } } }] });
    await expect.poll(() => h.state().sessions['s2']?.title, { timeout: 3000 }).toBe('新会话');
    expect(h.host.openStreams).toContain('audit:s2');
    h.host.gateway({ type: 'emit', event: 'api-session/status', args: ['s2', false] });
    await expect.poll(() => h.state().sessions['s2']?.agentStatus, { timeout: 3000 }).toBe('idle');
    h.host.gateway({ type: 'emit', event: 'api-session/removed', args: ['s2'] });
    await expect.poll(() => h.state().sessions['s2'], { timeout: 3000 }).toBeUndefined();
  });
});
