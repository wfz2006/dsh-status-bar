import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const f=await fixture();const out='reports/chrome-redesign';await mkdir(out,{recursive:true});
const results=[];
try {
 await f.page.evaluate(()=>window.glass.setSettings({theme:'dark',animation:'off',pin:'always'}));
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.backdrop('#92b2c8');
 for(const material of ['acrylic','transparent','solid']) {
  const state=await f.page.evaluate(material=>window.glass.setSettings({material}),material);
  assert.notEqual(state.material,'acrylic','No native acrylic may remain under rounded CSS');
  await f.menu('settings');
  await expect(f.page.locator('.drag-mark')).toHaveCount(0);
  const chrome=await f.page.locator('.chrome-group').boundingBox();assert.ok(chrome);
  const size=await f.page.evaluate(()=>[innerWidth,innerHeight]);
  assert.ok(chrome.x+chrome.width<=size[0]-12 && chrome.y>=10,'Toolbar must sit inside the rounded edge');
  const title=await f.page.locator('.panel-heading h1').boundingBox();assert.ok(title);assert.ok(title.x+title.width<=chrome.x,'Header must reserve toolbar space');
  const file=join(tmpdir(),'dsh-chrome-'+material+'.png');await f.capture(file);
  results.push({material,actual:state.settings.material,path:file});
  if(material==='transparent')await f.page.screenshot({path:out+'/settings.png'});
  await f.page.getByRole('button',{name:'返回',exact:true}).click();
 }
 await f.menu('mock-long-approval');await f.menu('view-approval');
 await expect(f.page.locator('.request-details>summary')).toBeVisible({timeout:15000});
 const summary=f.page.locator('.request-details>summary');await expect(summary.locator('svg')).toHaveCount(2);
 assert.equal(await summary.evaluate(e=>getComputedStyle(e).listStyleType),'none');
 await summary.focus();await f.page.keyboard.press('Enter');await expect(f.page.locator('.request-details')).toHaveAttribute('open','');
 await f.page.screenshot({path:out+'/request-open.png'});
 await summary.focus();await f.page.keyboard.press('Enter');await expect(f.page.locator('.request-details')).not.toHaveAttribute('open');
 await f.page.screenshot({path:out+'/request-closed.png'});
 await writeFile(out+'/acceptance.json',JSON.stringify(results,null,2));console.log(results);
}finally {await f.app.close();}
