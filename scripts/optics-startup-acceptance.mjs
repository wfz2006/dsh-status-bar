import { fixture } from './native-fixture.mjs';
import { expect } from '@playwright/test';
let f=await fixture({},['--desktop-optics']);
try {
  await expect.poll(()=>f.page.evaluate(()=>window.glass.getOpticsState()),{timeout:10000}).toMatchObject({enabled:true,running:true});
}finally {await f.app.close();}
f=await fixture();
try {
  await expect.poll(()=>f.page.evaluate(()=>window.glass.getOpticsState())).toEqual({enabled:false,running:false,error:null});
  console.log('Explicit startup opt-in works; ordinary restart defaults off: PASS');
}finally {await f.app.close();}
