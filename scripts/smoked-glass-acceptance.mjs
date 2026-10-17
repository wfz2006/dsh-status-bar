import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),out='reports/smoked-glass';await mkdir(out,{recursive:true});
try {
 await f.page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'off',pin:'always'}));
 await f.menu('view-peek');await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.backdrop('#dddddd');
 await f.page.evaluate(()=>window.glass.subscribeOpticsFrame(f=>{let invalid=0;for(let i=0;i<f.pixels.length;i+=4)if([0,1,2].some(c=>Math.abs(f.pixels[i+c]-221)>3))invalid++;window.__smokeOwned=invalid===0;}));
 await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
 await expect.poll(()=>f.page.evaluate(()=>window.__smokeOwned===true),{timeout:10000}).toBe(true);
 const metadata=await f.page.evaluate(()=>{
  const tint=getComputedStyle(document.querySelector('.glass-tint'));
  const p=document.querySelector('.task-progress').getBoundingClientRect(),s=document.querySelector('.current-step').getBoundingClientRect();
  return {fill:tint.backgroundColor,filter:tint.backdropFilter,textOpacity:getComputedStyle(document.querySelector('h1')).opacity,rootOpacity:getComputedStyle(document.querySelector('main')).opacity,region:{left:50,right:Math.floor(innerWidth*devicePixelRatio)-50,top:Math.ceil((p.bottom+8)*devicePixelRatio),bottom:Math.floor((s.top-8)*devicePixelRatio)}};
 });
 assert.equal(metadata.fill,'rgba(0, 0, 0, 0.1)');assert.equal(metadata.filter,'none');assert.equal(metadata.textOpacity,'1');assert.equal(metadata.rootOpacity,'1');assert.ok(metadata.region.bottom-metadata.region.top>12);
 await f.page.screenshot({path:out+'/black-ten-percent.png'});
 await f.page.locator('.glass-tint').evaluate(e=>e.style.visibility='hidden');
 await f.page.screenshot({path:out+'/no-tint-control.png'});
 await f.page.evaluate(()=>window.glass.setSettings({material:'solid'}));await expect(f.page.locator('.glass-tint')).toHaveCount(0);
 await writeFile(out+'/acceptance.json',JSON.stringify(metadata,null,2));console.log('10% neutral black below text, no blur, owned native input and solid fallback: PASS');
}finally {await f.app.close();}
