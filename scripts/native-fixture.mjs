import { _electron as electron, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

export const backgrounds = {
  light: 'linear-gradient(120deg,#eff8ff,#fffbe8)',
  dark: 'linear-gradient(120deg,#101d33,#253c4b)',
  busy: 'repeating-linear-gradient(35deg,transparent 0 36px,#ffffff30 36px 38px),conic-gradient(#70add5,#faf2c8,#87bca6,#70add5)',
};
export async function fixture(extraEnv = {}, extraArgs = []) {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-glass-audit-'));
  const env = { ...process.env, GLASS_SMOKE:'1', GLASS_USER_DATA_DIR:profile, ...extraEnv }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath:createRequire(resolve('apps/desktop/package.json'))('electron'), args:[...extraArgs,resolve('apps/desktop')], env });
  const page = await app.firstWindow();
  await page.locator('main').waitFor();
  await expect.poll(async () => (await page.evaluate(() => window.glass.getState())).connection).toBe('connected');
  const mainId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id);
  async function menu(id) {
    await app.evaluate(({ Menu, BrowserWindow }, { id, mainId }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById(id); if (!item?.enabled) throw new Error(id);
      item.click(item, BrowserWindow.fromId(mainId), {});
    }, { id, mainId });
    await expect.poll(async () => (await page.evaluate(() => window.glass.getWindowState())).morphing).toBe(null);
  }
  async function backdrop(color = backgrounds.busy) {
    await app.evaluate(async ({ BrowserWindow }, { mainId, color }) => {
      let bg = BrowserWindow.getAllWindows().find(w => w.id !== mainId);
      if (!bg) bg = new BrowserWindow({ x:150,y:100,width:620,height:620,frame:false,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
      await bg.loadURL('data:text/html,' + encodeURIComponent('<style>body{margin:0;height:100vh;background:'+color+'}</style>'));
      bg.setAlwaysOnTop(true); bg.showInactive();
      const main = BrowserWindow.fromId(mainId); main.setAlwaysOnTop(true,'screen-saver'); main.show(); main.focus(); main.moveTop();
    }, { mainId, color });
    await page.waitForTimeout(600);
  }
  async function rect() { return app.evaluate(({ BrowserWindow, screen }, mainId) => { const w=BrowserWindow.fromId(mainId); return screen.dipToScreenRect(w,w.getBounds()); }, mainId); }
  async function capture(path) {
    await mkdir(resolve(path,'..'),{recursive:true});
    await app.evaluate(({BrowserWindow},id)=>{const w=BrowserWindow.fromId(id);w.show();w.setAlwaysOnTop(true,'screen-saver');w.focus();w.moveTop();},mainId);
    await expect.poll(()=>app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isFocused(),mainId)).toBe(true);
    const handle=await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).getNativeWindowHandle().readBigUInt64LE().toString(),mainId);
    const temp=join(tmpdir(),'dsh-audit-'+Date.now()+'.png');
    execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/capture-owned-window.ps1'),'-Path',temp,'-Handle',handle],{windowsHide:true,stdio:'pipe'});
    if(!await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id).isFocused(),mainId))throw new Error('Capture interrupted by another app; sample rejected');
    await copyFile(temp,path);
  }
  return { app,page,mainId,menu,backdrop,capture,rect };
}
