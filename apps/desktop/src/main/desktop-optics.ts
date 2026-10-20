import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { screen,type BrowserWindow } from 'electron';
import { CAPTURE_HEADER_BYTES, MAX_CAPTURE_BYTES, decodeCaptureHeader,projectCaptureFrame, type CaptureHeader, type DesktopOpticsState } from '../shared/desktop-optics';

export function createDesktopOptics(win:BrowserWindow, helper:string) {
  let current:DesktopOpticsState={enabled:false,running:false,error:null};
  let child:ChildProcessWithoutNullStreams | undefined;
  let timer:ReturnType<typeof setInterval> | undefined;
  let timeout:ReturnType<typeof setTimeout> | undefined;
  let pending=Buffer.alloc(0), header:CaptureHeader | undefined;
  const headerData=Buffer.alloc(CAPTURE_HEADER_BYTES);
  let headerOffset=0,frameOffset=0;
  let busy=false;
  let forceFrame=true;
  let nextFrame=0;
  const state=()=>({...current});
  function currentBounds() {const b=screen.dipToScreenRect(win,win.getBounds());return {windowLeft:b.x,windowTop:b.y,windowWidth:b.width,windowHeight:b.height};}
  function publishPosition() {if(current.enabled && !win.isDestroyed())win.webContents.send('glass:optics-position',currentBounds());}
  function publish() {if(!win.isDestroyed())win.webContents.send('glass:optics-state',state());}
  function stopProcess() {
    clearInterval(timer);clearTimeout(timeout);timer=undefined;timeout=undefined;
    const previous=child;child=undefined;previous?.stdin.end();previous?.kill();
    pending.fill(0);pending=Buffer.alloc(0);headerData.fill(0);headerOffset=0;frameOffset=0;header=undefined;busy=false;
    current.running=false;
  }
  function fail() {stopProcess();current={enabled:false,running:false,error:'屏幕取样不可用，已停止'};if(!win.isDestroyed())win.setContentProtection(false);publish();}
  function start() {
    if(child || !current.enabled || !win.isVisible() || win.isMinimized())return;
    // Windows 10 2004+: exclude our own HWND from capture to prevent feedback.
    win.setContentProtection(true);
    const hwnd=win.getNativeWindowHandle().readBigUInt64LE().toString();
    const worker=spawn(helper,[hwnd,String(process.pid)],{windowsHide:true,stdio:'pipe'});
    child=worker;pending=Buffer.alloc(0);header=undefined;forceFrame=true;
    worker.on('error',()=>{if(child===worker)fail();});
    worker.on('exit',()=>{if(child===worker)fail();});
    worker.stdin.on('error',()=>{if(child===worker)fail();});
    worker.stdout.on('error',()=>{if(child===worker)fail();});
    worker.stderr.on('data',()=>{}); // Fixed non-sensitive helper error only.
    worker.stdout.on('data',(chunk:Buffer)=>{
      if(child!==worker || !current.enabled)return;
      if(!busy || frameOffset+chunk.length>MAX_CAPTURE_BYTES+CAPTURE_HEADER_BYTES){fail();return;}
      try {
        let offset=0;
        if(!header) {
          const take=Math.min(CAPTURE_HEADER_BYTES-headerOffset,chunk.length);
          chunk.copy(headerData,headerOffset,0,take);headerOffset+=take;offset+=take;
          if(headerOffset<CAPTURE_HEADER_BYTES)return;
          if(headerData.toString('ascii',0,4)==='DSHS' && headerData.subarray(4).every(v=>v===0)) {
            if(offset!==chunk.length)throw new Error('Unexpected skip payload');
            clearTimeout(timeout);busy=false;headerOffset=0;return;
          }
          header=decodeCaptureHeader(headerData);
          // One exact-sized scratch frame. Do not retain the largest expanded
          // allocation after returning to a capsule, or allocate it every tick.
          if(pending.length!==header.bytes){pending.fill(0);pending=Buffer.alloc(header.bytes);}
          frameOffset=0;
        }
        const take=chunk.length-offset;
        if(frameOffset+take>header.bytes)throw new Error('Unexpected capture stream');
        chunk.copy(pending,frameOffset,offset);frameOffset+=take;
        if(frameOffset<header.bytes)return;
        clearTimeout(timeout);timeout=undefined;busy=false;
        const {bytes:_,...geometry}=header;void _;
        const projected=projectCaptureFrame({...geometry,pixels:new Uint8Array(pending.buffer,pending.byteOffset,pending.byteLength)},currentBounds());
        // The worker must not deduplicate against a frame Main rejected during
        // a fast move, even if the window immediately returns to that position.
        if(!projected)forceFrame=true;
        if(projected && win.isVisible()) {
          win.webContents.send('glass:optics-frame',projected);
          if(!current.running){current.running=true;publish();}
        }
        // webContents.send serializes synchronously. The renderer owns its IPC
        // snapshot; the local scratch bytes can be scrubbed and reused now.
        if(projected && projected.pixels.buffer!==pending.buffer)projected.pixels.fill(0);
        pending.fill(0);header=undefined;headerOffset=0;frameOffset=0;
      } catch {fail();}
    });
    function request() {
      if(child!==worker || busy || !current.enabled || !win.isVisible() || performance.now()<nextFrame)return;
      const b=screen.dipToScreenRect(win,win.getBounds());const pixels=(b.width+96)*(b.height+96);
      // Cap large-window readback/IPC bandwidth; never promise display FPS.
      nextFrame=performance.now()+(pixels>1000000?125:pixels>500000?67:40);
      busy=true;worker.stdin.write(forceFrame?'frame-force\n':'frame\n');forceFrame=false;
      timeout=setTimeout(()=>{if(child===worker)fail();},1500);
    }
    // A small bounded region; one frame in flight, never queue capture work.
    setTimeout(()=>{if(child===worker)request();},120);
    timer=setInterval(request,16);
  }
  function enable(value:boolean) {
    stopProcess();current={enabled:value,running:false,error:null};
    if(!value)win.setContentProtection(false);
    publish();if(value)start();return state();
  }
  win.on('hide',()=>{stopProcess();publish();});
  win.on('minimize',()=>{stopProcess();publish();});
  win.on('show',start);win.on('restore',start);
  win.on('move',publishPosition);win.on('resize',publishPosition);
  win.on('closed',()=>{stopProcess();current.enabled=false;});
  return {state,enable,refresh:()=>{forceFrame=true;},stop:()=>{stopProcess();current.enabled=false;}};
}
