// Export the current real renderer's markup and CSS, avoiding a second UI design.
// This fixture contains deterministic MOCK data only; no DSH credentials/chat.
import { fixture } from './native-fixture.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
const out='experiments/tauri-glass/web';
await mkdir(out,{recursive:true});
const f=await fixture();
try {
  await f.page.evaluate(()=>window.glass.setSettings({theme:'light',animation:'off',material:'transparent'}));
  await expect.poll(async()=>(await f.page.evaluate(()=>window.glass.getState())).approvals.length,{timeout:15000}).toBe(1);
  const modes={};
  for(const mode of ['capsule','peek','expanded','approval']) {
    await f.menu('view-'+mode);
    await expect(f.page.locator(`main[data-mode=${mode}]`)).toBeVisible();
    modes[mode]=await f.page.locator('main').evaluate(e=>{const copy=e.cloneNode(true);copy.querySelector('.glass-material')?.remove();return copy.outerHTML;});
  }
  const css=await f.page.evaluate(()=>Array.from(document.styleSheets).flatMap(s=>Array.from(s.cssRules,r=>r.cssText)).join('\n'));
  await writeFile(out+'/style.css',css);
  await writeFile(out+'/fixture.js','/* global document, window */\n/* Generated mock snapshot: node scripts/export-native-comparison.mjs */\nconst modes='+JSON.stringify(modes)+';\ndocument.getElementById("root").innerHTML=modes[window.COMPARE_MODE]||modes.peek;\n');
  console.log('Exported identical 4-mode mock renderer for native comparison.');
} finally {await f.app.close();}
