import { describe,expect,it } from 'vitest';
import { decodeCaptureHeader, CAPTURE_HEADER_BYTES,projectCaptureFrame,captureVisibility,framePixelView } from '../apps/desktop/src/shared/desktop-optics';
function header(values:number[]) {const b=Buffer.alloc(CAPTURE_HEADER_BYTES);b.write('DSHG');values.forEach((v,i)=>b.writeInt32LE(v,4+i*4));return b;}
it('reuses received RGBA bytes including a nonzero byte offset without changing pixels',()=>{
  const buffer=Uint8Array.from([99,88,1,2,255,255,6,7,8,255,77]);
  const input=buffer.subarray(2,10);
  const view=framePixelView(input);
  expect(view.buffer).toBe(input.buffer);expect(view.byteOffset).toBe(2);
  expect(Array.from(view)).toEqual([1,2,255,255,6,7,8,255]);
  expect(Array.from(input)).toEqual(Array.from(view));
});
describe('bounded desktop optical input',()=>{
  it('accepts only bounded RGBA frames matching the current native window',()=>{
    const valid=header([80000,200,100,10,10,20,20,180,80]);
    expect(decodeCaptureHeader(valid)).toMatchObject({bytes:80000,width:200,height:100,windowWidth:180});
    expect(()=>decodeCaptureHeader(header([80001,200,100,10,10,20,20,180,80]))).toThrow();
    expect(()=>decodeCaptureHeader(header([80000,200,100,10,10,20,20,800,80]))).toThrow();
    expect(()=>decodeCaptureHeader(header([80000,200,100,10,10,200,20,180,80]))).toThrow();
    expect(()=>decodeCaptureHeader(header([0,0,0,0,0,0,0,0,0]))).toThrow();
    expect(()=>decodeCaptureHeader(header([2147483640,20000,20000,0,0,0,0,180,80]))).toThrow();
  });
});
it('reprojects covered motion to current screen pixels without exposing excess margin',()=>{
  const pixels=Uint8Array.from({length:200*100*4},(_,i)=>Math.floor(i/4)%200);
  const frame={width:200,height:100,left:10,top:10,windowLeft:30,windowTop:30,windowWidth:140,windowHeight:60,pixels};
  const moved=projectCaptureFrame(frame,{windowLeft:60,windowTop:30,windowWidth:140,windowHeight:60});
  expect(moved).not.toBeNull();expect(moved!.windowLeft).toBe(60);
  expect(moved!.left).toBe(12);expect(moved!.pixels[0]).toBe(2);
  expect(moved!.width).toBe(198);
  expect(projectCaptureFrame(frame,{windowLeft:100,windowTop:30,windowWidth:140,windowHeight:60})).toBeNull();
});
it('retains only an expanding intersection while keeping drag coverage strict',()=>{
  const frame={left:10,top:10,width:200,height:100};
  const capsule={windowLeft:30,windowTop:30,windowWidth:140,windowHeight:60};
  expect(captureVisibility(frame,capsule,false)).toBe('full');
  const expanded={...capsule,windowHeight:300};
  expect(captureVisibility(frame,expanded,true)).toBe('intersection');
  expect(captureVisibility(frame,expanded,false)).toBe('hidden');
  expect(captureVisibility(frame,{...expanded,windowLeft:400},true)).toBe('hidden');
  // Expanding does not relax Main's cropping/coverage rule or acquire new pixels.
  expect(projectCaptureFrame({...frame,...capsule,pixels:new Uint8Array(200*100*4)},expanded)).toBeNull();
});
