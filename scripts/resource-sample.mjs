import { fixture } from './native-fixture.mjs';
import { writeFile,mkdir } from 'node:fs/promises';
const phase=process.argv[2]??'baseline';
const seconds=Number(process.argv[3]??300);
if(!['baseline','after'].includes(phase)||!Number.isFinite(seconds)||seconds<10)throw new Error('Invalid sampling options');
const f=await fixture(); const errors=[];f.page.on('pageerror',e=>errors.push(e.message));
const out='reports/electron-redesign';await mkdir(out,{recursive:true});
try{
  await f.page.waitForTimeout(8500);
  await f.menu('view-capsule');
  await f.app.evaluate(({app})=>app.getAppMetrics());
  const samples=[];const began=Date.now();
  const gpu=await f.app.evaluate(async({app})=>({details:await app.getGPUInfo('complete'),features:app.getGPUFeatureStatus(),hardwareAcceleration:app.isHardwareAccelerationEnabled()}));
  while(Date.now()-began<seconds*1000){
    await f.page.waitForTimeout(5000);
    samples.push({elapsedMs:Date.now()-began,processes:await f.app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,cpu:p.cpu.percentCPUUsage,workingSetKB:p.memory.workingSetSize})))});
    if(phase==='after'&&seconds>=600&&samples.length>60&&samples.length<=100)await f.menu(samples.length%2?'view-peek':'view-capsule');
    if(samples.length%12===0)console.log(phase+': '+Math.round((Date.now()-began)/1000)+'s sampled');
  }
  const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
  const idle=phase==='after'&&seconds>=600?samples.slice(0,60):samples;
  const result={phase,durationMs:Date.now()-began,idleDurationMs:idle.at(-1).elapsedMs,intervalMs:5000,state:'First 5 minutes visible stationary capsule after Mock stream settles; optional next 5 minutes contain 20 peek/capsule cycles; normal pin, may be occluded by user apps',method:'Electron app.getAppMetrics process CPU since preceding sample, arithmetic mean of summed process percentages; working sets include shared pages, not private memory or GPU VRAM',gpu,averageSummedCPU:mean(idle.map(s=>s.processes.reduce((n,p)=>n+p.cpu,0))),averageSummedWorkingSetKB:mean(idle.map(s=>s.processes.reduce((n,p)=>n+p.workingSetKB,0))),errors,samples};
  await writeFile(out+'/'+phase+'-resources.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({phase,durationMs:result.durationMs,cpu:result.averageSummedCPU,workingSetKB:result.averageSummedWorkingSetKB,errors}));
}finally{await f.app.close();}
