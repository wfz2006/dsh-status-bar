import { fixture } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const results=[];
for(const scale of [1,1.25,1.5]){
  const f=await fixture({},['--force-device-scale-factor='+scale]);
  try{
    const {page,menu,app,mainId}=f;
    await page.evaluate(()=>window.glass.setSettings({animation:'off',autoApproval:false}));
    await menu('mock-long-approval');await menu('view-approval');
    await expect.poll(async()=>(await page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(1);
    for(const [width,height] of [[380,250],[400,320],[560,640]]){
      await page.evaluate(b=>window.glass.resizeWindow(b),{x:100,y:100,width,height});
      const footer=await page.locator('.decision-buttons').boundingBox();
      const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,overflow:document.documentElement.scrollWidth>innerWidth}));
      assert.equal(viewport.overflow,false);assert.ok(footer.y>=0&&footer.y+footer.height<=viewport.height-3);
      results.push({scale,width,height,viewport,footer});
    }
    await menu('view-peek');
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>window.glass.setSettings({theme}),theme);
      assert.equal(await page.locator('.peek-main').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
    }
    assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isDestroyed(),mainId),false);
  }finally{await f.app.close();}
}
await writeFile('reports/electron-redesign/layout-matrix.json',JSON.stringify({scope:'Electron process forced device scale factors, actual Windows desktop setting remains 150%; not a physical monitor/system-DPI switch test',results},null,2));
console.log('Electron process scale 1/1.25/1.5; footer sizes 380×250/400×320/560×640; light/dark single surface: PASS');
