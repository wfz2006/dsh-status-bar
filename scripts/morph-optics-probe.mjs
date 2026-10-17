import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const f=await fixture(),out='reports/approval-morph',label=process.env.GLASS_MORPH_LABEL??'before';await mkdir(out,{recursive:true});
const results=[];
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'full',theme:'light',pin:'always'}));
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.backdrop('repeating-linear-gradient(90deg,#eeeeee 0 8px,#181818 8px 10px,#eeeeee 10px 32px)');
 await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
 await expect.poll(()=>f.page.locator('.desktop-backdrop').getAttribute('data-frame')).not.toBe(null);
 for(const action of ['expand','approval','expand']) {
  await f.menu('view-capsule');await f.page.waitForTimeout(170);
  const samples=await f.page.evaluate(async action=>{
   const samples=[],start=performance.now();void window.glass.windowAction(action);
   while(performance.now()-start<700){await new Promise(requestAnimationFrame);const root=document.querySelector('main'),s=document.querySelector('.lg-material-surface'),canvas=document.querySelector('.desktop-backdrop'),image=document.querySelector(`#${s?.__lgId} feImage`),filter=document.getElementById(s?.__lgId);samples.push({t:performance.now()-start,mode:root.dataset.morph,width:innerWidth,height:innerHeight,visible:getComputedStyle(canvas).visibility==='visible',coverage:canvas.dataset.coverage??null,lite:!!s?.__lgLite,passes:filter?.querySelectorAll('feDisplacementMap').length??0,mapWidth:Number(image?.getAttribute('width')),mapHeight:Number(image?.getAttribute('height'))});}return samples;
  },action);
  const end=samples.find(s=>s.t>20&&s.mode==='idle')?.t??null;
  const firstFull=samples.find(s=>s.height>70&&s.visible&&s.passes===3&&Math.abs(s.mapWidth-s.width)<=2&&Math.abs(s.mapHeight-s.height)<=2)?.t??null;
  const growing=samples.filter(s=>s.height>70&&s.mode==='expanding');
  if(label==='after') {
   assert.ok(growing.length>5,'Observe actual native expansion');assert.ok(growing.every(s=>s.passes===3),'Never drop RGB dispersion while expanding');assert.ok(growing.every(s=>s.visible),'Do not blank the whole valid captured intersection');assert.ok(firstFull!==null&&end!==null&&firstFull<end-100,'Sized RGB refraction must appear before morph completion');
   assert.ok(samples.slice(-10).every(s=>s.coverage==='full'&&s.visible&&s.passes===3&&Math.abs(s.mapWidth-s.width)<=2&&Math.abs(s.mapHeight-s.height)<=2),'Settle on a fully covered, correctly sized lens');
  }
  results.push({action,end,firstFull,fullAfterEnd:firstFull!==null&&end!==null?firstFull-end:null,blankSamples:samples.filter(s=>!s.visible).length,growingSamples:growing.length,growingRGBFraction:growing.filter(s=>s.passes===3).length/Math.max(1,growing.length),samples});
 }
 await writeFile(`${out}/morph-${label}.json`,JSON.stringify(results,null,2));console.log(results.map(({samples,...summary})=>({...summary,samples:samples.length})));
}finally {await f.app.close();}
