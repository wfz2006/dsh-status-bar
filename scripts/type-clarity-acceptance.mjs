import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture(),label=process.env.GLASS_TYPE_LABEL??'before',out='reports/type-clarity';await mkdir(out,{recursive:true});
const results=[];let cdp;
const editorial=label.startsWith('editorial');
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'auto',pin:'always'}));await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 if(editorial){await f.menu('mock-approval-queue');await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(2);}
 await f.page.evaluate(()=>{window.__typeExpected=null;window.__typeOwned=false;window.glass.subscribeOpticsFrame(frame=>{if(!window.__typeExpected)return;let invalid=0;for(let i=0;i<frame.pixels.length;i+=4)if(window.__typeExpected.some((v,c)=>Math.abs(v-frame.pixels[i+c])>5))invalid++;window.__typeOwned=invalid===0 && Math.abs(frame.windowWidth-innerWidth*devicePixelRatio)<3 && Math.abs(frame.windowHeight-innerHeight*devicePixelRatio)<3;});});
 cdp=await f.page.context().newCDPSession(f.page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 for(const [tone,color,rgb] of [['light','#e9e5dd',[233,229,221]],['dark','#171c22',[23,28,34]]]) {
  await f.page.evaluate(rgb=>{window.__typeExpected=rgb;window.__typeOwned=false;},rgb);await f.backdrop(color);await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
  for(const mode of (editorial?['capsule','peek','expanded','approval','settings']:['capsule','peek','expanded','settings'])) {
   await f.menu(mode==='settings'?'settings':'view-'+mode);await expect.poll(()=>f.page.evaluate(()=>window.__typeOwned),{timeout:10000}).toBe(true);
   const selector=mode==='capsule'?'.capsule-title':'h1';await expect(f.page.locator(selector)).toContainText(/[\u4e00-\u9fff]/);await f.page.evaluate(()=>document.fonts.ready.then(()=>null));const doc=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
   const expectedChinese=editorial||label==='after'?'Noto Serif SC':'Noto Sans SC';
   if(label==='after'||editorial)await expect.poll(async()=>(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts.some(font=>font.familyName.includes(expectedChinese))).toBe(true);
   const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
   const appearance=await f.page.locator(selector).evaluate(e=>{const s=getComputedStyle(e),root=getComputedStyle(document.querySelector('main'));return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight,shadow:s.textShadow,stroke:s.webkitTextStrokeWidth,filter:s.filter,opacity:s.opacity,radius:root.borderTopLeftRadius};});
   assert.equal(appearance.shadow,'none');assert.equal(appearance.stroke,'0px');assert.equal(appearance.filter,'none');assert.equal(appearance.opacity,'1');
   if(label==='after'||editorial) {assert.equal(appearance.radius,mode==='capsule'?'20px':'22px');assert.ok(fonts.fonts.some(font=>font.familyName.includes(expectedChinese)),JSON.stringify({tone,mode,appearance,fonts}));}
   const roles=[];
   if(editorial)for(const [role,selector,expected] of [['caption','.step-count','Small'],['body','.current-step>span:last-child','Noto-Sans-SC'],['code','.command-preview','Cascadia'],['number','.appearance-slider output','Cascadia']]){
    if(!await f.page.locator(selector).count())continue;
    const {nodeId:roleId}=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
    await expect.poll(async()=>(await cdp.send('CSS.getPlatformFontsForNode',{nodeId:roleId})).fonts.some(font=>font.postScriptName.includes(expected))).toBe(true);
    roles.push({role,fonts:(await cdp.send('CSS.getPlatformFontsForNode',{nodeId:roleId})).fonts});
   }
   await expect.poll(()=>f.page.evaluate(()=>{const c=document.querySelector('.desktop-backdrop');return window.__typeOwned&&getComputedStyle(c).visibility==='visible'&&c.dataset.coverage==='full';}),{timeout:10000}).toBe(true);
   await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await f.page.screenshot({path:`${out}/${label}-${tone}-${mode}.png`});results.push({tone,mode,...appearance,fonts:fonts.fonts,roles});
  }
 }
 await writeFile(`${out}/${label}.json`,JSON.stringify(results,null,2));console.log(results.map(({fonts,...r})=>({...r,fonts:fonts.map(f=>f.familyName+' / '+f.postScriptName)})));
}finally{await cdp?.detach().catch(()=>{});await f.app.close();}
