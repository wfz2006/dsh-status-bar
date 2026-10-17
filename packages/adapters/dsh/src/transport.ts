import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export type RecordValue = Record<string, unknown>;
export function record(value: unknown): RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}; }
export function bounded(value: unknown, fallback = '', max = 4096): string { return typeof value === 'string' ? value.slice(0, max) : fallback; }

/** Deliberately accepts an explicitly supplied Host link, never a Profile or discovery file. */
export function parseHostLink(link: string): URL {
  let url: URL;
  try { url = new URL(link); } catch { throw new Error('请输入有效的 DSH 本机认证链接。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
    url.username || url.password || url.hash || url.pathname !== '/' ||
    [...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length !== 1 ||
    !url.searchParams.get('token') || url.searchParams.get('token')!.length > 4096) throw new Error('仅支持带 token 的本机 DSH Host 根链接。');
  return url;
}

export class HostTransport {
  private cookie = '';
  private origin = '';
  private socket?: WebSocket;
  private controller = new AbortController();
  private streams = new Set<string>();
  constructor(private readonly onItem: (stream: string, value: unknown) => void, private readonly onClose: () => void) {}

  async authenticate(link: string): Promise<void> {
    const url = parseHostLink(link);
    this.origin = url.origin;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]) });
    const location = response.headers.get('location');
    const cookies = response.headers.getSetCookie();
    if (response.status !== 303 || !location || new URL(location, url).origin !== this.origin ||
      new URL(location, url).pathname !== '/' || !cookies.length) throw new Error('DSH 认证失败或认证链接已失效。');
    this.cookie = cookies.map(cookie => cookie.split(';')[0]).filter(Boolean).join('; ');
    if (!this.cookie || this.cookie.length > 16384) throw new Error('DSH 未返回有效的本机认证。');
  }

  async request(method: string, args: RecordValue): Promise<unknown> {
    if (!this.cookie || !this.origin) throw new Error('DSH 尚未认证。');
    const rpcId = randomUUID();
    const response = await fetch(`${this.origin}/api/${method}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
      headers: { Cookie: this.cookie, Origin: this.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    });
    if (!response.ok) throw new Error('DSH Host 请求失败。');
    const body = record(await response.json()); const result = record(body.result);
    if (body.type !== 'server-response' || body.rpcId !== rpcId || result.ok !== true) throw new Error('DSH Host 拒绝了请求。');
    return result.value;
  }

  async open(): Promise<void> {
    const url = new URL('/api/remote.mux', this.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { Cookie: this.cookie, Origin: this.origin }, maxPayload: 4 * 1024 * 1024, handshakeTimeout: 10000 });
    this.socket = socket;
    socket.on('message', data => {
      let message: RecordValue;
      try { message = record(JSON.parse(data.toString())); } catch { socket.close(1002); return; }
      const stream = bounded(message.streamId);
      if (!this.streams.has(stream)) return;
      if (message.type === 'item') this.onItem(stream, message.value);
      if (message.type === 'error' || message.type === 'end') { this.streams.delete(stream); socket.close(1000); }
    });
    socket.on('close', () => this.onClose());
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', () => reject(new Error('无法连接 DSH 实时通道。'))); });
    // Keep an error listener after the handshake; no raw errors containing credentials are logged.
    socket.on('error', () => socket.close());
  }

  subscribe(stream: string, endpoint: string, args: RecordValue = {}): void {
    this.streams.add(stream);
    this.socket?.send(JSON.stringify({ type: 'open', streamId: stream, endpoint, payload: { args } }));
  }

  close(): void {
    this.controller.abort(); this.cookie = ''; this.origin = ''; this.streams.clear();
    this.socket?.removeAllListeners(); this.socket?.on('error', () => {}); this.socket?.terminate(); this.socket = undefined;
  }
}
