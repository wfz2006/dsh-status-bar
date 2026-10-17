import {fixture} from './native-fixture.mjs';
const f=await fixture();
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off'}));
 for(const method of ['ipc','position']) {
  await f.menu('view-peek');
  const samples=[];
  for(let i=0;i<12;i++) {
   if(method==='ipc')await f.page.evaluate(i=>window.glass.moveWindow({x:250+i,y:160}),i);
   else if(method==='position')await f.app.evaluate(({BrowserWindow},{id,i})=>BrowserWindow.fromId(id).setPosition(250+i,160),{id:f.mainId,i});
   samples.push(await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId));
  }
  console.log(method,samples);
 }
}finally{await f.app.close();}
