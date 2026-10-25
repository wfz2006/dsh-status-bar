import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

const label = process.argv[2] ?? 'after';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid label');
const host = new FakeHost();
host.sessions = [{ sessionId: 'tool-sync', title: '工具步骤同步夹具', running: false, agentAvailable: false }];
await host.start();
const output = resolve('reports/process-sync');
const report = { result: 'FAIL', label, scope: 'Synthetic official-format Host -> real Electron adapter/IPC/React, visible unfocused window with native optics; DOM and animation-frame opportunities, not user DSH timing or actual GPU presentation.', errors: [], samples: [] };
let f;
try {
  f = await fixture({}, [], process.env.GLASS_AUDIT_APP);
  const { app, page, mainId, menu } = f;
  page.on('pageerror', e => report.errors.push(e.message));
  await page.evaluate(link => window.glass.connectDSH(link), host.link());
  await page.evaluate(() => window.glass.setSettings({ animation: 'full', theme: 'dark', material: 'transparent' }));
  await menu('view-expanded');
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).setPosition(300, 200), mainId);
  await f.backdrop('rgb(90,110,140)');
  await page.evaluate(() => window.glass.setOpticsEnabled(true));
  await expect.poll(() => page.evaluate(() => window.glass.getOpticsState())).toMatchObject({ running: true });
  // Focus a second owned native window; leave the always-on-top Glass visible.
  await app.evaluate(({ BrowserWindow }, id) => {
    const other = BrowserWindow.getAllWindows().find(w => w.id !== id);
    other.setBounds({ x: 20, y: 20, width: 180, height: 100 }); other.show(); other.focus();
  }, mainId);
  report.focused = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), mainId);
  assert.equal(report.focused, false);
  assert.equal(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isVisible(), mainId), true);
  await page.evaluate(() => {
    window.__toolSamples = [];
    window.__toolCompletionAt = 0;
    new MutationObserver(() => {
      for (const row of document.querySelectorAll('.process-entry[data-kind=tool]')) {
        const name = row.querySelector('.entry-title')?.textContent, status = row.dataset.toolStatus;
        if (!name?.startsWith('fixture_read_') || window.__toolSamples.some(s => s.name === name && s.status === status)) continue;
        const s = { name, status, domAt: Date.now(), animation: getComputedStyle(row).animationName };
        window.__toolSamples.push(s);
        const observe = () => {
          s.frameAt ??= Date.now();
          if (Number(getComputedStyle(row).opacity) >= .999) s.opaqueAt = Date.now();
          else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
      }
      if (document.querySelector('main').dataset.state === 'completed') window.__toolCompletionAt ||= Date.now();
    }).observe(document.querySelector('main'), { subtree: true, attributes: true, childList: true, characterData: true });
  });
  assert.equal(host.followRequests.has('tool-sync'), false);
  host.sessions[0].running = true; host.sessions[0].agentAvailable = true;
  const activationAt = Date.now();
  host.gateway({ type: 'emit', event: 'api-session/status', args: ['tool-sync', true] });
  await expect.poll(() => host.followRequests.has('tool-sync'), { timeout: 12000, intervals: [5, 10, 20] }).toBe(true);
  report.subscriptionMs = Date.now() - activationAt;
  host.audit('tool-sync', { type: 'turn/start', seq: 1, data: { turn: 1 } });
  const sent = [];
  for (let i = 0; i < 12; i++) {
    const name = 'fixture_read_' + i, callId = 'call' + i;
    sent.push({ name, status: 'running', at: Date.now() });
    host.audit('tool-sync', { type: 'tool/call', seq: i * 2 + 2, data: { callId, name, arguments: '{}' } });
    await page.waitForFunction(name => window.__toolSamples.some(s => s.name === name && s.status === 'running' && s.opaqueAt), name, { timeout: 1500, polling: 5 });
    sent.push({ name, status: i % 4 === 3 ? 'error' : 'success', at: Date.now() });
    host.audit('tool-sync', { type: 'tool/result', seq: i * 2 + 3, data: { message: { toolCallId: callId, isError: i % 4 === 3 } } });
    await page.waitForFunction(({ name, status }) => window.__toolSamples.some(s => s.name === name && s.status === status && s.opaqueAt), sent.at(-1), { timeout: 1500, polling: 5 });
  }
  const endAt = Date.now();
  host.audit('tool-sync', { type: 'turn/end', seq: 26, data: { reason: { kind: 'completed' } } });
  await expect(page.locator('main')).toHaveAttribute('data-state', 'completed');
  report.completionMs = await page.evaluate(() => window.__toolCompletionAt) - endAt;
  report.samples = (await page.evaluate(() => window.__toolSamples)).map(s => {
    const start = sent.find(v => v.name === s.name && v.status === s.status).at;
    return { name: s.name, status: s.status, domMs: s.domAt - start, frameMs: s.frameAt - start, opaqueMs: s.opaqueAt - start, animation: s.animation };
  });
  const summarize = key => { const values = report.samples.map(s => s[key]).sort((a, b) => a - b); return { median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) }; };
  report.dom = summarize('domMs'); report.frame = summarize('frameMs'); report.opaque = summarize('opaqueMs');
  assert.equal(report.samples.length, 24); assert.deepEqual(report.errors, []);
  if (label !== 'before') {
    assert.ok(report.subscriptionMs < 500, 'native running event subscribes immediately without the inventory poll');
    assert.ok(report.completionMs >= 0 && report.completionMs < 500, 'authoritative completion reaches the UI promptly');
    assert.ok(report.samples.every(s => s.domMs < 500 && s.opaqueMs < 500 && s.animation === 'none'), 'tool progress is not held behind row entrance animations');
  }
  report.result = label === 'before' ? 'BASELINE' : 'PASS';
} catch (error) { report.error = String(error); throw error; }
finally {
  if (f) await f.app.close(); await host.stop();
  await mkdir(output, { recursive: true }); await writeFile(resolve(output, label + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, subscriptionMs: report.subscriptionMs, dom: report.dom, frame: report.frame, opaque: report.opaque, completionMs: report.completionMs, errors: report.errors }));
}
