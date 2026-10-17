import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createBridge } from '../packages/bridge/src/index';
import { mockSnapshot, mockWelcome } from '../packages/adapters/mock/src/index';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });
async function setup() {
  const bridge = await createBridge({ welcome: mockWelcome, snapshot: mockSnapshot });
  closers.push(bridge.close);
  return bridge;
}
async function rejection(url: string, token?: string, origin?: string) {
  return await new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) } });
    ws.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
    ws.on('error', reject);
    ws.on('open', () => { ws.close(); reject(new Error('unauthorized connection opened')); });
  });
}
describe('loopback bridge', () => {
  it('rejects snapshot requests before handshake', async () => {
    const b = await setup();
    const ws = new WebSocket(b.url, { headers: { Authorization: `Bearer ${b.token}` } });
    await once(ws, 'open');
    const closed = once(ws, 'close');
    ws.send(JSON.stringify({ kind: 'glass.snapshot.request', reason: 'initial' }));
    expect((await closed)[0]).toBe(1008);
  });
  it('rejects excessive client messages', async () => {
    const b = await setup();
    const ws = new WebSocket(b.url, { headers: { Authorization: `Bearer ${b.token}` } });
    await once(ws, 'open');
    const closed = once(ws, 'close');
    ws.send(JSON.stringify({ kind: 'glass.hello', protocolVersion: 1, clientNonce: 'rate-test' }));
    for (let i = 0; i < 45; i++) ws.send(JSON.stringify({ kind: 'glass.snapshot.request', reason: 'refresh' }));
    expect((await closed)[0]).toBe(1008);
  });
  it('rejects missing, incorrect token and browser origins', async () => {
    const b = await setup();
    expect(await rejection(b.url)).toBe(401);
    expect(await rejection(b.url, 'wrong')).toBe(401);
    expect(await rejection(b.url, b.token, 'http://untrusted.local')).toBe(403);
  });
  it('requires hello, sends snapshot on request and refuses a second client', async () => {
    const b = await setup();
    const ws = new WebSocket(b.url, { headers: { Authorization: `Bearer ${b.token}` } });
    await once(ws, 'open');
    const welcome = once(ws, 'message');
    ws.send(JSON.stringify({ kind: 'glass.hello', protocolVersion: 1, clientNonce: 'test-nonce' }));
    expect(JSON.parse(String((await welcome)[0])).kind).toBe('glass.welcome');
    expect(await rejection(b.url, b.token)).toBe(409);
    const snapshot = once(ws, 'message');
    ws.send(JSON.stringify({ kind: 'glass.snapshot.request', reason: 'initial' }));
    expect(JSON.parse(String((await snapshot)[0])).payload.sessions).toHaveLength(2);
    const closed = once(ws, 'close');
    ws.send(JSON.stringify({ kind: 'approval.respond', decision: 'allowed-once' }));
    expect((await closed)[0]).toBe(1008);
  });
  it('closes oversized payloads and allows a clean reconnect', async () => {
    const b = await setup();
    const ws = new WebSocket(b.url, { headers: { Authorization: `Bearer ${b.token}` } });
    ws.on('error', () => {});
    await once(ws, 'open');
    const closed = new Promise<number>(resolve => ws.once('close', code => resolve(code)));
    ws.send('x'.repeat(270000));
    expect(await closed).toBe(1009);
    const next = new WebSocket(b.url, { headers: { Authorization: `Bearer ${b.token}` } });
    await once(next, 'open'); next.close();
  });
});
