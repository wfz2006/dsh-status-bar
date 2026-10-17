import { fixture } from './native-fixture.mjs';
import assert from 'node:assert/strict';
const f=await fixture();
try{
  const {page,menu}=f;
  await page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'light'}));
  await menu('view-peek');
  await page.locator('.task-peek .task-heading h1').waitFor();
  const styles=await page.evaluate(()=>{
    const surface=document.querySelector('.lg-material-surface');
    const text=document.querySelector('.task-heading h1');
    return {fill:getComputedStyle(surface).backgroundImage,before:getComputedStyle(surface,'::before').backgroundImage,after:getComputedStyle(surface,'::after').backgroundColor,shadow:getComputedStyle(text).textShadow,stroke:getComputedStyle(text).webkitTextStrokeWidth,weight:getComputedStyle(text).fontWeight};
  });
  assert.equal(styles.fill,'none','No tinted full-surface gradient');
  assert.equal(styles.after,'rgba(0, 0, 0, 0)','No blue/gray backing fill');
  assert.equal(styles.shadow,'none','Text must have no light halo');
  assert.equal(styles.stroke,'0px','Text must have no outline');
  assert.ok(Number(styles.weight)>=500);
  console.log('Neutral transparent surface and solid unoutlined text: PASS');
}finally{await f.app.close();}
