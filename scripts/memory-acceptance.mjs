import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { fixture } from './native-fixture.mjs';

const label=process.argv[2]??'after';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid label');
const f=await fixture({},[],process.env.GLASS_AUDIT_APP),output=resolve('reports/memory-upgrade');
const report={label,checks:[],surfaces:[]};
const hash=value=>createHash('sha256').update(value).digest('hex');
try {
  const {app,page,mainId}=f;
  await page.evaluate(()=>window.glass.setSettings({theme:'dark',animation:'off',tintColor:'#000000',tintOpacity:12,brightness:125}));
  await page.addStyleTag({content:'.glass>:not(.glass-material){visibility:hidden!important}'});
  for(const material of ['transparent','frosted'])for(const [width,height,mode] of [[288,50,'capsule'],[340,190,'peek'],[400,360,'expanded'],[400,300,'approval']]){
    await f.menu('view-'+mode);
    await page.evaluate(({material,width,height})=>window.glass.setSettings({material}).then(()=>window.glass.resizeWindow({x:200,y:150,width,height})),{material,width,height});
    await expect(page.locator('main')).toHaveAttribute('data-mode',mode);
    await page.waitForTimeout(250);
    await app.evaluate(({BrowserWindow,screen},id)=>{
      const win=BrowserWindow.fromId(id),r=screen.dipToScreenRect(win,win.getBounds());
      const width=r.width+96,height=r.height+96;
      const scratch=Buffer.alloc(width*height*4);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const i=(y*width+x)*4;
        scratch[i]=(x%32<16)?238:26;scratch[i+1]=(y%24<12)?180:65;scratch[i+2]=(x+y)%256;scratch[i+3]=255;
      }
      win.webContents.send('glass:optics-state',{enabled:true,running:true,error:null});
      win.webContents.send('glass:optics-frame',{left:r.x-48,top:r.y-48,width,height,windowLeft:r.x,windowTop:r.y,windowWidth:r.width,windowHeight:r.height,pixels:new Uint8Array(scratch.buffer,scratch.byteOffset,scratch.byteLength)});
      scratch.fill(0);
    },mainId);
    await expect(page.locator('.desktop-backdrop')).toHaveAttribute('data-coverage','full');
    const canvas=await page.locator('.desktop-backdrop').evaluate(c=>{
      const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
        const i=(y*c.width+x)*4;
        if(pixels[i]!==((x%32<16)?238:26)||pixels[i+1]!==((y%24<12)?180:65)||pixels[i+2]!==((x+y)%256)||pixels[i+3]!==255)return false;
      }return true;
    });
    assert.equal(canvas,true,'IPC snapshot survives immediate source-buffer scrubbing, all RGBA bytes unchanged');
    const map=await page.locator('#glass-defs feImage').first().getAttribute('href');
    const scales=await page.locator('#glass-defs feDisplacementMap').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('scale')));
    assert.equal(scales.length,3);
    await page.waitForTimeout(100);
    report.surfaces.push({material,width,height,mapSHA256:hash(map),scales,imageSHA256:hash(await page.screenshot())});
    await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).webContents.send('glass:optics-state',{enabled:false,running:false,error:null}),mainId);
    await expect(page.locator('.desktop-backdrop')).toHaveCSS('visibility','hidden');
    if(label!=='before')assert.deepEqual(await page.locator('.desktop-backdrop').evaluate(c=>[c.width,c.height]),[0,0]);
  }
  report.checks.push('8 clear/frosted × capsule/peek/expanded/approval surfaces retain exact RGBA bytes, 3 RGB passes, same maps and screenshots for before/after comparison');
  report.checks.push('source scratch bytes are zeroed immediately after IPC; receiver still paints the serialized snapshot');
  if(label!=='before')report.checks.push('disabled capture releases canvas backing dimensions to 0 × 0');
  await mkdir(output,{recursive:true});await writeFile(resolve(output,'visual-'+label+'.json'),JSON.stringify(report,null,2));
  console.log('Memory pixel/lifecycle acceptance: PASS',label);
}finally{await f.app.close();}
