import {_electron as electron,expect} from '@playwright/test';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const executablePath=createRequire(resolve('apps/desktop/package.json'))('electron');
const output=resolve('reports/whale-pool');await mkdir(output,{recursive:true});
const profiles=resolve('reports/whale-pool-profiles');await mkdir(profiles,{recursive:true});
const errors=[],checks=[];
await writeFile(join(output,'result.json'),JSON.stringify({status:'running',checks,errors}));
async function launch(profile,smoke=false){
  const env={...process.env,GLASS_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.GLASS_SMOKE;if(smoke)env.GLASS_SMOKE='1';
  const app=await electron.launch({executablePath,args:[resolve('apps/desktop')],env});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>window.glass&&document.querySelector('.glass'));await page.waitForTimeout(200);
  return {app,page,state:()=>page.evaluate(()=>window.glass.getWindowState())};
}
const first=await mkdtemp(join(profiles,'first-'));
let run=await launch(first);
try{
  await run.page.getByRole('dialog',{name:'小鲸鱼有自己的水池了'}).waitFor();
  assert.equal((await run.state()).settings.appearance,'classic');
  await run.page.screenshot({path:join(output,'first-install-intro.png')});
  await run.page.getByRole('button',{name:'暂时保留当前形态'}).click();
  await expect.poll(async()=>(await run.state()).panel).toBe(null);
  assert.equal((await run.state()).settings.appearance,'classic');
  checks.push('Fresh install shows introduction; later preserves classic appearance');
}finally{await run.app.close();}
run=await launch(first);
try{await expect.poll(async()=>(await run.state()).panel).toBe(null);checks.push('Dismissal survives application restart');}finally{await run.app.close();}
const upgrade=await mkdtemp(join(profiles,'upgrade-'));
await writeFile(join(upgrade,'glass-ui.json'),JSON.stringify({version:2,settings:{theme:'light',material:'solid',pin:'normal',defaultView:'peek'},mode:'peek',manual:false,bounds:{x:100,y:100,width:340,height:190}}));
run=await launch(upgrade);
try{
  await run.page.getByRole('dialog').waitFor();
  assert.equal((await run.state()).settings.material,'solid');
  await run.page.getByRole('button',{name:'立即体验'}).click();
  await expect.poll(async()=>(await run.state()).settings.appearance).toBe('whale-pool');
  await run.page.getByRole('button',{name:/小鲸鱼，.*点击展开水池/}).click();
  await run.page.locator('.pool-view[data-readable=true]').waitFor({timeout:8000});
  await expect(run.page.locator('.pool-empty')).toContainText('连接恢复');
  assert.equal(await run.page.locator('.pool-steps li').count(),0);
  await run.page.screenshot({path:join(output,'water-empty-live.png'),omitBackground:true});
  checks.push('Existing preferences get feature notice; try-now selects independent pool with honest disconnected state');
  await run.page.evaluate(()=>window.glass.windowAction('settings'));
  await run.page.getByLabel('水池排版',{exact:true}).selectOption('stream');
  await run.page.getByLabel('水池轮廓',{exact:true}).selectOption('drop');
  await run.page.getByRole('button',{name:'返回',exact:true}).click();
}finally{await run.app.close();}
run=await launch(upgrade);
try{
  await expect.poll(async()=>(await run.state()).panel).toBe(null);
  assert.equal((await run.state()).settings.appearance,'whale-pool');
  assert.equal((await run.state()).settings.poolLayout,'stream');assert.equal((await run.state()).settings.poolContour,'drop');
  const saved=JSON.parse(await readFile(join(upgrade,'glass-ui.json'),'utf8'));assert.ok(saved.announcements.includes('whale-pool-v1'));
  checks.push('Try-now acknowledgement and layout/contour preferences survive restart');
}finally{await run.app.close();}
const mock=await mkdtemp(join(profiles,'mock-'));run=await launch(mock,true);
try{
  await run.page.evaluate(()=>window.glass.setSettings({appearance:'whale-pool',animation:'off'}));
  await run.page.getByRole('button',{name:/小鲸鱼，.*点击展开水池/}).click();await run.page.locator('.pool-view[data-readable=true]').waitFor();
  for(const layout of ['clear','stream','letter']){
    await run.page.evaluate(poolLayout=>window.glass.setSettings({poolLayout}),layout);
    await run.page.locator(`.pool-view[data-layout=${layout}]`).waitFor();
    await run.page.screenshot({path:join(output,`pool-${layout}.png`),omitBackground:true});
    assert.equal(await run.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await run.page.locator('.pool-heading h1').textContent());
  }
  checks.push('All three retained layouts render live Mock projections without horizontal overflow');
  await run.page.evaluate(()=>{window.__poolContextLoss=document.querySelector('.pool-water').getContext('webgl').getExtension('WEBGL_lose_context');window.__poolContextLoss.loseContext();});
  await run.page.locator('.pool-view[data-fallback=true]').waitFor();
  await run.page.evaluate(()=>window.__poolContextLoss.restoreContext());
  await run.page.locator('.pool-view[data-fallback=false]').waitFor();
  checks.push('Water gracefully falls back on GPU context loss and restores without hiding task controls');
  await run.page.evaluate(()=>window.glass.mockAction('approval-queue'));
  await run.page.evaluate(()=>window.glass.windowAction('collapse',true));
  await run.page.getByRole('button',{name:/项操作需要确认/}).waitFor({timeout:10000});
  await run.page.getByRole('button',{name:/项操作需要确认/}).click();
  await run.page.locator('[data-mode=approval]').waitFor();
  await run.page.evaluate(()=>window.glass.windowAction('collapse',true));
  await run.page.getByRole('button',{name:/小鲸鱼，.*点击展开水池/}).click();await run.page.locator('.pool-view[data-readable=true]').waitFor();
  await run.page.getByRole('button',{name:/任务详情/}).click();await run.page.locator('[data-mode=expanded]').waitFor();
  await run.page.evaluate(()=>window.glass.windowAction('approval'));await run.page.locator('[data-mode=approval]').waitFor();
  for(const button of await run.page.getByRole('button',{name:'允许一次',exact:true}).all())await expect(button).toBeDisabled();
  checks.push('Original details and approval views remain available; Mock approval stays fail-closed');
  await run.app.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().getMenuItemById('view-whale-pool');item.click(item,BrowserWindow.getAllWindows()[0],{});});
  await expect.poll(async()=>(await run.state()).settings.appearance).toBe('whale-pool');
  await run.app.evaluate(({Menu,BrowserWindow})=>{const item=Menu.getApplicationMenu().getMenuItemById('view-capsule');item.click(item,BrowserWindow.getAllWindows()[0],{});});
  await run.page.locator('.glass[data-appearance=classic][data-mode=capsule]>.task-capsule').waitFor();
  checks.push('Independent pool menu entry and original capsule menu entry select their own appearance');
}finally{await run.app.close();}
assert.deepEqual(errors,[]);
await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',checks,errors},null,2));
console.log(JSON.stringify({checks,errors},null,2));
