import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

export type Args = Record<string, unknown>;
export type Seed = {
  sessionId: string; cwd?: string; running?: boolean; agentAvailable?: boolean; title?: string;
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[];
  stats?: Args;
};
export type AuthMode = 'ok' | 'not-found' | 'foreign' | 'no-cookie';
export const TOKEN = 'host-token';
const COOKIE = `glass_host=${TOKEN}`;
export const object = (value: unknown): Args => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Args : {};

/** Minimal stand-in for the official DSH Host: cookie handshake, unary JSON-RPC and the remote.mux socket. */
export class FakeHost {
  sessions: Seed[] = [];
  auth: AuthMode = 'ok';
  rejectResults = false;
  suppressDecision = false;
  rpc?: (method: string, args: Args) => unknown;
  readonly requests: { method: string; args: Args }[] = [];
  readonly openStreams: string[] = [];
  readonly auditEvents = new Map<string, Args[]>();
  readonly assistantBaselines = new Map<string, Args>();
  readonly followRequests = new Map<string, Args>();
  readonly pending = new Map<string, { agentId: string; event: string; request: Args }>();
  authAttempts = 0;
  autoPong = true;
  pings = 0;
  origin = '';
  private server?: Server;
  private wss?: WebSocketServer;
  private readonly sockets = new Set<WebSocket>();
  private readonly streams = new Map<string, WebSocket>();

  async start() {
    this.server = createServer((request, response) => { this.http(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end(); else response.destroy(); }); });
    this.wss = new WebSocketServer({ noServer: true, autoPong: this.autoPong });
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
  end(stream: string) {
    const socket = this.streams.get(stream); if (!socket) return;
    this.streams.delete(stream); socket.send(JSON.stringify({ type: 'end', streamId: stream }));
  }

  waterfall(event: { eventId: string; agentId: string; event: string; request: Args }) {
    this.pending.set(event.eventId, event);
    if (event.event === 'approval/request') this.audit(event.agentId, { type: 'approval/asked', data: { id: `asked:${event.eventId}`, ...event.request } });
    return this.send('gateway', { type: 'waterfall', ...event });
  }
  gateway(value: Args) { return this.send('gateway', value); }
  control(value: Args) { return this.send('control', value); }
  audit(sessionId: string, event: Args) { return this.send(`audit:${sessionId}`, { type: 'event', event }); }
  assistant(sessionId: string, frame: Args) {
    if (this.followRequests.get(sessionId)?.assistantStream === true) return this.send(`audit:${sessionId}`, { type: 'assistant-stream', frame });
    return false;
  }
  snapshot(sessionId: string, projections: Args) { return this.send(`audit:${sessionId}`, { type: 'snapshot', projections: { values: projections }, records: [] }); }

  private attach(socket: WebSocket) {
    socket.on('ping', () => { this.pings++; });
    socket.on('message', raw => {
      let message: Args;
      try { message = object(JSON.parse(raw.toString())); } catch { return; }
      if (message.type === 'cancel') { this.streams.delete(String(message.streamId)); return; }
      if (message.type !== 'open') return;
      const stream = String(message.streamId ?? '');
      if (!stream) return;
      this.openStreams.push(stream);
      this.streams.set(stream, socket);
      if (message.endpoint === 'session/follow') this.followRequests.set(stream.slice(6), object(object(object(message.payload).args).request));
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
      this.send(stream, { type: 'snapshot', projections: { values: {} }, records,
        ...(this.followRequests.get(stream.slice(6))?.assistantStream === true ? { assistantStream: this.assistantBaselines.get(stream.slice(6)) ?? { revision: 0 } } : {}) });
    }
  }

  private async http(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/connect') {
      this.authAttempts += 1;
      if (this.auth !== 'ok') { this.failAuth(response); return; }
      if (url.searchParams.getAll('token').length !== 1 || url.searchParams.get('token') !== TOKEN || url.searchParams.get('interactions') !== 'answer') { response.writeHead(200).end(); return; }
      response.writeHead(302, { Location: './api/remote.mux', 'Set-Cookie': `${COOKIE}; Path=/; HttpOnly; SameSite=Strict` }).end();
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
    let result: Args = { ok: true, value: method === '$events/result' ? undefined : true };
    if (method === '$events/result' && this.rejectResults) result = { ok: false };
    else if (this.rpc) result = { ok: true, value: await this.rpc(method, args) };
    else if (method === 'session/list') result = { ok: true, value: { items: this.sessions.map(seed => ({ sessionId: seed.sessionId, cwd: seed.cwd ?? 'C:\\ws', running: seed.running ?? false, agentAvailable: seed.agentAvailable ?? seed.running ?? false, projections: { values: { title: seed.title ?? seed.sessionId, ...(seed.stats ?? {}) } } })) } };
    if (method === '$events/result' && result.ok === true && result.value === undefined && !this.suppressDecision) {
      const id = String(args.eventId); const delivery = this.pending.get(id);
      if (delivery) {
        this.gateway({ type: 'cancel', eventId: id });
        if (delivery.event === 'approval/request') this.audit(delivery.agentId, { type: 'approval/decided', data: { id: `asked:${id}`, outcome: object(args.outcome).value } });
        else {
          const callId = object(delivery.request.wait).callId;
          this.send('control', { type: 'projection', sessionId: delivery.agentId, key: 'userQuestions', value: { active: [], settled: [{ callId, answers: object(object(args.outcome).value).answers }] } });
        }
        this.pending.delete(id);
      }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ type: 'server-response', rpcId: String(body.rpcId ?? ''), result }));
  }

  private failAuth(response: ServerResponse) {
    if (this.auth === 'not-found') { response.writeHead(200).end(); return; }
    if (this.auth === 'foreign') { response.writeHead(302, { Location: 'http://203.0.113.5/', 'Set-Cookie': `${COOKIE}; Path=/` }).end(); return; }
    response.writeHead(302, { Location: './api/remote.mux' }).end();
  }
}
