// A bounded, controlled native background in the isolated Electron fixture.
// Its extra renderer is included in both sides of the memory comparison.
export async function memoryBackdrop(f) {
  await f.backdrop('rgb(170,170,170)');
  await f.app.evaluate(({BrowserWindow},id)=>BrowserWindow.getAllWindows().find(w=>w.id!==id).setBounds({x:100,y:80,width:800,height:600}),f.mainId);
  async function update(colors) {
    await f.app.evaluate(async({BrowserWindow},{id,colors})=>{
      const bg=BrowserWindow.getAllWindows().find(w=>w.id!==id);
      await bg.webContents.executeJavaScript(`clearInterval(window.__memoryTimer);document.body.style.background=${JSON.stringify(`rgb(${colors.join(',')})`)};`);
    },{id:f.mainId,colors});
  }
  return {color:(...colors)=>update(colors),animate:()=>f.app.evaluate(async({BrowserWindow},id)=>{
    const bg=BrowserWindow.getAllWindows().find(w=>w.id!==id);
    await bg.webContents.executeJavaScript("clearInterval(window.__memoryTimer);let alternate=false;window.__memoryTimer=setInterval(()=>{alternate=!alternate;document.body.style.background=alternate?'rgb(210,140,170)':'rgb(90,140,170)';},180);");
  },f.mainId),animateFast:()=>f.app.evaluate(async({BrowserWindow},id)=>{
    const bg=BrowserWindow.getAllWindows().find(w=>w.id!==id);
    await bg.webContents.executeJavaScript("clearInterval(window.__memoryTimer);let colour=0;window.__memoryTimer=setInterval(()=>{colour=(colour+7)%256;document.body.style.background='rgb('+colour+',140,170)';},16);");
  },f.mainId)};
}
