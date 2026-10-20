import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { memoryBackdrop } from './memory-backdrop.mjs';

const f=await fixture();
const report={checks:[],changes:[]};
try {
  const {app,page,mainId,menu}=f;
  await page.evaluate(()=>window.glass.setSettings({material:'transparent',theme:'auto',animation:'full',tintColor:'#000000',tintOpacity:12,brightness:125}));
  await menu('view-expanded');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
  const background=await memoryBackdrop(f);
  await page.evaluate(()=>{
    window.__memoryFrames=[];
    window.__offMemory=window.glass.subscribeOpticsFrame(f=>{
      const i=((f.windowTop-f.top+10)*f.width+f.windowLeft-f.left+10)*4;
      window.__memoryFrames.push({rgb:Array.from(f.pixels.subarray(i,i+3)),x:f.windowLeft,y:f.windowTop,time:performance.now()});
    });
  });
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  await expect.poll(()=>page.evaluate(()=>window.__memoryFrames.at(-1)?.rgb)).toEqual([170,170,170]);
  await page.waitForTimeout(350);
  const count=await page.evaluate(()=>window.__memoryFrames.length);
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>window.__memoryFrames.length),count,'No duplicate full frame for unchanged real desktop pixels');
  report.checks.push('real static background keeps the previous image without duplicate IPC or canvas uploads');
  const late=await page.evaluate(()=>new Promise(resolve=>{
    const off=window.glass.subscribeOpticsFrame(f=>{off();resolve([f.windowWidth,f.windowHeight]);});
  }));
  assert.ok(late[0]>0 && late[1]>0,'A late subscriber receives a fresh static image');
  report.checks.push('late subscribers receive a forced fresh frame even on a static desktop');
  for(const rgb of [[220,140,80],[35,70,130],[170,170,170]]){
    const start=performance.now();await background.color(...rgb);
    await expect.poll(()=>page.evaluate(()=>window.__memoryFrames.at(-1)?.rgb),{intervals:[20],timeout:1500}).toEqual(rgb);
    report.changes.push({rgb,paintCommandToObservedMs:performance.now()-start});
  }
  report.checks.push('each real native background colour change reaches the renderer; no refresh-rate/quality reduction');
  const fastStart=await page.evaluate(()=>window.__memoryFrames.length);
  await background.animateFast();
  await page.waitForTimeout(1200);
  const fastFrames=await page.evaluate(n=>window.__memoryFrames.slice(n),fastStart);
  assert.ok(fastFrames.length>=10 && new Set(fastFrames.map(f=>f.rgb.join(','))).size>=10,'Fast changing native pixels still reach the renderer at the existing capture cadence');
  report.fastChangingFramesIn1200ms=fastFrames.length;
  await background.color(170,170,170);
  await expect.poll(()=>page.evaluate(()=>window.__memoryFrames.at(-1)?.rgb)).toEqual([170,170,170]);
  for(const x of [210,220,230]){
    await app.evaluate(({BrowserWindow},{id,x})=>BrowserWindow.fromId(id).setPosition(x,150),{id:mainId,x});
    const rect=await f.rect();
    await expect.poll(()=>page.evaluate(()=>window.__memoryFrames.at(-1)?.x)).toBe(rect.x);
  }
  report.checks.push('dragging over an identical-colour background still sends fresh world geometry');
  for(let n=0;n<5;n++)for(const x of [400,200]){
    await app.evaluate(({BrowserWindow},{id,x})=>BrowserWindow.fromId(id).setPosition(x,150),{id:mainId,x});
    await page.waitForTimeout(16);
  }
  const returned=await f.rect();
  await expect.poll(()=>page.evaluate(()=>window.__memoryFrames.at(-1)?.x)).toBe(returned.x);
  await expect(page.locator('.desktop-backdrop')).toHaveAttribute('data-coverage','full');
  report.checks.push('rapid leave-and-return movement recovers current full coverage rather than deduplicating a rejected frame');
  for(const [tintColor,tone] of [['#ffffff','light'],['#000000','dark']]){
    await page.evaluate(tintColor=>window.glass.setSettings({tintColor,tintOpacity:100,brightness:100}),tintColor);
    await expect(page.locator('main')).toHaveAttribute('data-backdrop-tone',tone);
  }
  report.checks.push('tint changes on a static background still refresh automatic text tone');
  await page.evaluate(()=>window.glass.setSettings({tintColor:'#000000',tintOpacity:12,brightness:125}));
  const filter=await page.locator('.lg-material-surface').evaluate(el=>el.__lgId);
  for(const mode of ['capsule','peek','expanded','capsule','approval','expanded']){
    await menu('view-'+mode);
    assert.equal(await page.locator('.lg-material-surface').evaluate(el=>el.__lgId),filter,'Stable optical filter graph during morphs');
    await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
    await expect(page.locator('.desktop-backdrop')).toHaveAttribute('data-coverage','full');
  }
  report.checks.push('six native morphs reuse one optical graph and preserve three RGB passes/current coverage');
  await page.reload();await page.locator('main').waitFor();
  await expect(page.locator('.desktop-backdrop')).toHaveAttribute('data-coverage','full');
  report.checks.push('renderer reload recovers the same static backdrop through a forced fresh frame');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:false});
  assert.deepEqual(await page.locator('.desktop-backdrop').evaluate(c=>[c.width,c.height]),[0,0]);
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).show(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  await expect(page.locator('.desktop-backdrop')).toHaveAttribute('data-coverage','full');
  await page.evaluate(()=>window.glass.setSettings({material:'solid'}));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({enabled:false,running:false});
  assert.deepEqual(await page.locator('.desktop-backdrop').evaluate(c=>[c.width,c.height]),[0,0]);
  report.checks.push('hide/show and solid material release/recreate the native and canvas resources');
  await mkdir(resolve('reports/memory-upgrade'),{recursive:true});
  await writeFile(resolve('reports/memory-upgrade/native-acceptance.json'),JSON.stringify({result:'PASS',...report},null,2));
  console.log('Memory native acceptance: PASS',JSON.stringify(report));
}finally{await f.app.close();}
