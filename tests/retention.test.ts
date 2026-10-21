import { expect, it } from 'vitest';
import { SessionCache } from '../packages/adapters/dsh/src/retention';
import { requestWindow } from '../packages/protocol/src/index';
it('does not clear a neighboring session when IDs contain the old delimiter', () => {
  const cache = new SessionCache<string>(); cache.set('s1', 'a:c1', 'one'); cache.set('s1:a', 'c1', 'two');
  cache.deleteSession('s1'); expect(cache.get('s1:a', 'c1')).toBe('two'); expect(cache.size).toBe(1);
});
it('caps long-running tool history while keeping parameters pinned by an unresolved request', () => {
  const cache = new SessionCache<string>(); cache.set('s1', 'active', 'approval parameters');
  for (let i = 0; i < 2000; i++) { cache.set('s1', 'call' + i, 'preview'); cache.trim('s1', 256, new Set(['active'])); }
  expect(cache.size).toBe(256); expect(cache.get('s1', 'active')).toBe('approval parameters');
  expect(cache.get('s1', 'call1999')).toBe('preview'); expect(cache.get('s1', 'call0')).toBeUndefined();
  cache.deleteSession('s1'); expect(cache.size).toBe(0);
});
it('does not evict old unresolved work just because the resolved history fills the projection', () => {
  const active = { id: 'active', status: 'pending' };
  const window = requestWindow([active, ...Array.from({ length: 500 }, (_, i) => ({ id: 'done' + i, status: 'answered' }))]);
  expect(window).toHaveLength(100); expect(window).toContain(active); expect(window[0]?.id).toBe('done401');
});
