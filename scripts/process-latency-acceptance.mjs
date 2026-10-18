import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

const output = resolve('reports/process-latency');
await mkdir(output, { recursive:true });
const host = new FakeHost(); host.sessions = [{ sessionId:'latency-fixture', title:'实时过程同步', running:true }];
await host.start();
let f;
const report = { result:'FAIL', scope:'synthetic official-format Host -> real Electron adapter/IPC/React; DOM + animation-frame opportunity, not GPU paint or user DSH timing', errors:[], samples:[] };
try {
  f = await fixture(); const { page, app, mainId, menu } = f;
  page.on('pageerror', error => report.errors.push(error.message));
  await page.evaluate(link => window.glass.connectDSH(link), host.link());
  await page.evaluate(() => window.glass.setSettings({ animation:'full', theme:'dark' }));
  await menu('view-expanded');
  await expect.poll(() => host.followRequests.get('latency-fixture')?.assistantStream).toBe(true);
  await page.evaluate(() => {
    window.__liveSamples = []; window.__liveTarget = '';
    new MutationObserver(() => {
      const row = document.querySelector('.process-entry[data-streaming=true]');
      const text = row?.querySelector('.entry-preview')?.textContent;
      if (!text || text !== window.__liveTarget || window.__liveSamples.some(s => s.text === text)) return;
      const sample = { text, domAt:Date.now(), animation:getComputedStyle(row).animationName, opacity:getComputedStyle(row).opacity };
      window.__liveSamples.push(sample);
      requestAnimationFrame(() => { sample.frameAt = Date.now(); });
    }).observe(document.querySelector('.process-list') ?? document.querySelector('.task-panel'), { subtree:true, childList:true, characterData:true, attributes:true });
  });
  host.assistant('latency-fixture', { type:'start', attemptId:'fixture:1', revision:1, turn:1, step:1, startedAfterSeq:4 });
  let text = ''; const sent = [];
  for (let i = 0; i < 20; i++) {
    text += `片段${i + 1}。`;
    await page.evaluate(value => { window.__liveTarget = value; }, text);
    sent.push(Date.now());
    host.assistant('latency-fixture', { type:'chunk', attemptId:'fixture:1', revision:i + 2, index:i, time:Date.now(), chunk:{ type:'reasoning-delta', index:0, text:`片段${i + 1}。` } });
    await page.waitForFunction(count => window.__liveSamples.length === count && window.__liveSamples.at(-1).frameAt, i + 1, { timeout:1500, polling:10 });
  }
  const rows = page.locator('.process-entry[data-streaming=true]');
  await expect(rows).toHaveCount(1); await expect(rows.locator('.entry-status')).toHaveText('生成中');
  await rows.locator('summary').click(); await expect(rows).toHaveAttribute('open', '');
  const keyBefore = await page.evaluate(async () => Object.values((await window.glass.getState()).sessions)[0].notes[0].id);
  host.audit('latency-fixture', { type:'assistant/message', seq:5, data:{ turn:1, step:1, message:{ content:[{ type:'reasoning', text }] } } });
  host.assistant('latency-fixture', { type:'end', attemptId:'fixture:1', revision:22, index:20, outcome:{ kind:'committed', eventType:'assistant/message', seq:5 } });
  const settled = page.locator('.process-entry[data-streaming=false]');
  await expect(settled).toHaveCount(1); await expect(settled.locator('.entry-status')).toHaveText('已完成');
  await expect(settled).toHaveAttribute('open', '');
  assert.equal(await page.evaluate(async () => Object.values((await window.glass.getState()).sessions)[0].notes[0].id), keyBefore);
  assert.equal(await settled.evaluate(row => getComputedStyle(row).animationName), 'none');
  report.samples = (await page.evaluate(() => window.__liveSamples)).map((s, i) => ({ sequence:i + 1, domMs:s.domAt - sent[i], frameMs:s.frameAt - sent[i], animation:s.animation, opacity:s.opacity }));
  assert.ok(report.samples.every(s => s.domMs < 500 && s.frameMs < 500 && s.animation === 'none' && s.opacity === '1'));
  const timings = report.samples.map(s => s.frameMs).sort((a,b) => a-b);
  report.frameLatencyMs = { median:timings[Math.floor(timings.length/2)], p95:timings[Math.ceil(timings.length*.95)-1], max:timings.at(-1) };
  report.windowFocused = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), mainId);
  host.assistant('latency-fixture', { type:'start', attemptId:'fixture:2', revision:23, turn:1, step:2, startedAfterSeq:5 });
  const burstStarted = Date.now();
  for(let i=0;i<200;i++)host.assistant('latency-fixture', { type:'chunk', attemptId:'fixture:2', revision:i+24, index:i, chunk:{ type:'text-delta', index:0, text:'x' } });
  await expect(page.locator('.process-entry[data-streaming=true] .entry-preview')).toHaveText('x'.repeat(200));
  report.burst = { chunks:200, elapsedUntilAssertMs:Date.now()-burstStarted, lostCharacters:0 };
  host.assistant('latency-fixture', { type:'end', attemptId:'fixture:2', revision:224, index:200, outcome:{ kind:'abandoned' } });
  await expect(page.locator('.process-entry[data-streaming=true]')).toHaveCount(0);
  await expect(settled).toHaveCount(1);
  const backing = await page.addStyleTag({ content:'html{background:#172331!important}' });
  await page.screenshot({ path:resolve(output,'stream-settled.png') });
  await backing.evaluate(el => el.remove());
  assert.deepEqual(report.errors, []);
  report.checks = ['20 prefixes visible before durable commit', 'live row has no entrance delay', 'stable key on every update and settlement', 'opened detail remains open', 'one final row with authoritative completion', '200-chunk burst preserves every character; abandonment removes only preview', 'no renderer errors'];
  report.result = 'PASS';
} catch (error) { report.error = String(error); throw error; }
finally {
  if (f) await f.app.close(); await host.stop();
  await writeFile(resolve(output,'acceptance.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify({ result:report.result, frameLatencyMs:report.frameLatencyMs, errors:report.errors }));
}
