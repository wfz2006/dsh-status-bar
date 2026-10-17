import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture();const results=[];const out=process.env.GLASS_UI_REPORT??'reports/ui-clarity';await mkdir(out,{recursive:true});
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'auto',pin:'always'}));
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 await f.menu('mock-approval-queue');
 await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(2);
 await f.page.evaluate(()=>{window.__ownedColor=null;window.glass.subscribeOpticsFrame(frame=>{const expected=window.__expectedColor;if(!expected)return;let invalid=0;for(let i=0;i<frame.pixels.length;i+=4)if(expected.some((v,c)=>Math.abs(frame.pixels[i+c]-v)>8))invalid++;window.__ownedColor={invalid,width:frame.windowWidth,height:frame.windowHeight};});});
 for(const [tone,bg] of [['light','#e9e5dd'],['dark','#171c22']]) {
  await f.page.evaluate(color=>{window.__expectedColor=color;window.__ownedColor=null;},tone==='light'?[233,229,221]:[23,28,34]);
  await f.backdrop(bg);await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>f.page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  await expect(f.page.locator('main')).toHaveAttribute('data-backdrop-tone',tone);
  for(const mode of ['peek','expanded','approval','settings']) {
   await f.menu(mode==='settings'?'settings':'view-'+mode);
   // Reject an occluded/stale source before writing any image. Never export
   // unrelated desktop content as a visual fixture.
   await expect.poll(async()=>f.page.evaluate(()=>{const c=document.querySelector('.desktop-backdrop');const input=window.__ownedColor;return !!input && input.invalid===0 && Math.abs(input.width-innerWidth*devicePixelRatio)<=3 && Math.abs(input.height-innerHeight*devicePixelRatio)<=3 && getComputedStyle(c).visibility==='visible';}),{timeout:10000}).toBe(true);
   await expect(f.page.getByRole('button',{name:'收起窗口',exact:true})).toBeVisible();
   await expect(f.page.getByRole('button',{name:'窗口菜单',exact:true})).toBeVisible();
   const chrome=await f.page.locator('.chrome-group').boundingBox();assert.ok(chrome);
   for(const item of await f.page.locator('.task-heading>h1,.task-heading>.step-count,.task-heading>.session-picker').all()) {
    const b=await item.boundingBox();if(b)assert.ok(b.x+b.width<=chrome.x || b.y>=chrome.y+chrome.height,'Header and toolbar must not overlap');
   }
   const rim=await f.page.locator('.glass-rim').evaluate(e=>getComputedStyle(e).boxShadow);
   assert.ok(rim.includes('1.5px'), 'slightly thicker inset rim must be visible');
   if(mode==='peek') {
    const attention=f.page.locator('.attention-link'),label=attention.locator('.control-label');
    const [buttonBox,labelBox]=await Promise.all([attention.boundingBox(),label.boundingBox()]);
    assert.ok(buttonBox && labelBox && labelBox.x-buttonBox.x>=10 && labelBox.x-buttonBox.x<=15,'Motion wrapper must preserve the left-aligned action label');
   }
   if(tone==='light') {
    for(const selector of ['h1']) {
     const items=f.page.locator(selector);
     for(let i=0;i<await items.count();i++)await expect(items.nth(i)).toHaveCSS('color','rgb(0, 0, 0)');
    }
    for(const [selector,color] of [['.command-preview','rgb(0, 0, 0)'],['.step-count','rgb(32, 36, 42)'],['.request-session','rgb(32, 36, 42)']]) {
     const items=f.page.locator(selector);for(let i=0;i<await items.count();i++)await expect(items.nth(i)).toHaveCSS('color',color);
    }
   }
   if(mode==='approval') {
    for(const name of ['允许一次','拒绝']) {
     const b=f.page.getByRole('button',{name,exact:true});await expect(b).toBeDisabled();
     const style=await b.evaluate(e=>({bg:getComputedStyle(e).backgroundImage,opacity:getComputedStyle(e).opacity,font:getComputedStyle(e).fontSize}));
     assert.notEqual(style.bg,'none');assert.equal(style.opacity,'1');results.push({tone,name,...style});
    }
   }
   await f.page.screenshot({path:out+'/'+tone+'-'+mode+'.png'});
   if(mode==='settings') {
    const auto=f.page.getByRole('checkbox',{name:'审批时自动展开'});
    await auto.focus();await f.page.keyboard.press('Space');await expect(auto).toBeChecked();
    await f.page.keyboard.press('Space');await expect(auto).not.toBeChecked();
   }
  }
 }
 await f.page.getByRole('button',{name:'收起窗口',exact:true}).click();
 await expect(f.page.locator('.task-capsule')).toBeVisible();
 await f.page.evaluate(()=>window.glass.setOpticsEnabled(false));
 await expect(f.page.locator('main')).not.toHaveAttribute('data-backdrop-tone');
 await writeFile(out+'/acceptance.json',JSON.stringify(results,null,2));
 console.log('Light/dark actual backdrop ink, visible controls, tinted disabled decisions and collapse: PASS');
}finally {await f.app.close();}
