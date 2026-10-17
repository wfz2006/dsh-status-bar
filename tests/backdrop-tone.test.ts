import {expect,it} from 'vitest';
import {backdropTone} from '../apps/desktop/src/shared/backdrop-tone';
function image(value:number,margin:number) {
 const pixels=new Uint8Array(32*32*4).fill(margin);
 for(let y=8;y<24;y++)for(let x=8;x<24;x++)for(let c=0;c<4;c++)pixels[(y*32+x)*4+c]=c===3?255:value;
 return {pixels,width:32,height:32,left:0,top:0,windowLeft:8,windowTop:8,windowWidth:16,windowHeight:16};
}
it('chooses ink from actual window pixels and excludes unrelated overscan',()=>{
 expect(backdropTone(image(238,0))).toBe('light');
 expect(backdropTone(image(20,255))).toBe('dark');
 expect(backdropTone(image(118,255),'light')).toBe('light');
 expect(backdropTone(image(118,0),'dark')).toBe('dark');
});
it('chooses ink after tint and brightness rather than from the unadjusted desktop',()=>{
 expect(backdropTone(image(238,0),'light',{tintColor:'#000000',tintOpacity:70,brightness:100})).toBe('dark');
 expect(backdropTone(image(20,255),'dark',{tintColor:'#ffffff',tintOpacity:80,brightness:100})).toBe('light');
 expect(backdropTone(image(170,255),'light',{tintColor:'#000000',tintOpacity:0,brightness:50})).toBe('dark');
 expect(backdropTone(image(100,0),'dark',{tintColor:'#000000',tintOpacity:0,brightness:150})).toBe('light');
});
