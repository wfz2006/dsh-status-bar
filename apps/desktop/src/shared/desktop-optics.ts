export type DesktopOpticsState = { enabled:boolean; running:boolean; error:string | null };
export type CaptureHeader = { bytes:number; width:number; height:number; left:number; top:number; windowLeft:number; windowTop:number; windowWidth:number; windowHeight:number };
export type DesktopOpticsFrame = Omit<CaptureHeader,'bytes'> & { pixels:Uint8Array };
export type DesktopOpticsBounds=Pick<CaptureHeader,'windowLeft'|'windowTop'|'windowWidth'|'windowHeight'>;
/** Received pixels already own an ArrayBuffer. Reinterpret bytes, without an RGBA copy. */
export function framePixelView(pixels:Uint8Array):Uint8ClampedArray<ArrayBuffer> {
  return pixels.buffer instanceof ArrayBuffer
    ? new Uint8ClampedArray(pixels.buffer,pixels.byteOffset,pixels.byteLength)
    : new Uint8ClampedArray(pixels);
}
export function captureCoversWindow(frame:Pick<CaptureHeader,'left'|'top'|'width'|'height'>,bounds:DesktopOpticsBounds) {
  return frame.left<=bounds.windowLeft && frame.top<=bounds.windowTop && frame.left+frame.width>=bounds.windowLeft+bounds.windowWidth && frame.top+frame.height>=bounds.windowTop+bounds.windowHeight;
}
export function captureVisibility(frame:Pick<CaptureHeader,'left'|'top'|'width'|'height'>,bounds:DesktopOpticsBounds,expanding:boolean):'full'|'intersection'|'hidden' {
  if(captureCoversWindow(frame,bounds))return 'full';
  const intersects=frame.left<bounds.windowLeft+bounds.windowWidth && frame.left+frame.width>bounds.windowLeft && frame.top<bounds.windowTop+bounds.windowHeight && frame.top+frame.height>bounds.windowTop;
  return expanding && intersects?'intersection':'hidden';
}
export function projectCaptureFrame(frame:DesktopOpticsFrame,bounds:DesktopOpticsBounds):DesktopOpticsFrame|null {
  if(!captureCoversWindow(frame,bounds))return null;
  const left=Math.max(frame.left,bounds.windowLeft-48),top=Math.max(frame.top,bounds.windowTop-48);
  const width=Math.min(frame.left+frame.width,bounds.windowLeft+bounds.windowWidth+48)-left;
  const height=Math.min(frame.top+frame.height,bounds.windowTop+bounds.windowHeight+48)-top;
  if(left===frame.left && top===frame.top && width===frame.width && height===frame.height)return {...frame,...bounds};
  const pixels=new Uint8Array(width*height*4);
  for(let row=0;row<height;row++) {const offset=((top-frame.top+row)*frame.width+left-frame.left)*4;pixels.set(frame.pixels.subarray(offset,offset+width*4),row*width*4);}
  return {...bounds,left,top,width,height,pixels};
}
export const CAPTURE_HEADER_BYTES=40;
export const MAX_CAPTURE_BYTES=24*1024*1024;
export function decodeCaptureHeader(data:Uint8Array):CaptureHeader {
  if(data.byteLength!==CAPTURE_HEADER_BYTES || String.fromCharCode(...data.subarray(0,4))!=='DSHG')throw new Error('Invalid capture header');
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const values=Array.from({length:9},(_,i)=>view.getInt32(4+i*4,true));
  const [bytes,width,height,left,top,windowLeft,windowTop,windowWidth,windowHeight]=values as [number,number,number,number,number,number,number,number,number];
  if(width<=0 || height<=0 || width>4096 || height>4096 || bytes!==width*height*4 || bytes>MAX_CAPTURE_BYTES || windowWidth<=0 || windowHeight<=0 || windowWidth>width || windowHeight>height)throw new Error('Capture outside size budget');
  const dx=windowLeft-left,dy=windowTop-top;
  // At most 48 physical pixels of overscan on each side. No arbitrary ROI API.
  if(dx<0 || dy<0 || dx>48 || dy>48 || width-dx-windowWidth<0 || width-dx-windowWidth>48 || height-dy-windowHeight<0 || height-dy-windowHeight>48)throw new Error('Capture outside window region');
  return {bytes,width,height,left,top,windowLeft,windowTop,windowWidth,windowHeight};
}
