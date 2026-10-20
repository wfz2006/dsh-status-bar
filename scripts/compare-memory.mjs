import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const dir=resolve('reports/memory-upgrade');
const read=async name=>JSON.parse(await readFile(resolve(dir,name+'.json'),'utf8'));
const before=await Promise.all(['controlled-before-1','controlled-before-2'].map(read));
const after=await Promise.all(['after-1','after-2'].map(read));
const median=values=>{const sorted=values.toSorted((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;};
const summarize=samples=>({
  privateWorkingSetMiB:median(samples.map(s=>s.totalPrivateWorkingSet))/1048576,
  privateCommittedMiB:median(samples.map(s=>s.totalPrivateBytes))/1048576,
  nodeExternalMiB:median(samples.map(s=>s.node.external))/1048576,
  byProcess:Object.fromEntries(['Browser','Tab','GPU','Utility','Capture helper'].map(type=>[type,median(samples.map(s=>s.processes.filter(p=>p.type===type).reduce((sum,p)=>sum+p.privateWorkingSet,0)))/1048576])),
  frameCountsByRound:samples.map(s=>s.paints),
});
const comparison={scope:after[0].note,scenarios:[],visual:null};
for(const scenario of before[0].scenarios){
  const collect=rounds=>rounds.flatMap(r=>r.scenarios.find(s=>s.name===scenario.name).samples);
  const a=summarize(collect(before)),b=summarize(collect(after));
  comparison.scenarios.push({name:scenario.name,before:a,after:b,savedMiB:a.privateWorkingSetMiB-b.privateWorkingSetMiB,savedPercent:(1-b.privateWorkingSetMiB/a.privateWorkingSetMiB)*100});
}
const oldVisual=await read('visual-before'),newVisual=await read('visual-after');
assert.equal(oldVisual.surfaces.length,8);assert.deepEqual(newVisual.surfaces,oldVisual.surfaces,'All 8 maps, RGB scales and controlled screenshots must match byte for byte');
comparison.visual={surfaces:8,exactMaps:true,exactScales:true,exactScreenshotHashes:true};
await writeFile(resolve(dir,'comparison.json'),JSON.stringify(comparison,null,2));
console.log(comparison.scenarios.map(s=>({name:s.name,beforeMiB:s.before.privateWorkingSetMiB.toFixed(1),afterMiB:s.after.privateWorkingSetMiB.toFixed(1),savedPercent:s.savedPercent.toFixed(1)})));
