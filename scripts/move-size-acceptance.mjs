import {fixture} from './native-fixture.mjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const f=await fixture();const results=[];
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off'}));
 const identity=await f.app.evaluate(({BrowserWindow},id)=>({handle:BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE().toString(),pid:process.pid}),f.mainId);
 const physical=()=>execFileSync(resolve('apps/desktop/native/RegionCapture.exe'),['--geometry',identity.handle,String(identity.pid)],{encoding:'utf8',windowsHide:true}).trim().split(' ').map(Number);
 for(const mode of ['capsule','peek','expanded','approval']) {
  await f.menu('view-'+mode);
  const before=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
  const nativeBefore=physical();const viewport=await f.page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const samples=[];
  for(let i=0;i<80;i++) {
   await f.page.evaluate(i=>window.glass.moveWindow({x:220+i%40,y:140+i%30}),i);
   const b=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
   assert.deepEqual(await f.page.evaluate(()=>({width:innerWidth,height:innerHeight})),viewport,mode+' viewport must remain fixed');samples.push(b);
  }
  const nativeAfter=physical();assert.deepEqual(nativeAfter.slice(2),nativeBefore.slice(2),mode+' native size must remain fixed');
  results.push({mode,before,last:samples.at(-1),nativeBefore,nativeAfter,viewport,moves:samples.length});
 }
 await mkdir('reports/move-size',{recursive:true});await writeFile('reports/move-size/acceptance.json',JSON.stringify(results,null,2));
 console.log(results);
} finally {await f.app.close();}
