import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {screen,type BrowserWindow} from 'electron';

// UI-only worker mode. It never enters the helper's screen-capture branch.
export function createWindowPositioner(win:BrowserWindow,helper:string) {
  let child:ChildProcessWithoutNullStreams|undefined;
  let waiter:{resolve:()=>void;reject:(error:Error)=>void}|undefined;
  let idle:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  let response='';
  function stop() {
    clearTimeout(idle);clearTimeout(deadline);
    const old=child;child=undefined;old?.stdin.end();old?.kill();
    const pending=waiter;waiter=undefined;response='';pending?.reject(new Error('Window movement unavailable'));
  }
  function worker() {
    if(child)return child;
    const current=spawn(helper,['--position',win.getNativeWindowHandle().readBigUInt64LE().toString(),String(process.pid)],{windowsHide:true,stdio:'pipe'});
    child=current;
    const failed=()=>{if(child===current)stop();};
    current.on('error',failed);current.on('exit',failed);current.stdin.on('error',failed);current.stdout.on('error',failed);
    current.stderr.on('data',()=>{});
    current.stdout.on('data',(chunk:Buffer)=>{
      if(child!==current)return;
      response+=chunk.toString('ascii');
      if(response.length>16){failed();return;}
      if(!response.includes('\n'))return;
      if(response.trim()!=='ok' || !waiter){failed();return;}
      response='';clearTimeout(deadline);
      const pending=waiter;waiter=undefined;pending.resolve();
      idle=setTimeout(stop,1200);
    });
    return current;
  }
  async function move(x:number,y:number) {
    if(win.isDestroyed() || !win.isVisible() || win.isMinimized())throw new Error('Window is hidden');
    if(process.platform!=='win32'){win.setPosition(x,y);return;}
    if(waiter)throw new Error('Window movement already pending');
    clearTimeout(idle);
    const point=screen.dipToScreenPoint({x,y});const current=worker();
    await new Promise<void>((resolve,reject)=>{
      waiter={resolve,reject};deadline=setTimeout(stop,1500);
      current.stdin.write(Math.round(point.x)+' '+Math.round(point.y)+'\n');
    });
  }
  win.on('hide',stop);win.on('minimize',stop);win.on('closed',stop);
  return {move,stop};
}
