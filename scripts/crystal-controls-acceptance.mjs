import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),out='reports/crystal-controls';await mkdir(out,{recursive:true});const results=[];
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'light',pin:'always'}));
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.menu('mock-approval-queue');await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(2);
 await f.menu('view-approval');
 await f.page.evaluate(()=>window.glass.subscribeOpticsFrame(frame=>{const colors=window.__crystalColors;if(!colors)return;let invalid=0;for(let i=0;i<frame.pixels.length;i+=4)if(!colors.some(c=>c.every((v,j)=>Math.abs(frame.pixels[i+j]-v)<4)))invalid++;window.__crystalInput={invalid,width:frame.windowWidth,height:frame.windowHeight};}));
 for(const [tone,colors] of [['light',['#fafafa','#b8b8b8']],['dark',['#303842','#111923']]]) {
  await f.page.evaluate(({tone,colors})=>{window.__crystalInput=null;window.__crystalColors=colors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));return window.glass.setSettings({theme:tone});},{tone,colors});
  await f.backdrop(`repeating-linear-gradient(90deg,${colors[0]} 0 16px,${colors[1]} 16px 32px)`);
  await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>f.page.evaluate(()=>!!window.__crystalInput && window.__crystalInput.invalid===0 && getComputedStyle(document.querySelector('.desktop-backdrop')).visibility==='visible'),{timeout:10000}).toBe(true);
  for(const label of ['允许一次','拒绝'])await expect(f.page.getByRole('button',{name:label,exact:true})).toBeDisabled();
  const buttons=await f.page.locator('.decision-buttons button').evaluateAll(list=>list.map(e=>{const b=e.getBoundingClientRect();return {x:b.x*devicePixelRatio,y:b.y*devicePixelRatio,width:b.width*devicePixelRatio,height:b.height*devicePixelRatio};}));
  const css=await f.page.locator('.command-preview').evaluate(e=>({filter:getComputedStyle(e).backdropFilter,shadow:getComputedStyle(e).boxShadow,background:getComputedStyle(e).backgroundImage}));assert.equal(css.filter,'none','Clear controls must not blur the background');
  await f.page.screenshot({path:`${out}/${tone}-crystal.png`});
  const opaque=await f.page.addStyleTag({content:`.glass .decision-buttons button{background:${tone==='light'?'#fff':'#121b27'}!important;backdrop-filter:none!important;}`});
  await f.page.screenshot({path:`${out}/${tone}-opaque-control.png`});await opaque.evaluate(e=>e.remove());
  results.push({tone,buttons,css});
 }
 await writeFile(out+'/geometry.json',JSON.stringify(results,null,2));console.log('Owned striped input, transparent plates, solid labels and disabled decisions: PASS');
}finally {await f.app.close();}
