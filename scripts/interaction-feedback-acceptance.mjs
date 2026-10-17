import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),results=[];
const style=e=>({shadow:getComputedStyle(e).boxShadow,border:getComputedStyle(e).borderColor,transform:getComputedStyle(e).transform});
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'full',theme:'light'}));await f.menu('settings');
 const b=f.page.getByRole('button',{name:'返回',exact:true});await f.page.mouse.move(3,150);await f.page.waitForTimeout(180);
 const before=await b.evaluate(style);const viewport=await f.page.evaluate(()=>[innerWidth,innerHeight]);
 await b.hover();await f.page.waitForTimeout(180);const hover=await b.evaluate(style);assert.notEqual(hover.shadow,before.shadow);
 await f.page.mouse.down();await f.page.waitForTimeout(180);const pressed=await b.evaluate(style);assert.notEqual(pressed.shadow,hover.shadow);assert.equal(pressed.transform,'none');assert.deepEqual(await f.page.evaluate(()=>[innerWidth,innerHeight]),viewport);
 const pressedScale=await b.locator('svg').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a);assert.ok(pressedScale<.9,'Contact must visibly compress the icon, not the hit target');
 // Release outside to observe the spring without navigating away from the control.
 await f.page.mouse.move(3,150);await f.page.mouse.up();
 const release=await b.locator('svg').evaluate(async e=>{
  const samples=[],start=performance.now();
  while(performance.now()-start<480){await new Promise(requestAnimationFrame);samples.push({t:performance.now()-start,scale:new DOMMatrixReadOnly(getComputedStyle(e).transform).a,viewport:[innerWidth,innerHeight]});}return samples;
 });
 assert.ok(Math.max(...release.map(s=>s.scale))>1.003,'Release must overshoot gently');assert.ok(Math.abs(release.at(-1).scale-1)<.001,'Spring must settle');assert.ok(release.every(s=>JSON.stringify(s.viewport)===JSON.stringify(viewport)),'Motion must not resize the viewport');
 results.push({before,hover,pressed,pressedScale,release});await b.click();await expect(f.page.locator('.task-capsule')).toBeVisible();await expect(f.page.locator('main')).toHaveCSS('border-radius','20px');
 await f.menu('settings');await f.page.keyboard.press('Tab');const select=f.page.getByRole('combobox',{name:'显示主题'});await select.focus();await expect(select).toHaveCSS('outline-width','2px');
 const toggle=f.page.getByRole('checkbox',{name:'审批时自动展开'});await toggle.check();await expect(toggle).toBeChecked();await toggle.focus();await f.page.keyboard.press('Space');await expect(toggle).not.toBeChecked();
 for(const animation of ['reduced','off']){await f.page.evaluate(animation=>window.glass.setSettings({animation}),animation);await expect(b).toHaveCSS('transition-duration','0s');await expect(b.locator('svg')).toHaveCSS('transition-duration','0s');assert.equal(await toggle.evaluate(e=>getComputedStyle(e,'::after').transitionDuration),'0s');await b.hover();await f.page.mouse.down();await expect(b.locator('svg')).toHaveCSS('transform','none');await f.page.mouse.move(3,150);await f.page.mouse.up();}
 await f.page.evaluate(()=>window.glass.setSettings({animation:'full'}));await f.page.emulateMedia({reducedMotion:'reduce'});await expect(b.locator('svg')).toHaveCSS('transition-duration','0s');assert.equal(await toggle.evaluate(e=>getComputedStyle(e,'::after').transitionDuration),'0s');await f.page.emulateMedia({reducedMotion:'no-preference'});
 await f.menu('mock-long-approval');await f.menu('view-approval');const disabled=f.page.getByRole('button',{name:'允许一次',exact:true});await expect(disabled).toBeDisabled({timeout:15000});
 const preview=f.page.getByRole('group',{name:'允许一次，仅预览'}),pendingBefore=(await f.page.evaluate(()=>window.glass.getState())).approvals;
 await f.page.mouse.move(3,150);const disabledBefore=await disabled.evaluate(style);await preview.hover();await f.page.waitForTimeout(200);const previewHover=await disabled.evaluate(style);assert.notEqual(previewHover.shadow,disabledBefore.shadow);
 await f.page.mouse.down();await f.page.waitForTimeout(100);assert.ok(await disabled.locator('.control-label').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a)<1);await f.page.mouse.up();await expect(f.page.locator('#approval-status')).toContainText('暂不可提交');
 await expect(disabled).toBeDisabled();assert.deepEqual((await f.page.evaluate(()=>window.glass.getState())).approvals,pendingBefore,'Preview feedback must not submit or mutate approvals');
 await mkdir('reports/interaction-feedback',{recursive:true});await writeFile('reports/interaction-feedback/acceptance.json',JSON.stringify(results,null,2));console.log('Spring release, 20px capsule, stable hit target/viewport, keyboard, reduced/off/system motion and disabled decisions: PASS');
}finally {await f.app.close();}
