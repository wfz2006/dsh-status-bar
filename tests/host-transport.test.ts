import { afterEach, expect, it, vi } from 'vitest';
import { HostTransport } from '../packages/adapters/dsh/src/transport';
import { FakeHost } from './helpers/dsh-host';
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(autoPong: boolean) {
  const host = new FakeHost(); host.autoPong = autoPong; await host.start(); cleanups.push(() => host.stop());
  const close = vi.fn(); const items = vi.fn(); const transport = new HostTransport(items, close);
  cleanups.push(() => transport.close()); await transport.authenticate(host.link());
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); await transport.open();
  return { host, close, items, transport };
}
it('detects a half-open carrier even while HTTP remains healthy', async () => {
  const h = await setup(false); vi.advanceTimersByTime(15000);
  await expect.poll(() => h.host.pings).toBe(1);
  await expect(h.transport.request('session/list', {})).resolves.toEqual({ items: [] });
  vi.advanceTimersByTime(15000); await expect.poll(() => h.close.mock.calls.length).toBe(1);
});
it('keeps a healthy idle carrier and cancels only the removed logical stream', async () => {
  const h = await setup(true);
  h.transport.subscribe('gateway', '$events'); h.transport.subscribe('audit:s1', 'session/follow');
  await expect.poll(() => h.host.openStreams.length).toBe(2);
  for (let n = 1; n <= 3; n++) { vi.advanceTimersByTime(15000); await expect.poll(() => h.host.pings).toBe(n); await new Promise(resolve => setTimeout(resolve, 5)); }
  h.transport.unsubscribe('audit:s1'); await new Promise(resolve => setTimeout(resolve, 10));
  expect(h.host.audit('s1', { type: 'turn/end' })).toBe(false);
  expect(h.host.gateway({ type: 'ready', clientId: 'still-live' })).toBe(true);
  await expect.poll(() => h.items.mock.calls.some(([, item]) => item.clientId === 'still-live')).toBe(true);
  expect(h.close).not.toHaveBeenCalled(); h.transport.close(); vi.advanceTimersByTime(45000); expect(h.close).not.toHaveBeenCalled();
});
