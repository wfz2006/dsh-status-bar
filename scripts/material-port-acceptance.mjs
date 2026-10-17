import { fixture, backgrounds } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const out='reports/edge-material-port';await mkdir(out,{recursive:true});
const f=await fixture();const results={errors:[],geometry:[],pixelTests:[]};
f.page.on('pageerror',e=>results.errors.push(e.message));
async function bitmap(){return f.app.evaluate(async({BrowserWindow},id)=>Array.from((await BrowserWindow.fromId(id).webContents.capturePage()).toBitmap()),f.mainId);}
function difference(a,b){assert.equal(a.length,b.length);let pixels=0;for(let i=0;i<a.length;i+=4)if(a.slice(i,i+3).some((v,c)=>Math.abs(v-b[i+c])>2))pixels++;return pixels;}
async function zeroMap(on){await f.page.evaluate(on=>document.querySelectorAll('#glass-defs feDisplacementMap').forEach(n=>{if(on){n.dataset.scale=n.getAttribute('scale');n.setAttribute('scale','0');}else n.setAttribute('scale',n.dataset.scale);}),on);await f.page.waitForTimeout(200);}
try{
  const {page,app,mainId,menu,capture,backdrop}=f;
  await page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'off',pin:'always'}));
  await expect.poll(async()=>(await page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(1);
  for(const mode of ['capsule','peek','expanded','approval']){
    await menu('view-'+mode);
    await expect.poll(async()=>page.locator('#glass-defs filter').count()).toBe(1);
    await expect.poll(async()=>page.locator('#glass-defs feImage').getAttribute('width')).toBe(String(await page.locator('.lg-material-surface').evaluate(e=>e.offsetWidth)));
    await expect.poll(async()=>page.locator('#glass-defs feImage').getAttribute('height')).toBe(String(await page.locator('.lg-material-surface').evaluate(e=>e.offsetHeight)));
    assert.equal(await page.locator('.lg-optics-clip').count(),1);
    assert.equal(await page.locator('#glass-defs feDisplacementMap').count(),3);
    assert.equal(await page.locator('.glass').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
    results.geometry.push({mode,width:await page.locator('#glass-defs feImage').getAttribute('width'),height:await page.locator('#glass-defs feImage').getAttribute('height')});
  }
  for(const strength of ['clear','balanced','readable']){
    await page.evaluate(strength=>window.glass.setSettings({strength}),strength);
    await expect.poll(async()=>page.locator('#glass-defs filter').count()).toBe(1);
  }
  await page.evaluate(()=>window.glass.setSettings({material:'solid'}));
  await expect(page.locator('#glass-defs filter')).toHaveCount(0);
  await page.evaluate(()=>window.glass.setSettings({material:'system',strength:'balanced'}));
  await expect(page.locator('#glass-defs filter')).toHaveCount(1);
  await menu('view-peek');await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
  const actualHeight=await page.locator('.lg-material-surface').evaluate(e=>e.offsetHeight);
  assert.ok(Math.abs(actualHeight-168)<=2,'Unexpected peek geometry: '+JSON.stringify({actualHeight,state:await page.evaluate(()=>window.glass.getWindowState()),bounds:await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),mainId)}));
  await expect.poll(async()=>page.locator('#glass-defs feImage').getAttribute('height')).toBe(String(actualHeight));
  // Owned, synthetic DOM backdrop. This verifies the copied engine, not desktop optics.
  await page.evaluate(()=>{const bg=document.createElement('div');bg.id='owned-pixel-probe';bg.style.cssText='position:fixed;inset:0;z-index:-1;background:repeating-linear-gradient(90deg,#eecb70 0 4px,#305d82 4px 8px)';document.body.prepend(bg);});
  await page.waitForTimeout(300);const refracted=await bitmap();await zeroMap(true);const straight=await bitmap();
  const domDifference=difference(refracted,straight);assert.ok(domDifference>100,'Reference engine must alter owned backdrop pixels');
  results.pixelTests.push({source:'owned synthetic DOM only',changedPixels:domDifference,refractionVerified:true});
  await writeFile(out+'/dom-acceptance.json',JSON.stringify({...results,nativeStatus:'not yet verified'},null,2));
  await zeroMap(false);await page.locator('#owned-pixel-probe').evaluate(e=>e.remove());
  if(process.argv.includes('--dom-only')) {
    results.nativeStatus='Not run: owned DOM test only';
  } else {
  await backdrop(backgrounds.busy);await capture(out+'/native-peek.png');
  await zeroMap(true);await capture(out+'/native-peek-zero-map.png');
  const desktopDifference=await app.evaluate(({nativeImage},{a,b})=>{
    const first=nativeImage.createFromPath(a).toBitmap(),second=nativeImage.createFromPath(b).toBitmap();let changed=0;
    if(first.length!==second.length)throw new Error('Capture geometry changed');
    for(let i=0;i<first.length;i+=4)if(Math.abs(first[i]-second[i])>2||Math.abs(first[i+1]-second[i+1])>2||Math.abs(first[i+2]-second[i+2])>2)changed++;return changed;
  },{a:process.cwd()+'/'+out+'/native-peek.png',b:process.cwd()+'/'+out+'/native-peek-zero-map.png'});
  results.pixelTests.push({source:'native desktop composition with owned test-window backdrop',changedPixels:desktopDifference,note:'A changed count alone is not proof of desktop refraction; focus/hover and compositor differences must be inspected. Zero means this SVG filter did not bend external window pixels.'});
  await zeroMap(false);await menu('view-approval');await capture(out+'/native-approval.png');
  await page.evaluate(()=>window.glass.setSettings({theme:'dark'}));await menu('view-peek');await backdrop(backgrounds.dark);await capture(out+'/native-dark-peek.png');
  }
  assert.deepEqual(results.errors,[]);
  await writeFile(out+'/acceptance.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
}finally{await f.app.close();}
