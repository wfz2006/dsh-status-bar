import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { FakeHost } from '../tests/helpers/dsh-host.ts';

const scenario = process.argv[2] ?? 'all';
const output = resolve('reports/review-ui');
const f = await fixture();
const host = new FakeHost(); host.sessions = [{ sessionId: 'review', running: true, title: '审查 · 交互细节' }];
const report = { result: 'FAIL', scenario, checks: [], errors: [] };
try {
  const { app, page, menu, mainId } = f;
  page.on('pageerror', error => report.errors.push(error.message));
  await host.start();
  await page.evaluate(link => window.glass.connectDSH(link), host.link());
  await page.evaluate(() => window.glass.setSettings({ animation: 'full', sound: false, autoApproval: false, theme: 'light', material: 'transparent' }));
  if (scenario === 'ids') {
    host.gateway({ type: 'emit', event: 'api-session/added', args: [{ sessionId: '__proto__', running: true, agentAvailable: true, projections: { values: { title: '特殊 ID 会话' } } }] });
    await menu('view-expanded');
    const picker = page.getByRole('button', { name: /选择会话/ });
    await picker.click(); await page.getByRole('option', { name: /特殊 ID 会话/ }).click();
    await expect(page.locator('.task-heading h1')).toHaveText('特殊 ID 会话');
    await picker.click(); await page.getByRole('option', { name: /审查 · 交互细节/ }).click();
    report.checks.push('a new __proto__ session survives actual Host/Main/preload delivery and can be selected');
  }
  if (scenario === 'all' || scenario === 'tabs') {
    await menu('view-expanded');
    const processTab = page.getByRole('tab', { name: '过程', exact: true });
    const stepsTab = page.getByRole('tab', { name: /^步骤/ });
    await processTab.focus(); await page.keyboard.press('ArrowRight');
    await expect(stepsTab).toHaveAttribute('aria-selected', 'true'); await expect(stepsTab).toBeFocused();
    await expect(processTab).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('Home'); await expect(processTab).toBeFocused();
    await page.keyboard.press('End'); await expect(stepsTab).toBeFocused();
    await page.keyboard.press('ArrowRight'); await expect(processTab).toBeFocused();
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await processTab.getAttribute('id'));
    report.checks.push('Arrow/Home/End roving focus, selected tab and labelled panel stay synchronized');
  }
  if (scenario === 'all' || scenario === 'drafts' || scenario === 'ids') {
    const id = scenario === 'ids' ? 'constructor' : 'q1';
    for (const [eventId, callId, questionId] of [['q-event-1', 'q-call-1', id], ['q-event-2', 'q-call-2', 'q2']])
      host.waterfall({ eventId, agentId: 'review', event: 'user-questions/request', request: { wait: { callId }, questions: [{ id: questionId, question: '待回答 ' + questionId }] } });
    await menu('view-approval');
    const answer = page.getByRole('textbox', { name: '你的回答' });
    await answer.fill('第一份未提交草稿');
    await page.getByRole('button', { name: '问题 2', exact: true }).click();
    await expect(answer).toHaveValue(''); await answer.fill('第二份未提交草稿');
    await page.getByRole('button', { name: '问题 1', exact: true }).click();
    await expect(answer).toHaveValue('第一份未提交草稿');
    await page.getByRole('button', { name: '问题 2', exact: true }).click();
    await expect(answer).toHaveValue('第二份未提交草稿');
    // Remove the first request, then add a new question with the same question
    // id. Drafts belong to request identities, not question IDs or queue slots.
    host.control({ type: 'projection', sessionId: 'review', key: 'userQuestions', seq: 10, value: { active: [], settled: [{ callId: 'q-call-1' }, { callId: 'q-call-2' }] } });
    await expect(page.getByRole('textbox')).toHaveCount(0);
    host.waterfall({ eventId: 'q-event-3', agentId: 'review', event: 'user-questions/request', request: { wait: { callId: 'q-call-3' }, questions: [{ id, question: '新的请求' }] } });
    await menu('view-approval');
    await expect(answer).toHaveValue('');
    assert.equal(host.requests.some(r => r.method === '$events/result' || r.method === 'userQuestions/answer'), false);
    report.checks.push('question queue keeps drafts per request, clears ended drafts and never sends an answer on selection');
  }
  if (scenario === 'all' || scenario === 'copy') {
    host.audit('review', { type: 'tool/call', seq: 20, data: { callId: 'copy-call', name: 'bash', arguments: '{"command":"echo review"}' } });
    host.waterfall({ eventId: 'copy-event', agentId: 'review', event: 'approval/request', request: { toolName: 'bash', callId: 'copy-call' } });
    await menu('view-approval');
    const confirm = page.getByRole('button', { name: /^确认 / });
    if (await confirm.count()) await confirm.click();
    // Exercise the real IPC identity gate; intercept only this owned test
    // process's final OS clipboard write so the user's clipboard is preserved.
    await app.evaluate(({ clipboard }) => { clipboard.writeText = value => { globalThis.__reviewClipboard = value; }; });
    await page.getByRole('button', { name: '复制预览', exact: true }).click();
    await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
    assert.equal(await app.evaluate(() => globalThis.__reviewClipboard), 'echo review');
    await expect(page.getByRole('button', { name: '复制预览', exact: true })).toBeVisible({ timeout: 3000 });
    await app.evaluate(({ clipboard }) => { clipboard.writeText = () => { throw new Error('controlled clipboard failure'); }; });
    await page.getByRole('button', { name: '复制预览', exact: true }).click();
    await expect(page.getByRole('button', { name: '复制失败', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '复制预览', exact: true })).toBeVisible({ timeout: 3000 });
    report.checks.push('copy uses the real IPC gate and provides temporary visible success/error feedback; OS clipboard is intercepted');
  }
  if (scenario === 'all' || scenario === 'hide') {
    await menu('view-capsule');
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).blur(), mainId);
    await page.mouse.move(72, 22); await page.mouse.down();
    await expect(page.locator('main')).toHaveAttribute('data-drag', 'pressed');
    report.focusedDuringSyntheticPress = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), mainId);
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).hide(), mainId);
    await expect(page.locator('main')).not.toHaveAttribute('data-drag');
    await page.mouse.up();
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).show(), mainId);
    report.checks.push('native hide clears a pointer press even when document.hidden is unreliable and no extra blur occurs');
  }
  if (scenario === 'all') {
    await menu('view-approval');
    await page.evaluate(() => window.glass.resizeWindow({ x: 220, y: 160, width: 360, height: 360 }));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => window.glass.setSettings({ theme }), theme);
      const backing = await page.addStyleTag({ content: 'html{background:' + (theme === 'light' ? '#e4edf4' : '#172331') + '!important;}' });
      assert.equal(await page.locator('main').evaluate(el => el.scrollWidth > el.clientWidth), false);
      const body = await page.locator('.approval-body:visible').boundingBox(), footer = await page.locator('.approval-footer:visible').boundingBox();
      assert.ok(body.y + body.height <= footer.y + 1, 'request content cannot cover the decision footer');
      await mkdir(output, { recursive: true }); await page.screenshot({ path: resolve(output, theme + '.png') }); await backing.evaluate(el => el.remove());
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await menu('view-expanded');
    const before = await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId);
    await page.getByRole('tab', { name: /^步骤/ }).click();
    assert.equal(await page.locator('.task-panel').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.deepEqual(await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).getBounds(), mainId), before);
    report.checks.push('360 DIP request layout stays unclipped in both themes; reduced motion keeps tab changes immediate and window bounds fixed');
  }
  assert.deepEqual(report.errors, []); report.result = 'PASS';
} catch (error) { report.error = String(error); throw error; }
finally {
  await f.app.close(); await host.stop(); await mkdir(output, { recursive: true });
  await writeFile(resolve(output, scenario + '.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
