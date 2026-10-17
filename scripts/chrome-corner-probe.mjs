import {fixture} from './native-fixture.mjs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const f=await fixture();
try {
 await f.page.evaluate(()=>window.glass.setSettings({animation:'off',theme:'dark',material:'acrylic',pin:'always'}));
 await f.menu('settings');
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setPosition(210,150),f.mainId);
 // Diagnostic-only: deliberately bypass the retired preference to reproduce
 // the Windows compositor defect in this isolated fixture.
 await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).setBackgroundMaterial('acrylic'),f.mainId);
 await f.backdrop('#92b2c8');
 const path=join(tmpdir(),'dsh-corner-before.png');await f.capture(path);
 console.log(JSON.stringify({path,bounds:await f.rect()}));
 const handle=await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE().toString(),f.mainId);
 execFileSync('powershell',['-NoProfile','-File','scripts/probe-native-rounding.ps1','-Handle',handle],{windowsHide:true});
 await f.page.waitForTimeout(300);
 const after=join(tmpdir(),'dsh-corner-after-native.png');await f.capture(after);console.log(after);
}finally {await f.app.close();}
