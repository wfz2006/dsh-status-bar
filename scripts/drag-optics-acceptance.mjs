import {fixture} from './native-fixture.mjs';
import {expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const f=await fixture({},[],process.env.GLASS_AUDIT_APP);const result=[];
try {
  await f.page.evaluate(()=>window.glass.setSettings({animation:'full',theme:'light',pin:'always'}));
  await f.menu('view-peek');
  await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(220,160),f.mainId);
  await f.backdrop('repeating-linear-gradient(90deg,#eeeeee 0 16px,#181818 16px 32px)');
  await f.page.evaluate(()=>window.glass.setOpticsEnabled(true));
  await expect.poll(()=>f.page.evaluate(()=>window.glass.getOpticsState())).toMatchObject({running:true});
  for(const [mode,selector,distance=36,interval=65] of [['peek','.task-heading h1'],['expanded','.todo-text'],['capsule','.capsule-title'],['peek','.task-heading',120,30]]) {
    // Each drag is a no-new-request trace. Keep the 7.2s Mock approval from
    // legitimately opening its sheet in the middle of a later pointer hold.
    await f.page.evaluate(()=>window.glass.mockAction('restart'));
    await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).connection).toBe('connected');
    await f.menu('view-'+mode);
    if(mode==='expanded')await f.page.getByRole('tab',{name:/步骤/}).click();
    await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(220,160),f.mainId);
    await f.page.locator(selector).first().scrollIntoViewIfNeeded();
    await f.page.waitForTimeout(350);
    const box=await f.page.locator(selector).first().boundingBox();assert.ok(box);
    const before=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
    const viewport=await f.page.evaluate(()=>[innerWidth,innerHeight]);
    const hit=await f.page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML,{x:box.x+35,y:box.y+box.height/2});
    await f.page.evaluate(()=>{window.__dragFrames=[];window.__offDrag=window.glass.subscribeOpticsFrame(v=>{const x=v.windowLeft-v.left+60,y=v.windowTop-v.top+60;window.__dragFrames.push({x:v.windowLeft,t:performance.now(),pixel:v.pixels[(y*v.width+x)*4]});});});
    await f.page.mouse.move(box.x+35,box.y+box.height/2);await f.page.mouse.down();
    // Keep button down for the whole trace. Query both Main and renderer while moving.
    for(let i=1;i<=12;i++) {
      const current=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
      await f.page.mouse.move(box.x+35+distance*i/12-(current.x-before.x),box.y+box.height/2);
      await f.page.waitForTimeout(interval);
      assert.deepEqual(await f.page.evaluate(()=>[innerWidth,innerHeight]),viewport,mode+' must not resize while pointer is held');
    }
    const during=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
    const frames=await f.page.evaluate(()=>window.__dragFrames);
    await f.page.mouse.up();
    await f.page.evaluate(()=>window.__offDrag());
    assert.ok(during.x-before.x>=20,mode+' text must drag the window; '+JSON.stringify({before,during,hit}));
    assert.equal(await f.page.evaluate(()=>getSelection().toString()),'',mode+' must not select task text');
    assert.equal((await f.page.evaluate(()=>window.glass.getWindowState())).viewMode,mode,'Dragging must not activate expansion');
    const distinct=new Set(frames.map(v=>v.x)).size;
    assert.ok(distinct>=3,mode+' needs fresh positions while button remains down; '+JSON.stringify(frames));
    const pixelLevels=new Set(frames.map(v=>Math.round(v.pixel/20)));
    assert.ok(pixelLevels.size>=2,mode+' actual backdrop pixels must change while dragging');
    result.push({mode,selector,delta:during.x-before.x,framesDuringHold:frames.length,distinctFramePositions:distinct,pixelLevels:pixelLevels.size});
  }
  // Plain clicks still expand, genuine controls remain clickable, command text selectable.
  // Full-motion traces can outlast the scheduled Mock approval at 7.2s.
  // Reset the actual source so this no-pending-request click test is deterministic.
  await f.page.evaluate(()=>window.glass.mockAction('restart'));
  await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length).toBe(0);
  await f.menu('view-capsule');
  await f.page.locator('main').dispatchEvent('pointercancel');
  await f.page.locator('.task-capsule').focus();await f.page.keyboard.press('Enter');
  await expect(f.page.locator('.task-peek')).toBeVisible();
  await f.menu('view-capsule');
  await f.page.locator('.task-capsule').click();
  await expect(f.page.locator('.task-peek')).toBeVisible();
  await f.page.locator('.peek-main').click();
  await expect(f.page.locator('.task-expanded')).toBeVisible();
  await f.menu('settings');
  const settingsBounds=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId);
  await f.page.getByRole('combobox',{name:'显示主题'}).selectOption('dark');
  assert.equal((await f.page.evaluate(()=>window.glass.getWindowState())).settings.theme,'dark');
  assert.deepEqual(await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getBounds(),f.mainId),settingsBounds);
  await f.page.getByRole('button',{name:'返回',exact:true}).click();
  await f.page.evaluate(()=>window.glass.mockAction('long-approval'));await f.menu('view-approval');
  await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(1);
  await f.page.locator('.request-details summary').click();
  await expect(f.page.locator('.command-full')).toBeVisible();
  await expect(f.page.locator('.command-full')).toHaveCSS('user-select','text');
  await mkdir('reports/drag-optics',{recursive:true});await writeFile('reports/drag-optics/acceptance.json',JSON.stringify(result,null,2));
  console.log(result);
}finally {await f.app.close();}
