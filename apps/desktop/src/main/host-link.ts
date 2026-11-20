import { randomUUID } from 'node:crypto';
import { parseHostLink } from '@glass/dsh';

/** The plugin parent alone can mint a fresh link. This uses its inherited IPC
 * channel, without a listening endpoint or credentials in the renderer. */
export function requestHostLink(): Promise<string | undefined> {
  if (!process.connected || !process.send) return Promise.resolve(undefined);
  const id = randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => finish(), 3000);
    function finish(link?: string) {
      clearTimeout(timer);
      process.off('message', onMessage);
      process.off('disconnect', onDisconnect);
      resolve(link);
    }
    function onDisconnect() { finish(); }
    function onMessage(value: unknown) {
      if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'dsh-status-bar:link' ||
        !('id' in value) || value.id !== id) return;
      if (!('link' in value) || typeof value.link !== 'string') { finish(); return; }
      try { finish(parseHostLink(value.link).href); } catch { finish(); }
    }
    process.on('message', onMessage);
    process.once('disconnect', onDisconnect);
    try { process.send!({ type: 'dsh-status-bar:refresh-link', id }, undefined, {}, error => { if (error) finish(); }); }
    catch { finish(); }
  });
}
