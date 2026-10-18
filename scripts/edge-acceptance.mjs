import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture } from './native-fixture.mjs';
import { expect } from '@playwright/test';
import {execFileSync} from 'node:child_process';
const label=process.argv[2]??'sample';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid label');
const output=resolve('reports/edge-polish');await mkdir(output,{recursive:true});
const scale=process.argv.find(arg=>arg.startsWith('--scale='))?.split('=')[1];
if(scale && !['1','1.25','1.5','2'].includes(scale))throw new Error('Invalid scale');
const f=await fixture({},scale?['--force-device-scale-factor='+scale]:[]),report={label,results:[],errors:[],native:[]};
try {
  const {page,app,mainId,menu}=f;
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.evaluate(()=>window.glass.setSettings({theme:'dark',animation:'off',material:'transparent'}));
  await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(300,200),mainId);
  await f.backdrop('rgb(100,119,145)');
  for(const mode of ['capsule','expanded']) {
    await menu('view-'+mode);
    // Keep forced-scale fixtures above Windows' physical minimum height and
    // on whole physical pixels. The unforced run covers the actual 44-DIP UI.
    if(scale && mode==='capsule') {
      await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setSize(288,64),mainId);
      await expect.poll(()=>page.evaluate(()=>innerHeight)).toBe(64);
    }
    const style=await page.locator('main').evaluate(root=>{
      const line=root.querySelector('.glass-rim-line'),box=line?.getBBox(),css=line&&getComputedStyle(line);
      return {dpr:devicePixelRatio,width:innerWidth,height:innerHeight,radius:getComputedStyle(root).borderTopLeftRadius,
        rim:box&&{x:box.x,y:box.y,width:box.width,height:box.height,rx:css.rx,stroke:css.strokeWidth}};
    });
    const owner=await app.evaluate(({BrowserWindow},id)=>({handle:BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE().toString(),pid:process.pid}),mainId);
    const nativeShape=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/read-owned-shape.ps1'),'-Handle',owner.handle,'-Owner',String(owner.pid)],{windowsHide:true,encoding:'utf8'}));
    await writeFile(resolve(output,label+'-'+mode+'-shape.json'),JSON.stringify(nativeShape,null,2));
    console.log('NATIVE REGION',JSON.stringify({mode,...nativeShape,rows:nativeShape.rows.length}));
    await page.screenshot({path:resolve(output,label+'-'+mode+'-renderer.png'),omitBackground:true});
    if(process.argv.includes('--native'))try {await f.capture(resolve(output,label+'-'+mode+'-native.png'));report.native.push(mode);} catch(error) {report.results.push({mode,nativeCapture:'rejected',reason:String(error).split('\n')[0]});}
    report.results.push({mode,...style});
    // Inspect the visible rim without text or sampled content interfering.
    const pixels=await app.evaluate(({nativeImage},{path,rows})=>{
      const bitmap=nativeImage.createFromPath(path),size=bitmap.getSize(),bytes=bitmap.toBitmap();
      const sample=[];for(let y=0;y<Math.min(36,size.height);y++){
        let first=-1;for(let x=0;x<Math.min(50,size.width);x++)if(bytes[(y*size.width+x)*4+3]>0){first=x;break;}
        sample.push(first);
      }
      let clipped=0,clippedVisible=0;const clippedSamples=[];
      for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
        const alpha=bytes[(y*size.width+x)*4+3];
        if(alpha && !rows.some(row=>x>=row.x && x<row.right && y>=row.y && y<row.bottom)){clipped++;if(alpha>=64)clippedVisible++;if(clippedSamples.length<12)clippedSamples.push({x,y,alpha});}
      }
      const cornerAlpha=[0,size.width-1,(size.height-1)*size.width,size.width*size.height-1].map(i=>bytes[i*4+3]);
      return {size,firstAlphaByRow:sample,clippedAlphaPixels:clipped,clippedVisiblePixels:clippedVisible,cornerAlpha,clippedSamples};
    },{path:resolve(output,label+'-'+mode+'-renderer.png'),rows:nativeShape.rows});
    report.results.push({mode,rendererCorner:pixels});
    if(pixels.clippedAlphaPixels)console.log('CLIPPED',JSON.stringify({style,pixels}));
    expect(pixels.clippedAlphaPixels).toBe(0);
    expect(pixels.cornerAlpha).toEqual([0,0,0,0]);
    expect(style.rim.width).toBeCloseTo(style.width-1.6,1);
    expect(style.rim.height).toBeCloseTo(style.height-1.6,1);
    expect(parseFloat(style.rim.rx)).toBeCloseTo(parseFloat(style.radius)-.8,1);
  }
  await menu('view-approval');
  await expect(page.locator('main')).toHaveAttribute('data-mode','approval');
  expect(report.errors).toEqual([]);
  await mkdir(output,{recursive:true});await writeFile(resolve(output,label+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {await f.app.close();}
