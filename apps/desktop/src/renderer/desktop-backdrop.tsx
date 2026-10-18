import { useEffect,useRef } from 'react';
import {captureVisibility,framePixelView,type DesktopOpticsBounds,type DesktopOpticsFrame} from '../shared/desktop-optics';
import {backdropTone,type BackdropTone} from '../shared/backdrop-tone';
import type {GlassAppearance} from '../shared/glass-appearance';
export function DesktopBackdrop({paused,autoTheme,appearance}:{paused:boolean;autoTheme:boolean;appearance:GlassAppearance}) {
  const canvas=useRef<HTMLCanvasElement>(null);
  const currentAppearance=useRef(appearance);
  // Do not tear down the capture subscription while a user scrubs a slider.
  useEffect(()=>{currentAppearance.current=appearance;},[appearance]);
  useEffect(()=>{
    let enabled=false;
    let last:Pick<DesktopOpticsFrame,'left'|'top'|'width'|'height'>|null=null;
    let placement='';
    const surface=canvas.current!;
    const context=surface.getContext('2d');
    const root=surface.closest<HTMLElement>('main');let tone:BackdropTone|undefined;
    const clear=()=>{last=null;placement='';tone=undefined;if(root)delete root.dataset.backdropTone;context?.clearRect(0,0,surface.width,surface.height);surface.style.visibility='hidden';delete surface.dataset.frame;delete surface.dataset.coverage;};
    function position(bounds:DesktopOpticsBounds) {
      if(!last){surface.style.visibility='hidden';return;}
      const expanding=root?.dataset.morph==='expanding';
      const key=[last.left,last.top,last.width,last.height,bounds.windowLeft,bounds.windowTop,bounds.windowWidth,bounds.windowHeight,expanding].join(',');
      if(key===placement)return;
      placement=key;
      // During expansion, retain only the existing world-pixel intersection.
      // Never stretch a capsule snapshot, pre-capture the destination, or use
      // this exception for dragging. The parent clips all uncovered pixels.
      const visibility=captureVisibility(last,bounds,expanding);
      if(visibility==='hidden'){surface.style.visibility='hidden';delete surface.dataset.coverage;return;}
      surface.style.left=-(bounds.windowLeft-last.left)/bounds.windowWidth*100+'%';
      surface.style.top=-(bounds.windowTop-last.top)/bounds.windowHeight*100+'%';
      surface.style.width=last.width/bounds.windowWidth*100+'%';
      surface.style.height=last.height/bounds.windowHeight*100+'%';
      surface.style.visibility='visible';surface.dataset.windowLeft=String(bounds.windowLeft);surface.dataset.coverage=visibility;
    }
    const offPosition=window.glass.subscribeOpticsPosition(position);
    const update=(state:{enabled:boolean;running:boolean})=>{enabled=state.enabled;if(!state.enabled || !state.running)clear();};
    const offState=window.glass.subscribeOpticsState(update);
    void window.glass.getOpticsState().then(update);
    const offFrame=window.glass.subscribeOpticsFrame(frame=>{
      if(!enabled || paused)return;
      if(surface.width!==frame.width || surface.height!==frame.height){surface.width=frame.width;surface.height=frame.height;}
      if(!context)return;
      context.putImageData(new ImageData(framePixelView(frame.pixels),frame.width,frame.height),0,0);
      if(autoTheme && root){const next=backdropTone(frame,tone,currentAppearance.current);if(next!==tone){root.dataset.backdropTone=next;tone=next;}}
      last={left:frame.left,top:frame.top,width:frame.width,height:frame.height};position(frame);surface.dataset.frame=String(Date.now());
    });
    return ()=>{enabled=false;offState();offFrame();offPosition();clear();};
  },[paused,autoTheme]);
  return <canvas ref={canvas} className="desktop-backdrop" aria-hidden="true" style={{visibility:'hidden'}} />;
}
