import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { clientSchema, frameSchema, type Frame } from '@glass/protocol';

export type Source = { welcome: () => Frame; snapshot: () => Frame };
export async function createBridge(source: Source) {
  const token = randomBytes(32).toString('hex');
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
  let client: WebSocket | undefined;
  let ready = false;
  server.on('upgrade', (request, socket, head) => {
    function deny(code: number) { socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
    if (request.headers.origin !== undefined || request.url !== '/glass') return deny(403);
    const auth = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return deny(401);
    if (client && client.readyState !== WebSocket.CLOSED) return deny(409);
    wss.handleUpgrade(request, socket, head, ws => { wss.emit('connection', ws); });
  });
  function send(frame: Frame) {
    const checked = frameSchema.safeParse(frame);
    if (!checked.success) return;
    const encoded = JSON.stringify(checked.data);
    if (Buffer.byteLength(encoded) > 256 * 1024) { client?.close(1009, 'Snapshot exceeds limit'); return; }
    if (client?.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 512 * 1024) client.close(1008, 'Backpressure');
      else client.send(encoded);
    }
  }
  wss.on('connection', (ws: WebSocket) => {
    client = ws; ready = false;
    let authenticated = false;
    let count = 0; let windowStart = Date.now();
    const deadline = setTimeout(() => ws.close(1008, 'Hello required'), 2000);
    ws.on('error', () => { /* No raw frames, token or payload in logs. */ });
    ws.on('close', () => { clearTimeout(deadline); if (client === ws) { client = undefined; ready = false; } });
    ws.on('message', (raw, isBinary) => {
      if (Date.now() - windowStart >= 1000) { windowStart = Date.now(); count = 0; }
      if (++count > 40 || isBinary) { ws.close(1008, 'Rate or encoding'); return; }
      let value: unknown;
      try { value = JSON.parse(raw.toString()); } catch { ws.close(1008, 'Invalid JSON'); return; }
      const result = clientSchema.safeParse(value);
      if (!result.success) { ws.close(1008, 'Unsupported message'); return; }
      if (result.data.kind === 'glass.hello') {
        if (authenticated) { ws.close(1008, 'Duplicate hello'); return; }
        authenticated = true; clearTimeout(deadline); send(source.welcome());
      } else {
        if (!authenticated) { ws.close(1008, 'Hello required'); return; }
        send(source.snapshot()); ready = true;
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Bridge address unavailable');
  let heartbeat = 0;
  const ticker = setInterval(() => {
    const welcome = source.welcome();
    if (ready) send({ protocolVersion: 1, messageId: `heartbeat-${++heartbeat}`, runtimeId: welcome.runtimeId, epoch: welcome.epoch, sentAt: new Date().toISOString(), kind: 'glass.heartbeat', payload: { counter: heartbeat } });
  }, 2500);
  return {
    url: `ws://127.0.0.1:${address.port}/glass`, token,
    publish: (f: Frame) => { if (ready) send(f); },
    disconnect: () => client?.close(1012, 'Mock disconnect'),
    close: async () => {
      clearInterval(ticker);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
