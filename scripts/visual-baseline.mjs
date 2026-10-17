import { fixture, backgrounds } from './native-fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const out='reports/electron-redesign'; await mkdir(out+'/screenshots/baseline',{recursive:true});
const f=await fixture();
try {
  const {app,page,mainId,menu,backdrop,capture}=f;
  const metadata=await app.evaluate(async ({app,screen,BrowserWindow},id)=>{
    const w=BrowserWindow.fromId(id);return {versions:process.versions,gpu:await app.getGPUInfo('basic'),features:app.getGPUFeatureStatus(),displays:screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor})),background:w.getBackgroundColor(),hasShadow:w.hasShadow(),bounds:w.getBounds()};
  },mainId);
  metadata.window=await page.evaluate(()=>window.glass.getWindowState());
  await writeFile(out+'/baseline-environment.json',JSON.stringify(metadata,null,2));
  await page.evaluate(()=>window.glass.setSettings({theme:'dark',animation:'off',pin:'always'}));
  for (const mode of ['capsule','peek','expanded','approval']) {
    if(mode==='approval') await page.waitForTimeout(7500);
    await menu('view-'+mode);await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
    await backdrop();await capture(out+'/screenshots/baseline/busy-'+mode+'.png');
  }
  await menu('view-peek');await page.evaluate(()=>window.glass.setSettings({theme:'light',pin:'always'}));
  const minimal='.glass{background:rgba(210,232,252,.045)!important}.peek-main,.task-capsule:before,.task-expanded>.task-heading,.todo,.approval-card,.command-preview{background:transparent!important}.glass-optics{opacity:0!important}';
  for(const variant of ['A','B','C','D']) {
    const style=variant==='A'?null:await page.addStyleTag({content:minimal+(variant==='D'?'.glass-optics{opacity:1!important}.glass{background:linear-gradient(125deg,#ffffff1c,transparent 50%,#d7efff12)!important}':'')});
    await page.evaluate(material=>window.glass.setSettings({material,pin:'always'}),variant==='A'||variant==='C'?'system':'transparent');
    for(const [name,color] of Object.entries(backgrounds)){await backdrop(color);await capture(out+'/screenshots/baseline/'+variant+'-'+name+'.png');}
    await style?.evaluate(e=>e.remove());
  }
  console.log('E0 four native forms and E1 12 same-condition substrate captures saved');
}finally{await f.app.close();}
