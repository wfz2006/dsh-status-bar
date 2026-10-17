import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out='reports/glass-appearance';await mkdir(out,{recursive:true});
const f=await fixture(),result={};
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'auto',pin:'always'}));await f.menu('settings');
 const color=f.page.getByLabel('玻璃底色',{exact:true}),opacity=f.page.getByRole('slider',{name:'底色浓度'}),brightness=f.page.getByRole('slider',{name:'玻璃亮度'});
 await expect(color).toHaveValue('#000000');await expect(opacity).toHaveValue('10');await expect(brightness).toHaveValue('100');await expect(brightness).toBeDisabled();
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);await f.backdrop('#aaaaaa');
 await f.page.evaluate(()=>{window.__appearanceFrames=0;window.__ownedAppearance=false;window.__expectedRGB=[170,170,170];window.glass.subscribeOpticsFrame(frame=>{window.__appearanceFrames++;let invalid=0;for(let i=0;i<frame.pixels.length;i+=4)if(window.__expectedRGB?.some((v,c)=>Math.abs(frame.pixels[i+c]-v)>3))invalid++;window.__appearanceDiagnostic={invalid,first:[...frame.pixels.slice(0,4)],physical:[frame.windowWidth,frame.windowHeight],viewport:[innerWidth*devicePixelRatio,innerHeight*devicePixelRatio]};window.__ownedAppearance=invalid===0 && Math.abs(frame.windowWidth-innerWidth*devicePixelRatio)<3 && Math.abs(frame.windowHeight-innerHeight*devicePixelRatio)<3;});});
 await f.page.getByRole('checkbox',{name:'真实折射与色散'}).check();await expect(brightness).toBeEnabled();
 await expect.poll(()=>f.page.evaluate(()=>window.__ownedAppearance || window.__appearanceDiagnostic),{timeout:10000}).toBe(true);
 await color.evaluate(input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#4090e0');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await expect.poll(()=>f.page.evaluate(()=>window.glass.getWindowState())).toMatchObject({settings:{tintColor:'#4090e0'}});
 await opacity.focus();await f.page.keyboard.press('Home');for(let i=0;i<30;i++)await f.page.keyboard.press('ArrowRight');await expect(opacity).toHaveValue('30');
 await brightness.focus();await f.page.keyboard.press('End');await f.page.keyboard.press('ArrowLeft');await expect(brightness).toHaveValue('149');
 const beforeBounds=await f.rect();
 await opacity.scrollIntoViewIfNeeded();const track=await opacity.boundingBox();await f.page.mouse.move(track.x+track.width*.3,track.y+track.height/2);await f.page.mouse.down();await f.page.mouse.move(track.x+track.width*.7,track.y+track.height/2,{steps:8});await f.page.mouse.up();
 assert.ok(Number(await opacity.inputValue())>60,JSON.stringify({track,value:await opacity.inputValue(),beforeBounds,afterBounds:await f.rect(),hit:await f.page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML,{x:track.x+track.width*.7,y:track.y+track.height/2})}));assert.deepEqual(await f.rect(),beforeBounds,'Sliders must not drag or resize the window');
 await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getWindowState())).settings.tintOpacity).toBe(Number(await opacity.inputValue()));
 result.ui={color:await color.inputValue(),opacity:await opacity.inputValue(),brightness:await brightness.inputValue(),stableWindow:true};
 await f.page.screenshot({path:out+'/settings-custom.png'});
 await f.page.getByRole('button',{name:'恢复默认',exact:true}).click();await expect(color).toHaveValue('#000000');await expect(opacity).toHaveValue('10');await expect(brightness).toHaveValue('100');
 await f.menu('view-peek');
 await f.page.evaluate(()=>window.glass.setSettings({tintOpacity:0,brightness:100}));
 await expect.poll(()=>f.page.evaluate(()=>window.__ownedAppearance)).toBe(true);
 result.region=await f.page.evaluate(()=>{const p=document.querySelector('.task-progress').getBoundingClientRect(),s=document.querySelector('.current-step').getBoundingClientRect();return {left:50,right:Math.floor(innerWidth*devicePixelRatio)-50,top:Math.ceil((p.bottom+8)*devicePixelRatio),bottom:Math.floor((s.top-8)*devicePixelRatio)};});
 for(const value of [100,50,150]) {
  await f.page.evaluate(brightness=>window.glass.setSettings({brightness}),value);
  await expect(f.page.locator('.glass-body')).toHaveCSS('filter',value===100?'none':`brightness(${value/100})`);
  await expect(f.page.locator('main')).toHaveAttribute('data-backdrop-tone',value===50?'dark':'light');
  await expect(f.page.locator('h1')).toHaveCSS('color',value===50?'rgb(244, 245, 247)':'rgb(0, 0, 0)');
  await expect.poll(()=>f.page.evaluate(()=>window.__ownedAppearance)).toBe(true);
  await f.page.screenshot({path:out+`/brightness-${value}.png`});
 }
 await f.page.evaluate(()=>window.glass.setSettings({tintColor:'#4090e0',tintOpacity:30,brightness:100}));await f.page.screenshot({path:out+'/blue-thirty.png'});
 result.layers=await f.page.evaluate(()=>({textFilter:getComputedStyle(document.querySelector('h1')).filter,rimFilter:getComputedStyle(document.querySelector('.glass-rim')).filter,textOpacity:getComputedStyle(document.querySelector('h1')).opacity,tint:getComputedStyle(document.querySelector('.glass-tint')).backgroundColor}));
 assert.deepEqual(result.layers,{textFilter:'none',rimFilter:'none',textOpacity:'1',tint:'rgba(64, 144, 224, 0.3)'});
 // Scrub through IPC without destroying the live canvas or changing geometry.
 const oldFrames=await f.page.evaluate(()=>window.__appearanceFrames),bounds=await f.rect();
 await f.page.evaluate(async()=>{for(let brightness=70;brightness<=130;brightness+=2)await window.glass.setSettings({brightness});});
 await expect.poll(()=>f.page.evaluate(()=>window.__appearanceFrames)).toBeGreaterThan(oldFrames);await expect(f.page.locator('.desktop-backdrop')).toHaveCSS('visibility','visible');assert.deepEqual(await f.rect(),bounds);
 // Keep the actual SVG lens active under non-default brightness.
 await f.page.evaluate(()=>{window.__expectedRGB=null;window.__ownedAppearance=false;});await f.backdrop('repeating-linear-gradient(90deg,#eeeeee 0 8px,#181818 8px 10px,#eeeeee 10px 32px)');
 await f.page.evaluate(()=>window.glass.setSettings({tintColor:'#000000',tintOpacity:10,brightness:125}));
 await expect.poll(()=>f.page.locator('.desktop-backdrop').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let low=false,high=false,invalid=0;for(let i=0;i<d.length;i+=4){const v=d[i];low ||= v<30;high ||= v>230;if(Math.abs(v-d[i+1])>8 || Math.abs(v-d[i+2])>8)invalid++;}return low&&high&&invalid===0;})).toBe(true);
 await f.page.screenshot({path:out+'/lens-bright-refracted.png'});
 await f.page.evaluate(()=>document.querySelectorAll('#glass-defs feDisplacementMap').forEach(n=>{n.dataset.scale=n.getAttribute('scale');n.setAttribute('scale','0');}));
 await f.page.screenshot({path:out+'/lens-bright-zero.png'});
 await f.page.evaluate(()=>document.querySelectorAll('#glass-defs feDisplacementMap').forEach(n=>n.setAttribute('scale',n.dataset.scale)));
 await f.menu('settings');await f.page.evaluate(()=>window.glass.setOpticsEnabled(false));await expect(brightness).toBeDisabled();await expect(brightness).toHaveValue('125');
 await f.page.evaluate(()=>window.glass.setSettings({material:'solid'}));await expect(color).toBeDisabled();await expect(opacity).toBeDisabled();await expect(f.page.locator('.glass-tint')).toHaveCount(0);
 await f.page.evaluate(()=>window.glass.setSettings({material:'transparent'}));await expect(color).toBeEnabled();await expect(color).toHaveValue('#000000');await expect(brightness).toHaveValue('125');await expect(brightness).toBeDisabled();
 result.noSamplingOnRestore=!(await f.page.evaluate(()=>window.glass.getOpticsState())).enabled;
 await writeFile(out+'/acceptance.json',JSON.stringify(result,null,2));console.log('Color, keyboard/pointer sliders, reset, live brightness/ink, fixed bounds, lens and sampling-off/solid fallback: PASS');
}finally {await f.app.close();}
