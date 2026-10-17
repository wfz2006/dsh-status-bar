import { fixture, backgrounds } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const out='reports/electron-redesign';await mkdir(out+'/recordings',{recursive:true});
const f=await fixture();const results={screenshots:[],cycles:[],errors:[],recordings:[],scope:'Native controlled desktop region; rAF intervals are scheduling evidence, not presented FPS'};
f.page.on('pageerror',e=>results.errors.push(e.message));
async function record(name,exercise){
  const area=await f.app.evaluate(({BrowserWindow,screen},id)=>{const w=BrowserWindow.fromId(id);return screen.dipToScreenRect(w,{x:200,y:150,width:400,height:340});},f.mainId);
  const binary=process.env.GLASS_FFMPEG??resolve('.tools/media/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
  const child=spawn(binary,['-y','-f','gdigrab','-framerate','30','-draw_mouse','0','-offset_x',String(area.x),'-offset_y',String(area.y),'-video_size',area.width+'x'+area.height,'-i','desktop','-an','-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p',out+'/recordings/'+name+'.mp4'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
  let log='';child.stderr.on('data',chunk=>{log+=chunk.toString();});
  const exit=once(child,'exit');
  try{await f.page.waitForTimeout(800);await exercise();}finally{child.stdin.write('q\n');}
  const [code]=await exit;assert.equal(code,0,log.slice(-1000));
  results.recordings.push({name,area,encoder:'imageio-ffmpeg 0.6.0 bundled FFmpeg 7.1, gdigrab, 30 Hz capture; no audio',logTail:log.slice(-1600)});
}
try{
  const {page,app,mainId,menu,backdrop,capture}=f;
  await page.evaluate(()=>window.glass.setSettings({pin:'always',animation:'off',autoApproval:false,theme:'light'}));
  await expect.poll(async()=>(await page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(1);
  results.gpu=await app.evaluate(async({app})=>({details:await app.getGPUInfo('complete'),features:app.getGPUFeatureStatus(),hardwareAcceleration:app.isHardwareAccelerationEnabled()}));
  for(const [name,color] of Object.entries(backgrounds)){
    for(const mode of ['capsule','peek','expanded','approval']){
      await page.evaluate(theme=>window.glass.setSettings({theme}),name==='dark'?'dark':'light');
      await menu('view-'+mode);
      await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(200,150),mainId);
      await backdrop(color);await capture(out+'/screenshots/'+name+'-'+mode+'.png');
      results.screenshots.push({name,mode,state:await page.evaluate(()=>window.glass.getWindowState()),bounds:await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),mainId)});
    }
  }
  // Verify there are no filled task child cards in either theme.
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>window.glass.setSettings({theme}),theme);await menu('view-expanded');
    assert.equal(await page.locator('.task-heading,.todo').evaluateAll(elements=>elements.some(e=>!['rgba(0, 0, 0, 0)','transparent'].includes(getComputedStyle(e).backgroundColor))),false);
  }
  await page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'full'}));await menu('view-capsule');await backdrop(backgrounds.busy);
  await page.evaluate(()=>{window.__auditFrames=[];window.__auditRecording=true;function frame(t){window.__auditFrames.push(t);if(window.__auditRecording)requestAnimationFrame(frame);}requestAnimationFrame(frame);});
  await record('morph',async()=>{
    for(let i=0;i<20;i++){
      const start=performance.now();await menu('view-peek');const opened=performance.now();await menu('view-capsule');
      results.cycles.push({cycle:i+1,expandMs:opened-start,collapseMs:performance.now()-opened});
    }
  });
  const frames=await page.evaluate(()=>{window.__auditRecording=false;return window.__auditFrames;});
  results.rafIntervals=frames.slice(1).map((v,i)=>v-frames[i]);
  await menu('mock-long-approval');await menu('view-approval');
  await expect.poll(async()=>(await page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:12000}).toBe(1);
  await page.getByText('查看完整命令与请求',{exact:true}).click();
  await record('approval-scroll',async()=>{
    const footer=await page.locator('.decision-buttons').boundingBox();
    for(let i=0;i<6;i++){await page.locator('.approval-body').evaluate((e,i)=>{e.scrollTop=i%2?0:e.scrollHeight;},i);await page.waitForTimeout(450);assert.deepEqual(await page.locator('.decision-buttons').boundingBox(),footer);}
    await expect(page.locator('.command-full')).toContainText('# END OF MOCK PREVIEW');
  });
  await capture(out+'/screenshots/long-command-approval.png');
  assert.deepEqual(results.errors,[]);
  await writeFile(out+'/native-results.json',JSON.stringify(results,null,2));
  console.log('12 native screenshots; single surface in both themes; 20 recorded morph cycles; long command/footer recording: PASS');
}finally{await f.app.close();}
