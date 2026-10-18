import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const f=await fixture(),output=resolve('reports/performance-upgrade');
const checks=[];
try {
  const {page,app,mainId,menu}=f;
  await menu('view-expanded');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(300,200),mainId);
  await f.backdrop('rgb(250,250,250)');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState()),{timeout:10000}).toMatchObject({running:true});
  await page.evaluate(()=>{
    window.__pixelChecks=[];
    window.__offPixels=window.glass.subscribeOpticsFrame(frame=>{
      if(window.__pixelChecks.length>=3)return;
      const canvas=document.querySelector('.desktop-backdrop');
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let equal=pixels.length===frame.pixels.length;
      for(let i=0;i<pixels.length;i+=Math.max(4,Math.floor(pixels.length/128/4)*4)){
        for(let channel=0;channel<4;channel++)if(pixels[i+channel]!==frame.pixels[i+channel])equal=false;
      }
      window.__pixelChecks.push(equal);
    });
  });
  await expect.poll(()=>page.evaluate(()=>window.__pixelChecks)).toEqual([true,true,true]);
  await page.evaluate(()=>window.__offPixels());
  checks.push('received RGBA bytes match the painted canvas, including alpha');

  // Native display affinity can hide other windows of this test process too.
  // Use explicit renderer-only frame fixtures for deterministic tone changes;
  // the native sampling/painting comparison above still uses real helper frames.
  await page.evaluate(()=>window.glass.setOpticsEnabled(false));
  async function toneFrame(value) {
    await app.evaluate(({BrowserWindow,screen},{id,value})=>{
      const win=BrowserWindow.fromId(id),rect=screen.dipToScreenRect(win,win.getBounds());
      const pixels=new Uint8Array(rect.width*rect.height*4);pixels.fill(value);
      for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
      win.webContents.send('glass:optics-state',{enabled:true,running:true,error:null});
      win.webContents.send('glass:optics-frame',{left:rect.x,top:rect.y,width:rect.width,height:rect.height,windowLeft:rect.x,windowTop:rect.y,windowWidth:rect.width,windowHeight:rect.height,pixels});
    },{id:mainId,value});
  }
  await toneFrame(250);
  await expect(page.locator('main')).toHaveAttribute('data-backdrop-tone','light');

  await page.evaluate(()=>window.glass.setSettings({tintColor:'#e03050',tintOpacity:26,brightness:120}));
  await expect(page.locator('.glass-body')).toHaveCSS('filter','brightness(1.2)');
  await expect(page.locator('.glass-tint')).toHaveCSS('background-color','rgba(224, 48, 80, 0.26)');
  await page.evaluate(()=>window.glass.setSettings({tintColor:'#000000',tintOpacity:10,brightness:100}));
  await expect(page.locator('.glass-body')).toHaveCSS('filter','none');
  await toneFrame(4);
  await expect(page.locator('main')).toHaveAttribute('data-backdrop-tone','dark');
  checks.push('memoized material still applies tint/brightness; controlled renderer frames switch automatic ink tone');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});

  for(const [width,height,mode] of [[340,190,'peek'],[300,70,'capsule'],[400,360,'expanded']]) {
    await page.evaluate(({width,height})=>window.glass.resizeWindow({x:300,y:200,width,height}),{width,height});
    await expect(page.locator('main')).toHaveAttribute('data-mode',mode);
    await expect.poll(()=>page.locator('.desktop-backdrop').getAttribute('data-coverage')).toBe('full');
  }
  const positions=[];
  for(const x of [320,340,360]) {
    await app.evaluate(({BrowserWindow},{id,x})=>BrowserWindow.fromId(id).setPosition(x,200),{id:mainId,x});
    const physical=await f.rect();
    await expect.poll(()=>page.locator('.desktop-backdrop').getAttribute('data-window-left')).toBe(String(physical.x));
    positions.push(physical.x);
  }
  assert.equal(new Set(positions).size,3);
  checks.push('all manual layout breakpoints and current-world-position capture still update');

  const morph=await page.evaluate(async()=>{
    const samples=[];
    void window.glass.windowAction('collapse');
    await new Promise(resolve=>setTimeout(resolve,500));
    void window.glass.windowAction('approval');
    const start=performance.now();
    while(performance.now()-start<650){
      await new Promise(requestAnimationFrame);
      const root=document.querySelector('main'),surface=document.querySelector('.lg-material-surface');
      const filter=document.getElementById(surface?.__lgId),map=filter?.querySelector('feImage');
      samples.push({expanding:root.dataset.morph==='expanding',passes:filter?.querySelectorAll('feDisplacementMap').length??0,mapWidth:Number(map?.getAttribute('width')),mapHeight:Number(map?.getAttribute('height')),width:innerWidth,height:innerHeight});
    }
    return samples;
  });
  assert.ok(morph.some(sample=>sample.expanding));
  assert.ok(morph.filter(sample=>sample.expanding).every(sample=>sample.passes===3));
  assert.ok(morph.slice(-5).every(sample=>sample.passes===3&&Math.abs(sample.mapWidth-sample.width)<=2&&Math.abs(sample.mapHeight-sample.height)<=2));
  checks.push('native morph retains three RGB passes and ends with the correctly sized optical map');

  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:false});
  await expect(page.locator('.desktop-backdrop')).toHaveCSS('visibility','hidden');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).show(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  await page.evaluate(()=>window.glass.setSettings({material:'solid'}));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({enabled:false,running:false});
  await page.evaluate(()=>window.glass.setSettings({material:'transparent'}));
  await expect(page.locator('#glass-defs feDisplacementMap')).toHaveCount(3);
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  await page.evaluate(()=>window.glass.setOpticsEnabled(false));
  await expect(page.locator('.desktop-backdrop')).toHaveCSS('visibility','hidden');
  checks.push('hide/resume, solid/transparent lifecycle and explicit stop remain intact');
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'acceptance.json'),JSON.stringify({result:'PASS',checks,morphSamples:morph.length},null,2));
  console.log('Performance functional acceptance: PASS');
} finally {await f.app.close();}
