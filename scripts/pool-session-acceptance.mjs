import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

const profile = await mkdtemp(join(tmpdir(), 'pool-official-'));
const userData = await mkdtemp(join(tmpdir(), 'pool-electron-'));
const reportDir = resolve('reports/pool-companion-prototype');
const exe = process.env.DSH_EXE ?? 'D:/DSH/DeepSeek Harness.exe';
const cli = process.env.DSH_CLI ?? 'D:/DSH/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js';
const patch = join(profile, 'pool.patch.yml');
const plugin = resolve('scripts/fixtures/pool-session-host.mjs').replaceAll('\\', '/');
const companion = resolve('packages/dsh-status-bar/lib/index.js').replaceAll('\\', '/');
const executablePath = createRequire(resolve('apps/desktop/package.json'))('electron');
const testApp = join(profile, 'companion');
const cutFile = join(profile, 'cut-realtime');
await mkdir(join(testApp, 'out', 'main'), { recursive: true });
await writeFile(join(testApp, 'package.json'), JSON.stringify({ type: 'module', main: 'out/main/index.js' }));
await writeFile(join(testApp, 'out/main/index.js'), `
  import { app } from 'electron';
  import { existsSync } from 'node:fs';
  app.commandLine.appendSwitch('remote-debugging-port', '0');
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  const link = process.argv.find(arg => arg.startsWith('--dsh-link='))?.slice('--dsh-link='.length);
  const port = Number(new URL(link).port);
  const timer = setInterval(() => {
    if (!existsSync(${JSON.stringify(cutFile)})) return;
    const connections = process._getActiveHandles().filter(handle => handle.remotePort === port && typeof handle.destroy === 'function');
    for (const connection of connections) connection.destroy();
    if (connections.length) clearInterval(timer);
  }, 150);
  timer.unref();
  await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/out/main/index.js')).href)});
`);
await writeFile(patch, JSON.stringify([{ insert: [
  { id: 'pool-acceptance', name: plugin },
  { id: 'dsh-status-bar-plugin', name: companion, config: { appDir: testApp, electronBinary: executablePath, autoReload: false } },
] }]));
await writeFile(join(userData, 'glass-ui.json'), JSON.stringify({ version: 2, announcements: ['whale-pool-v1'],
  settings: { appearance: 'whale-pool', animation: 'full', desktopOptics: false, sound: false, edgeDock: false, autoApproval: false } }));
await mkdir(reportDir, { recursive: true });
const host = spawn(exe, ['--expose-internals', cli, '--profile', 'web', '--patch', patch, '--no-open', '--port', '0'],
  { env: { ...process.env, DSH_HOME: profile, GLASS_POOL_TEST_HOME: profile, ELECTRON_RUN_AS_NODE: '1', GLASS_USER_DATA_DIR: userData, GLASS_SMOKE: '0' }, windowsHide: true });
let output = '', app;
host.stdout.on('data', b => { output += b.toString(); });
host.stderr.on('data', b => { output += b.toString(); });
const checks = [];
try {
  let port;
  await expect.poll(async () => {
    port = await readFile(join(userData, 'DevToolsActivePort'), 'utf8').then(value => Number(value.split(/\r?\n/)[0]), () => 0);
    return port;
  }, { timeout: 30000 }).toBeGreaterThan(0);
  app = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = app.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent('page');
  function observeCues() {
    window.poolCues = [];
    const observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.attributeName === 'data-pool-cue') window.poolCues.push(change.target.getAttribute('data-pool-cue'));
      }
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-pool-cue'] });
  }
  await page.addInitScript(observeCues);
  await page.evaluate(observeCues);
  const ui = page.locator('main.glass');
  await expect(ui).toBeVisible();
  const pool = page.locator('.pool-view');
  const taskIs = s => expect(ui).toHaveAttribute('data-state', s, { timeout: 20000 });
  const sceneIs = s => expect(pool).toHaveAttribute('data-pool-scene', s);
  const mark = m => { checks.push(m); console.info(m); };
  async function capture(name, control) {
    await expect(ui).toHaveAttribute('data-morph', 'idle');
    await expect(pool).toHaveAttribute('data-readable', 'true');
    await expect(pool).toHaveAttribute('data-transition', 'idle');
    await expect(page.locator('.pool-panel-content .approval-header')).toHaveCSS('opacity', '1');
    const hitTest = () => control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity > .95 && element.contains(hit);
    });
    try { await expect.poll(hitTest).toBe(true); }
    catch (error) {
      console.error(name, await control.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const root = element.closest('.request-panel');
        return { control: rect.toJSON(), form: root?.getBoundingClientRect().toJSON(), scroll: root?.scrollTop,
          hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.className };
      }));
      throw error;
    }
    await page.screenshot({ path: join(reportDir, 'live-' + name + '.png') });
  }
  const read = () => page.evaluate(() => window.glass.getState());
  await expect.poll(async () => (await read()).connection).toBe('connected');
  await taskIs('empty'); await sceneIs('empty'); mark('实际宿主连接，无会话');
  await writeFile(join(profile, 'start-fixture'), '');
  await expect.poll(() => output.includes('[pool-test] sessions ready'), {timeout:20000}).toBe(true);
  await expect.poll(async () => Object.keys((await read()).sessions).length, {timeout:18000}).toBe(2);
  await page.evaluate(() => window.glass.selectSession('pool-a'));
  await pool.locator('.pool-whale-target').click();
  await expect(ui).toHaveAttribute('data-mode','peek');
  await writeFile(join(profile, 'start-turn'), '');
  await page.getByRole('button', {name:/其他会话有.*待处理/}).click({timeout:24000});
  const answer = page.getByRole('textbox', {name:'你的回答'});
  await expect(answer).toBeEnabled(); await taskIs('waiting_answer'); await sceneIs('waiting_answer');
  await expect(pool).toHaveAttribute('data-pool-reaction','answering');
  await answer.fill('先看蓝色样本');
  await capture('question', answer);
  mark('实际 Agent 提问，跨会话进入，输入框可回答');
  await page.getByRole('button', {name:/返回「/}).click();
  await expect.poll(async () => (await read()).selectedSession).toBe('pool-a');
  await expect(ui).toHaveAttribute('data-mode','peek');
  await page.getByRole('button', {name:/其他会话有.*待处理/}).click();
  await expect(answer).toHaveValue('先看蓝色样本'); mark('主动返回原会话，再进入保留草稿');
  await page.getByRole('button',{name:'提交回答', exact:true}).click();
  await expect.poll(async () => (await read()).questions.some(q => q.sessionId === 'pool-b' && q.status === 'answered'), {timeout:16000}).toBe(true);
  await expect.poll(() => output.includes('[pool-test] answer matched')).toBe(true);
  await page.getByRole('button',{name:'拒绝', exact:true}).waitFor();
  await taskIs('waiting_approval'); await sceneIs('waiting_approval');
  await expect(page.getByRole('button',{name:'拒绝', exact:true})).toBeEnabled();
  await capture('approval', page.getByRole('button',{name:'拒绝',exact:true})); mark('真实问题已结清，同一 Agent 请求审批');
  await page.getByRole('button',{name:'拒绝', exact:true}).click();
  await expect.poll(() => output.includes('[pool-test] approval rejected'), {timeout:16000}).toBe(true);
  await expect.poll(async () => (await read()).approvals.some(a => a.sessionId === 'pool-b' && a.status === 'rejected')).toBe(true);
  await expect.poll(async () => (await read()).approvals.some(a => a.callId === 'pool-real-review-3' && a.actionable)).toBe(true);
  await page.getByRole('button',{name:'允许一次',exact:true}).click();
  await expect.poll(() => output.includes('[pool-test] approval allowed-once'), {timeout:16000}).toBe(true);
  await expect.poll(async () => (await read()).approvals.some(a => a.callId === 'pool-real-review-3' && a.status === 'allowed-once')).toBe(true);
  await taskIs('completed'); await sceneIs('completed');
  await expect.poll(async () => (await page.evaluate(() => window.glass.getWindowState())).submissions?.filter(s => s.status === 'confirmed').length).toBe(3);
  await expect(page.getByText('DSH 已记录拒绝',{exact:true})).toBeVisible();
  await expect(page.getByText('DSH 已允许本次操作',{exact:true})).toBeVisible();
  await capture('completed', page.getByText('DSH 已允许本次操作',{exact:true})); mark('官方审批服务分别返回拒绝和允许一次，任务结束，三条正式回执分开显示');
  assert.equal(await pool.count(),1);
  assert.equal((await read()).poolEvent?.kind, 'completed');
  await expect.poll(() => page.evaluate(() => window.poolCues.filter(cue => cue === 'completed').length)).toBe(1);
  await page.reload();
  await taskIs('completed'); await sceneIs('completed');
  await expect(pool).toHaveAttribute('data-readable', 'true');
  await expect(pool).toHaveAttribute('data-pool-clip', 'settled');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.poolCues.includes('completed')), false);
  mark('窗口重新加载后直接显示完成姿态，未重播庆祝');
  const epoch = (await read()).epoch;
  await writeFile(cutFile, '');
  await expect.poll(async () => (await read()).stale).toBe(true);
  await page.evaluate(() => window.glass.windowAction('reconnect', true));
  await expect.poll(async () => (await read()).connection).toBe('connected');
  assert.notEqual((await read()).epoch, epoch);
  assert.equal((await read()).selectedSession, 'pool-b');
  mark('中断窗口到官方宿主的实时连接，点击恢复并重新同步原会话');
  await writeFile(join(reportDir,'official-session.json'),JSON.stringify({host:'official isolated DSH web Profile',provider:'deterministic in-process fixture',checks},null,2));
} catch (error) {
  // Do not print the authenticated URL, cookies or app environment.
  console.error(output.split(/\r?\n/).filter(s => /\[pool-test\]|\[E\]|\[W\]/.test(s)).slice(-14).join('\n').replace(/token=[^\s&]+/gi,'token=<redacted>'));
  throw error;
} finally {
  try { await app?.close(); } finally { host.kill(); }
}
