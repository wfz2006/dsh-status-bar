import { fixture } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
const f=await fixture();
try{
  const {page,app,mainId,menu}=f;
  await page.evaluate(()=>window.glass.setSettings({animation:'off'}));
  await menu('mock-approval-queue');await menu('view-approval');
  await expect.poll(async()=>(await page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(2);
  for(const height of [250,320,340]){
    await page.evaluate(height=>window.glass.resizeWindow({x:200,y:150,width:400,height}),height);
    const before=await page.locator('.decision-buttons').first().boundingBox();
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.ok(before&&before.y>=0&&before.y+before.height<=viewport.height-3,'Decision footer must remain fully visible at '+height+' DIP');
    assert.equal(await page.locator('.decision-buttons').count(),1,'Exactly one identity-bound fixed decision footer');
    const footer=page.locator('.approval-footer');
    assert.equal(await footer.getAttribute('data-request-id'),'mock-approval-1');
    await page.getByRole('button',{name:'查看请求 2',exact:true}).click();
    assert.equal(await footer.getAttribute('data-request-id'),'mock-approval-2');
    await page.locator('.request-details').locator('summary').click();
    await page.locator('.approval-body').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    const after=await page.locator('.decision-buttons').boundingBox();
    assert.deepEqual(after,before,'Body scroll must not move decision footer');
    await expect(page.getByRole('button',{name:'允许一次',exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'拒绝',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'查看请求 1',exact:true}).click();
  }
  await menu('mock-disconnect');await menu('reconnect');
  await expect(page.locator('.request-selector [data-request-id]')).toHaveCount(2);
  assert.equal(await page.locator('.approval-footer').getAttribute('data-request-id'),'mock-approval-1');
  const prefs=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).webContents.getLastWebPreferences(),mainId);
  assert.equal(prefs.sandbox,true);
  console.log('Approval fixed footer at 250/320/340 DIP, queue selection, details scroll, reconnect and fail-closed: PASS');
}finally{await f.app.close();}
