import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const label = process.argv[2] ?? 'sample';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid audit label');
const output = resolve('reports/performance-upgrade');
await mkdir(output,{recursive:true});
const f = await fixture();
const report = {label,scenarios:[],errors:[],note:'Local Electron CPU/DOM/copy counters; not presented-frame FPS. Same native capture cadence and full RGB optics.'};
try {
  const {app,page,menu,mainId} = f;
  await page.addInitScript(() => {
    const counters = window.__perf = {commits:0,pixelCopies:0,copiedBytes:0,paintedFrames:0,toneWrites:0};
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {supportsFiber:true,inject:()=>1,onCommitFiberRoot:()=>counters.commits++,onCommitFiberUnmount:()=>{},checkDCE:()=>{}};
    window.Uint8ClampedArray = new Proxy(Uint8ClampedArray,{construct(target,args) {
      if (args[0] instanceof Uint8Array) { counters.pixelCopies++; counters.copiedBytes+=args[0].byteLength; }
      return Reflect.construct(target,args);
    }});
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function(...args) {if(this.canvas.classList.contains('desktop-backdrop'))counters.paintedFrames++;return put.apply(this,args);};
    addEventListener('DOMContentLoaded',() => {
      new MutationObserver(records=>{counters.toneWrites+=records.length;}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-backdrop-tone']});
    });
  });
  await page.reload(); await page.locator('.task-capsule').waitFor();
  page.on('pageerror',error=>report.errors.push(error.message));
  const client=await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(metric=>[metric.name,metric.value]));
  async function sample(name,action) {
    const before=await metrics();
    const counts=await page.evaluate(()=>({...window.__perf}));
    const cpu=await app.evaluate(()=>process.cpuUsage());
    const start=performance.now();
    await action();
    const after=await metrics();
    const next=await page.evaluate(()=>({...window.__perf}));
    const endCPU=await app.evaluate(()=>process.cpuUsage());
    const delta={}; for(const key of ['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount'])delta[key]=after[key]-before[key];
    const counters={};for(const key of Object.keys(counts))counters[key]=next[key]-counts[key];
    report.scenarios.push({name,wallMs:performance.now()-start,mainCPUMs:(endCPU.user+endCPU.system-cpu.user-cpu.system)/1000,renderer:delta,counters,jsHeapBytes:after.JSHeapUsedSize});
  }
  await page.waitForTimeout(900);
  await sample('capsule-no-capture',()=>page.waitForTimeout(1500));
  await menu('view-expanded');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(300,200),mainId);
  await f.backdrop('linear-gradient(120deg,#d4e8ff,#fff3db)');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState()),{timeout:10000}).toMatchObject({enabled:true,running:true});
  await page.waitForTimeout(300);
  const map=await page.locator('#glass-defs feImage').first().getAttribute('href');
  report.optics={mapSHA256:createHash('sha256').update(map).digest('hex'),passes:await page.locator('#glass-defs feDisplacementMap').count(),scales:await page.locator('#glass-defs feDisplacementMap').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('scale')))};
  await sample('expanded-static-capture',()=>page.waitForTimeout(2000));
  await sample('native-drag',async()=>{
    for(let step=0;step<30;step++){
      await app.evaluate(({BrowserWindow},{id,step})=>BrowserWindow.fromId(id).setPosition(300+step*2,200+step%4),{id:mainId,step});
      await page.waitForTimeout(24);
    }
  });
  await sample('morph-six-transitions',async()=>{for(const mode of ['capsule','peek','expanded','capsule','peek','expanded'])await menu('view-'+mode);});
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:false});
  await page.waitForTimeout(100);
  await sample('hidden',()=>page.waitForTimeout(1000));
  await writeFile(resolve(output,label+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await f.app.close();}
