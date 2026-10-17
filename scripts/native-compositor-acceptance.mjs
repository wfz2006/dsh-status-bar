import { fixture } from './native-fixture.mjs';
import { spawn,execFileSync } from 'node:child_process';
import { mkdtemp,mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
const out=resolve('reports/native-compositor');await mkdir(out,{recursive:true});
const f=await fixture();const results=[];
const exe=resolve('experiments/tauri-glass/target/x86_64-pc-windows-gnu/release/dsh-glass-native-compare.exe');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  await f.backdrop('repeating-linear-gradient(90deg,#eeeeee 0 8px,#181818 8px 10px,#eeeeee 10px 32px)');
  await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).hide(),f.mainId);
  const materials=process.argv.slice(2).length ? process.argv.slice(2) : ['clear','acrylic','native-zero','native'];
  for(const material of materials) {
    const cwd=await mkdtemp(join(tmpdir(),'glass-native-'));
    const child=spawn(exe,[],{cwd,env:{...process.env,GLASS_COMPARE_MATERIAL:material,GLASS_COMPARE_MODE:'peek'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';child.stdout.on('data',s=>log+=s);child.stderr.on('data',s=>log+=s);
    let info;
    try {
      for(let i=0;i<100;i++) {
        try {info=JSON.parse(await readFile(join(cwd,'window.json'),'utf8'));break;}catch{}
        if(child.exitCode!==null)break;
        await delay(100);
      }
      if(!info) {
        let error='';try{error=await readFile(join(cwd,'native-error.txt'),'utf8');}catch{}
        results.push({material,status:'FAILED',error,log,exitCode:child.exitCode});
        continue;
      }
      await delay(1800);
      const path=join(out,material+'.png');
      // Only captures the owned probe's bounds after checking topmost HWND.
      execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/capture-owned-window.ps1'),'-Path',path,'-Handle',String(info.handle)],{windowsHide:true,stdio:'pipe'});
      results.push({...info,status:'CAPTURED',image:path,log});
      await copyFile(join(cwd,'window.json'),join(out,material+'.json'));
    } catch(error) {results.push({material,status:'FAILED',error:String(error),log});}
    finally {if(child.exitCode===null)child.kill();await delay(300);}
  }
  await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
  await f.page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'off',material:'transparent'}));
  await f.menu('view-peek');
  await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),f.mainId);
  await f.app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.fromId(id);w.setAlwaysOnTop(false);w.setAlwaysOnTop(true);w.show();w.focus();w.moveTop();},f.mainId);
  await f.page.waitForTimeout(300);
  await f.capture(join(out,'electron-clear.png'));
  const oldCss=['apps/desktop/src/renderer/style.css','apps/desktop/src/renderer/glass-material.css']
    .map(path=>execFileSync('git',['show','977bad2:'+path],{encoding:'utf8'})).join('\n');
  await f.page.addStyleTag({content:oldCss});
  await f.capture(join(out,'electron-rejected.png'));
  await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results,null,2));
}finally {await f.app.close();}
