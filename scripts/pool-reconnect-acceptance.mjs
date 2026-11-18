import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { FakeHost } from '../tests/helpers/dsh-host.ts';
import { fixture } from './native-fixture.mjs';

// The transport fixture controls when the authoritative snapshot and decisions
// arrive. The app uses its normal authentication, preload and renderer paths.
const host = new FakeHost();
const paper = { id:'field', question:'先整理哪一页？' };
const waiting = (id, text = paper.question) => ({ active:[{ callId:id, questions:[{...paper,question:text}] }], settled:[] });
const seed = active => [{sessionId:'a',running:true,title:'笔记'}, {sessionId:'b',running:true,title:'清单',
  stats:{userQuestions:active}}];
host.sessions = seed(waiting('original'));
await host.start();
let f;
try {
  f = await fixture();
  const {page} = f;
  await page.evaluate(async () => { await window.glass.setSettings({appearance:'whale-pool',sound:false,animation:'full',autoApproval:false,desktopOptics:false}); });
  await page.evaluate(link => window.glass.connectDSH(link), host.link());
  const read = () => page.evaluate(() => window.glass.getState());
  const pool = page.locator('.pool-view');
  const input = page.getByRole('textbox',{name:'你的回答'});
  const requests = () => page.evaluate(() => window.glass.windowAction('approval',true));
  const reconnect = () => page.evaluate(link => window.glass.connectDSH(link),host.link());
  async function dropAndReconnect(rows) {
    // End the live host stream. No new facts are valid until a fresh snapshot arrives.
    host.end('gateway');
    await expect.poll(async () => (await read()).stale).toBe(true);
    host.sessions = rows; await reconnect();
    await expect.poll(async () => (await read()).stale).toBe(false);
  }
  await page.evaluate(() => window.glass.selectSession('b'));
  await requests(); await input.fill('清单的原草稿');
  const old = await read();
  await dropAndReconnect(seed(waiting('original')));
  await requests(); await expect(input).toHaveValue('清单的原草稿');
  let current = await read();
  assert.equal(current.selectedSession,'b'); assert.notEqual(current.epoch,old.epoch);
  await dropAndReconnect(seed(waiting('replacement')));
  await requests(); await expect(input).toHaveValue('');
  await input.fill('替换之后的草稿');
  await dropAndReconnect(seed(waiting('replacement','一个不同的问题')));
  await requests(); await expect(input).toHaveValue('');
  await input.fill('不应复活');
  host.auditEvents.set('b',[{type:'turn/end',seq:20,data:{reason:{kind:'completed'}}}]);
  await dropAndReconnect(seed({active:[],settled:[{callId:'replacement'}]}));
  await expect(pool).toHaveAttribute('data-pool-scene','completed');
  await expect(input).toHaveCount(0); await expect(pool).not.toHaveAttribute('data-pool-cue','completed');
  // A new live request with a delayed receipt never turns into permission on a click.
  assert.ok(host.audit('b',{type:'turn/start',seq:21,data:{turn:2}}));
  host.suppressDecision = true;
  assert.ok(host.waterfall({eventId:'late',agentId:'b',event:'user-questions/request',
    request:{wait:{callId:'late-call'},questions:[paper]}}));
  await requests(); await input.fill('等待正式回执');
  await page.getByRole('button',{name:'提交回答',exact:true}).click();
  await expect(pool).toHaveAttribute('data-pool-reaction','submitting');
  host.control({type:'projection',sessionId:'a',key:'userQuestions',value:{active:[],settled:[{callId:'late-call'}]}});
  await expect(pool).toHaveAttribute('data-pool-reaction','submitting');
  await expect(page.getByRole('button',{name:'等待确认…',exact:true})).toBeDisabled();
  host.control({type:'projection',sessionId:'b',key:'userQuestions',value:{active:[],settled:[{callId:'late-call'}]}});
  await expect.poll(async () => (await page.evaluate(() => window.glass.getWindowState())).submissions.some(r=>r.status==='confirmed')).toBe(true);
  await expect(pool).toHaveAttribute('data-pool-scene','running');
  const results={sameDraft:true,selectedSessionAfterReconnect:true,replacedRequestCleared:true,changedQuestionCleared:true,
    resolvedDuringOutage:true,noHistoricalCelebration:true,waitedForMatchingSessionReceipt:true};
  const out=resolve('reports/pool-companion-prototype'); await mkdir(out,{recursive:true});
  await writeFile(join(out,'session-recovery.json'),JSON.stringify(results,null,2));
  console.log(results);
} finally { try { await f?.app.close(); } finally { await host.stop(); } }
