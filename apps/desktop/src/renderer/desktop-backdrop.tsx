import { useEffect,useRef } from 'react';
import {placeBackdrop,framePixelView,type BackdropPlacement,type DesktopOpticsBounds,type DesktopOpticsFrame} from '../shared/desktop-optics';
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
    let painted:BackdropPlacement|null=null;
    let placement='';
    const surface=canvas.current!;
    const context=surface.getContext('2d');
    const root=surface.closest<HTMLElement>('main');let tone:BackdropTone|undefined;
    const clear=()=>{last=null;painted=null;placement='';tone=undefined;if(root)delete root.dataset.backdropTone;
      // clearRect keeps the bitmap/texture allocated. A stopped or hidden
      // capture has no pixels to display; release that backing store too.
      if(surface.width!==0 || surface.height!==0){surface.width=0;surface.height=0;}
      surface.style.visibility='hidden';delete surface.dataset.frame;delete surface.dataset.coverage;};
    function position(bounds:DesktopOpticsBounds) {
      if(!last){surface.style.visibility='hidden';return;}
      const expanding=root?.dataset.morph==='expanding';
      const viewport={width:window.innerWidth,height:window.innerHeight,scale:window.devicePixelRatio};
      const key=[last.left,last.top,last.width,last.height,bounds.windowLeft,bounds.windowTop,bounds.windowWidth,bounds.windowHeight,viewport.width,viewport.height,viewport.scale,expanding].join(',');
      if(key===placement)return;
      placement=key;
      // A fast drag can outrun the bounded capture. Hold its last complete
      // local crop until a fresh frame arrives instead of flashing the layer
      // off. Resizes still show only valid world-pixel coverage.
      painted=placeBackdrop(last,bounds,viewport,expanding,painted);
      if(!painted){surface.style.visibility='hidden';delete surface.dataset.coverage;return;}
      surface.style.left=painted.left+'%';
      surface.style.top=painted.top+'%';
      surface.style.width=painted.width+'%';
      surface.style.height=painted.height+'%';
      surface.style.visibility='visible';surface.dataset.windowLeft=String(bounds.windowLeft);surface.dataset.coverage=painted.coverage;
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
