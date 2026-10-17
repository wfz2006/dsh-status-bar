import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),out='reports/approval-morph',results=[];await mkdir(out,{recursive:true});
const style=e=>{const s=getComputedStyle(e);return {fill:s.backgroundColor,shadow:s.boxShadow,ink:s.color};};
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'full',theme:'auto',pin:'always'}));await f.menu('mock-approval-queue');
 await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(2);
 await f.menu('view-approval');await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.page.evaluate(()=>{window.__decisionExpected=null;window.__decisionOwned=false;window.glass.subscribeOpticsFrame(frame=>{const rgb=window.__decisionExpected;let invalid=0;if(!rgb)return;for(let i=0;i<frame.pixels.length;i+=4)if(rgb.some((v,c)=>Math.abs(frame.pixels[i+c]-v)>5))invalid++;window.__decisionOwned=invalid===0&&Math.abs(frame.windowWidth-innerWidth*devicePixelRatio)<3&&Math.abs(frame.windowHeight-innerHeight*devicePixelRatio)<3;});});
 for(const [tone,bg,rgb] of [['light','#e9e5dd',[233,229,221]],['dark','#171c22',[23,28,34]]]) {
  await f.page.evaluate(rgb=>{window.__decisionExpected=rgb;window.__decisionOwned=false;},rgb);await f.backdrop(bg);await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>f.page.evaluate(()=>window.__decisionOwned),{timeout:10000}).toBe(true);await expect(f.page.locator('main')).toHaveAttribute('data-backdrop-tone',tone);
  await expect(f.page.locator('.open-original')).toHaveCount(0);await expect(f.page.getByRole('button',{name:'打开 DSH',exact:true})).toBeVisible();assert.ok(!(await f.page.locator('.approval-footer').innerText()).includes('DSH'));
  const approvals=(await f.page.evaluate(()=>window.glass.getState())).approvals;
  await f.page.mouse.move(3,150);await f.page.waitForTimeout(220);await f.page.screenshot({path:out+`/${tone}-approval.png`});
  for(const label of ['拒绝','允许一次']) {
   const button=f.page.getByRole('button',{name:label,exact:true}),wrapper=f.page.getByRole('group',{name:label+'，仅预览'});
   await expect(button).toBeDisabled();await f.page.mouse.move(3,150);await f.page.waitForTimeout(220);
   const idle=await button.evaluate(style),box=await button.boundingBox();assert.match(idle.fill,/0\.18\)/);
   await wrapper.hover();await f.page.waitForTimeout(220);const hover=await button.evaluate(style);assert.notEqual(hover.fill,idle.fill);
   await f.page.mouse.down();await f.page.waitForTimeout(100);const pressed=await button.evaluate(style),scale=await button.locator('.control-label').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a);assert.ok(scale<.97);assert.notEqual(pressed.fill,hover.fill);assert.deepEqual(await button.boundingBox(),box);
   await f.page.mouse.up();await expect(f.page.locator('#approval-status')).toContainText('暂不可提交');await expect(button).toBeDisabled();
   await wrapper.focus();await f.page.keyboard.down('Space');await expect(wrapper).toHaveAttribute('data-pressed','true');await f.page.keyboard.up('Space');await expect(wrapper).toHaveAttribute('data-pressed','false');
   assert.deepEqual((await f.page.evaluate(()=>window.glass.getState())).approvals,approvals,'Feedback must not mutate pending requests');results.push({tone,label,idle,hover,pressed,scale,nativeDisabled:true,noSubmission:true});
  }
  await f.page.getByRole('button',{name:'查看请求 2',exact:true}).click();await expect(f.page.locator('#approval-status')).not.toContainText('暂不可提交');await f.page.getByRole('button',{name:'查看请求 1',exact:true}).click();
 }
 await f.page.evaluate(()=>window.glass.setSettings({animation:'reduced'}));const wrapper=f.page.getByRole('group',{name:'允许一次，仅预览'});await wrapper.hover();await f.page.mouse.down();await expect(wrapper.locator('.control-label')).toHaveCSS('transform','none');await f.page.mouse.up();
 await writeFile(out+'/decision-feedback.json',JSON.stringify(results,null,2));console.log('Compact DSH icon, stronger fills, hover/press/keyboard feedback, reduced motion and no approval submission: PASS');
}finally {await f.app.close();}
