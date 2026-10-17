import type {DesktopOpticsFrame} from './desktop-optics';
import {tintChannels,type GlassAppearance} from './glass-appearance';
export type BackdropTone='light'|'dark';
const linear=Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
// Use only existing authorized window pixels, excluding the capture margin.
export function backdropTone(frame:DesktopOpticsFrame,previous?:BackdropTone,appearance?:GlassAppearance):BackdropTone {
  const dx=frame.windowLeft-frame.left,dy=frame.windowTop-frame.top;
  const tint=appearance?tintChannels(appearance.tintColor):[0,0,0];
  const alpha=appearance?appearance.tintOpacity/100:0,brightness=appearance?appearance.brightness/100:1;
  const adjusted=(value:number,channel:number)=>Math.max(0,Math.min(255,Math.round((value*(1-alpha)+tint[channel]!*alpha)*brightness)));
  let sum=0;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
    const px=Math.min(frame.width-1,Math.floor(dx+(x+.5)*frame.windowWidth/8));
    const py=Math.min(frame.height-1,Math.floor(dy+(y+.5)*frame.windowHeight/8));
    const i=(py*frame.width+px)*4;
    sum+=linear[adjusted(frame.pixels[i]!,0)]!*.2126+linear[adjusted(frame.pixels[i+1]!,1)]!*.7152+linear[adjusted(frame.pixels[i+2]!,2)]!*.0722;
  }
  const luminance=sum/64;
  return luminance>(previous==='dark'?.20:previous==='light'?.16:.18)?'light':'dark';
}
