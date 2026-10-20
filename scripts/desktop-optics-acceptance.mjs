import { fixture } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const out='reports/desktop-optics';await mkdir(out,{recursive:true});
const f=await fixture();
try {
  const {page,app,mainId}=f;
  await page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'off',material:'transparent',pin:'always'}));
  await f.menu('view-peek');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
  await f.backdrop('repeating-linear-gradient(90deg,#eeeeee 0 8px,#181818 8px 10px,#eeeeee 10px 32px)');
  assert.equal((await page.evaluate(()=>window.glass.getOpticsState())).enabled,false);
  await assert.rejects(()=>page.evaluate(()=>window.glass.setOpticsEnabled('true')),'Non-boolean optics IPC rejected');
  await page.evaluate(()=>{window.__opticalFrames=0;window.__opticalUnsub=window.glass.subscribeOpticsFrame(()=>window.__opticalFrames++);return window.glass.setOpticsEnabled(true);});
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState()),{timeout:10000}).toMatchObject({enabled:true,running:true,error:null});
  await expect.poll(()=>page.locator('.desktop-backdrop').getAttribute('data-frame')).not.toBe(null);
  const sample=await page.locator('.desktop-backdrop').evaluate(c=>{
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let colored=0,min=255,max=0;
    for(let i=0;i<d.length;i+=4){min=Math.min(min,d[i]);max=Math.max(max,d[i]);if(Math.abs(d[i]-d[i+1])>8 || Math.abs(d[i]-d[i+2])>8)colored++;}
    return {width:c.width,height:c.height,min,max,colored,total:d.length/4};
  });
  assert.ok(sample.max-sample.min>180,'Capture must retain clear background lines');
  assert.ok(sample.colored/sample.total<0.001,'Captured pixels must be the owned neutral backdrop, without recursive UI/progress color');
  await writeFile(out+'/sample.json',JSON.stringify(sample,null,2));
  console.log('REAL BOUNDED INPUT',sample);
  // Compare processed vs zero displacement over actual native captured pixels.
  // CapturePage is used here for the rendered result; the input is NOT a DOM fixture.
  await page.waitForTimeout(300);
  const blankRegion=await page.evaluate(()=>{
    const progress=document.querySelector('.task-progress').getBoundingClientRect();
    const step=document.querySelector('.current-step').getBoundingClientRect();
    return {top:Math.ceil((progress.bottom+8)*devicePixelRatio),bottom:Math.floor((step.top-8)*devicePixelRatio)};
  });
  assert.ok(blankRegion.bottom-blankRegion.top>=20,'Optical measurement needs a blank gap between progress and text');
  await writeFile(out+'/blank-region.json',JSON.stringify(blankRegion));
  await page.screenshot({path:out+'/refracted.png'});
  await page.evaluate(()=>document.querySelectorAll('#glass-defs feDisplacementMap').forEach(n=>{n.dataset.originalScale=n.getAttribute('scale');n.setAttribute('scale','0');}));
  await page.waitForTimeout(100);
  await page.screenshot({path:out+'/zero.png'});
  await page.evaluate(()=>document.querySelectorAll('#glass-defs feDisplacementMap').forEach(n=>n.setAttribute('scale',n.dataset.originalScale)));
  const sampleStart=await page.evaluate(()=>window.__opticalFrames);const sampleTime=Date.now();
  // An unchanged desktop now skips identical payloads; require fresh geometry
  // throughout this capture-cadence probe rather than counting duplicates.
  for(let n=0;n<44;n++){
    await app.evaluate(({BrowserWindow},{id,n})=>BrowserWindow.fromId(id).setPosition(233+n%2,150),{id:mainId,n});
    await page.waitForTimeout(50);
  }
  const arrivalHz=(await page.evaluate(()=>window.__opticalFrames)-sampleStart)/((Date.now()-sampleTime)/1000);
  assert.ok(arrivalHz>8 && arrivalHz<=26,'Bounded frame arrival Hz: '+arrivalHz);
  // Move the real HWND while sampling; wait for a fresh frame at the new ROI.
  const oldFrame=await page.locator('.desktop-backdrop').getAttribute('data-frame');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(230,170),mainId);
  await expect.poll(()=>page.locator('.desktop-backdrop').getAttribute('data-frame')).not.toBe(oldFrame);
  const owner=await app.evaluate(()=>process.pid);
  const helpers=()=>execFileSync('powershell',['-NoProfile','-Command',`@(Get-CimInstance Win32_Process -Filter "Name='RegionCapture.exe' AND ParentProcessId=${owner}").Count`],{windowsHide:true,encoding:'utf8'}).trim();
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({enabled:true,running:false});
  await expect.poll(helpers).toBe('0');
  await app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.fromId(id);w.show();w.setAlwaysOnTop(false);w.setAlwaysOnTop(true);w.focus();},mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  for(const mode of ['capsule','peek','expanded','approval']) {
    await f.menu('view-'+mode);
    await expect.poll(()=>page.locator('.desktop-backdrop').getAttribute('data-frame')).not.toBe(null);
    await page.waitForTimeout(250);
    await page.screenshot({path:out+'/'+mode+'.png'});
  }
  await page.evaluate(()=>window.glass.setSettings({material:'solid'}));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({enabled:false,running:false});
  await expect.poll(helpers).toBe('0');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  // Simulate only this app's helper crashing; Main must survive and stop safely.
  execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='RegionCapture.exe' AND ParentProcessId=${owner}" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],{windowsHide:true});
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({enabled:false,running:false,error:'屏幕取样不可用，已停止'});
  await expect(page.locator('.desktop-backdrop')).toHaveCSS('visibility','hidden');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true,error:null});
  await page.evaluate(()=>window.glass.setOpticsEnabled(false));
  await expect(page.locator('.desktop-backdrop')).toHaveCSS('visibility','hidden');
  const stopped=await page.evaluate(()=>window.__opticalFrames);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__opticalFrames),stopped,'No frames after disabling');
  assert.equal(await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isContentProtected(),mainId),false);
  await writeFile(out+'/acceptance.json',JSON.stringify({input:sample,stopVerified:true,arrivalHz,hideResume:true,solidStops:true,helperCrashFailClosed:true,fourModes:true,renderedOptics:'See pixel-analysis.json'},null,2));
  console.log('Bounded capture, hide/resume, 4 modes, solid stop, helper crash fail-closed: PASS; input arrival Hz='+arrivalHz.toFixed(1));
} finally {await f.app.close();}
