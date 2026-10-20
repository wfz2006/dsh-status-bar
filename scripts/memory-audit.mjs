import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';
import { memoryBackdrop } from './memory-backdrop.mjs';

const label=process.argv[2]??'sample';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid label');
const f=await fixture({},[],process.env.GLASS_AUDIT_APP),output=resolve('reports/memory-upgrade');
const report={label,scenarios:[],errors:[],units:'bytes',note:'Isolated production Electron build, same 150% display, no debugger GC or working-set trimming. Includes this app, its bounded 800x600-DIP controlled background renderer and RegionCapture children; excludes DSH Host. Private working set is physical private RAM, not summed shared working sets or GPU VRAM. Native sampled pixels stay in memory.'};
try {
  const {app,page,menu,mainId}=f;
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.evaluate(()=>{
    window.__memoryPaints=0;
    const put=CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData=function(...args){if(this.canvas.classList.contains('desktop-backdrop'))window.__memoryPaints++;return put.apply(this,args);};
  });
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
  async function sample(name) {
    await page.waitForTimeout(5000);
    const samples=[];
    for(let n=0;n<4;n++) {
      const electron=await app.evaluate(({app})=>({pid:process.pid,metrics:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,name:p.name,memory:p.memory})),node:process.memoryUsage()}));
      const os=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-File',resolve('scripts/memory-processes.ps1'),'-MainProcessId',String(electron.pid),'-ElectronProcessIds',electron.metrics.map(p=>p.pid).join(',')],{windowsHide:true,encoding:'utf8'}));
      const processes=(Array.isArray(os)?os:[os]).map(p=>({...p,type:electron.metrics.find(e=>e.pid===p.pid)?.type??'Capture helper'}));
      const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
      const renderer=await page.evaluate(()=>({paints:window.__memoryPaints,width:innerWidth,height:innerHeight,canvas:[document.querySelector('.desktop-backdrop').width,document.querySelector('.desktop-backdrop').height],filters:document.querySelectorAll('#glass-defs feDisplacementMap').length}));
      samples.push({processes,totalPrivateWorkingSet:processes.reduce((s,p)=>s+p.privateWorkingSet,0),totalPrivateBytes:processes.reduce((s,p)=>s+p.privateBytes,0),node:electron.node,jsHeapUsed:metrics.JSHeapUsedSize,...renderer});
      await page.waitForTimeout(1000);
    }
    report.scenarios.push({name,samples});
    console.log(name,JSON.stringify(samples.map(s=>({privateWSMiB:Math.round(s.totalPrivateWorkingSet/1048576),privateMiB:Math.round(s.totalPrivateBytes/1048576),byProcess:s.processes.map(p=>[p.type,Math.round(p.privateWorkingSet/1048576)]),nodeExternalMiB:Math.round(s.node.external/1048576),paints:s.paints}))));
  }
  await page.evaluate(()=>window.glass.setSettings({material:'frosted',animation:'full'}));
  await menu('view-capsule');
  const background=await memoryBackdrop(f);
  await sample('capsule-no-capture');
  await page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState()),{timeout:10000}).toMatchObject({running:true});
  await sample('capsule-native');
  await menu('view-expanded');
  await sample('expanded-native');
  // A changed real background still exercises capture, IPC and GPU upload.
  await background.animate();
  await sample('expanded-changing-background');
  await background.color(170,170,170);
  for(let n=0;n<6;n++)for(const mode of ['capsule','peek','expanded'])await menu('view-'+mode);
  await sample('expanded-after-18-transitions');
  await menu('view-capsule');
  await sample('recollapsed-native');
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),mainId);
  await expect.poll(()=>page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:false});
  await sample('hidden');
  assert.deepEqual(report.errors,[]);
  await mkdir(output,{recursive:true});await writeFile(resolve(output,label+'.json'),JSON.stringify(report,null,2));
} finally {await f.app.close();}
