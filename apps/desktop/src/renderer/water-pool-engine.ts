import {vertex,fragment,oceanFragment} from './water-pool-shaders';
export type PoolFrame={width:number;height:number;centerX:number;centerY:number;rx:number;ry:number;headX:number;tailX:number;routeY:number;reveal:number;show:number;time:number;contour:'pearl'|'mirror'|'drop';reduced:boolean};

/** Transparent water only: no desktop image, storage, network or task state. */
export class WaterPoolEngine{
  readonly fallback:boolean;
  private gl:WebGLRenderingContext|null;
  private main:WebGLProgram|null=null;
  private ocean:WebGLProgram|null=null;
  private textures:WebGLTexture[]=[];
  private buffer:WebGLBuffer|null=null;
  private target:WebGLFramebuffer|null=null;
  private locations=new Map<string,WebGLUniformLocation|null>();
  private canvasWidth=0;private canvasHeight=0;
  private heights=new Float32Array(96*72);private velocity=new Float32Array(96*72);
  private pixels=new Uint8Array(96*72*4);
  private pointer:{x:number;y:number;time:number}|null=null;
  private lost=(event:Event)=>{event.preventDefault();this.onFallback(true);};
  private restored=()=>{
    if(!this.gl)return;
    this.textures=[];this.main=null;this.ocean=null;this.buffer=null;this.target=null;this.locations.clear();this.canvasWidth=this.canvasHeight=0;
    try{this.setup();this.onFallback(false);}catch{this.dispose();this.onFallback(true);}
  };
  constructor(private canvas:HTMLCanvasElement,private onFallback:(fallback:boolean)=>void=()=>{}){
    this.gl=canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:true,powerPreference:'low-power'});
    try{if(this.gl)this.setup();}catch{this.dispose();}
    this.fallback=!this.gl;
    canvas.addEventListener('webglcontextlost',this.lost);canvas.addEventListener('webglcontextrestored',this.restored);
  }
  private compile(source:string,type:number){
    const gl=this.gl!;const shader=gl.createShader(type);if(!shader)throw new Error('Water shader unavailable');
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw new Error('Water shader failed');}return shader;
  }
  private program(source:string){
    const gl=this.gl!,vs=this.compile(vertex,gl.VERTEX_SHADER),fs=this.compile(source,gl.FRAGMENT_SHADER),program=gl.createProgram();
    if(!program)throw new Error('Water program unavailable');
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.bindAttribLocation(program,0,'a_position');gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);throw new Error('Water program failed');}return program;
  }
  private location(program:WebGLProgram,name:string){
    const key=(program===this.main?'main:':'ocean:')+name;
    if(!this.locations.has(key))this.locations.set(key,this.gl!.getUniformLocation(program,'u_'+name));
    return this.locations.get(key)??null;
  }
  private setup(){
    const gl=this.gl!;this.main=this.program(fragment);this.ocean=this.program(oceanFragment);
    this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    for(let i=0;i<3;i++){
      const texture=gl.createTexture();if(!texture)throw new Error('Water texture unavailable');this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(i===0?[23,43,65,255]:[128,128,128,255]));
    }
    this.target=gl.createFramebuffer();
    gl.useProgram(this.main);gl.uniform1i(this.location(this.main!,'bg'),2);gl.uniform1i(this.location(this.main!,'wake'),1);gl.uniform1i(this.location(this.main!,'backdrop'),2);
    gl.useProgram(this.ocean);gl.uniform1i(this.location(this.ocean!,'base'),0);
  }
  pointerMove(x:number,y:number,width:number,height:number){
    const now=performance.now(),old=this.pointer;
    const start=old&&now-old.time<120?old:{x,y};
    const steps=Math.max(1,Math.ceil(Math.hypot(x-start.x,y-start.y)/4));
    for(let i=0;i<=steps;i++){
      const gx=Math.round((start.x+(x-start.x)*i/steps)/width*95),gy=Math.round((start.y+(y-start.y)*i/steps)/height*71);
      for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
        const px=gx+ox,py=gy+oy;if(px>0&&px<95&&py>0&&py<71)this.heights[py*96+px]!+=Math.exp(-(ox*ox+oy*oy)/2)*.16;
      }
    }
    this.pointer={x,y,time:now};
  }
  pointerLeave(){this.pointer=null;}
  private updateWake(reduced:boolean){
    if(reduced){this.heights.fill(0);this.velocity.fill(0);}
    else{
      for(let y=1;y<71;y++)for(let x=1;x<95;x++){
        const i=y*96+x;
        const lap=this.heights[i-1]!+this.heights[i+1]!+this.heights[i-96]!+this.heights[i+96]!-4*this.heights[i]!;
        this.velocity[i]=(this.velocity[i]!+lap*.18)*.94;
      }
      for(let i=0;i<this.heights.length;i++)this.heights[i]=Math.max(-2,Math.min(2,(this.heights[i]!+this.velocity[i]!)*.995));
    }
    for(let y=0;y<72;y++)for(let x=0;x<96;x++){
      const i=y*96+x,h=this.heights[i]!,dx=this.heights[y*96+Math.min(95,x+1)]!-this.heights[y*96+Math.max(0,x-1)]!,dy=this.heights[Math.min(71,y+1)*96+x]!-this.heights[Math.max(0,y-1)*96+x]!;
      this.pixels[i*4]=Math.max(0,Math.min(255,128+dx*36));this.pixels[i*4+1]=Math.max(0,Math.min(255,128+dy*36));this.pixels[i*4+2]=Math.max(0,Math.min(255,128+h*24));this.pixels[i*4+3]=255;
    }
  }
  draw(frame:PoolFrame){
    const gl=this.gl,main=this.main,ocean=this.ocean;if(!gl||!main||!ocean||gl.isContextLost())return;
    const dpr=Math.min(devicePixelRatio||1,1.75),w=Math.max(1,Math.round(frame.width*dpr)),h=Math.max(1,Math.round(frame.height*dpr));
    if(this.canvasWidth!==w||this.canvasHeight!==h){
      this.canvasWidth=this.canvas.width=w;this.canvasHeight=this.canvas.height=h;
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.textures[2]!);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,Math.min(512,w),Math.max(1,Math.round(h*Math.min(512,w)/w)),0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    }
    this.updateWake(frame.reduced);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]!);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,96,72,0,gl.RGBA,gl.UNSIGNED_BYTE,this.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.textures[2]!,0);
    const ow=Math.min(512,w),oh=Math.max(1,Math.round(h*ow/w));gl.viewport(0,0,ow,oh);gl.useProgram(ocean);
    gl.uniform2f(this.location(ocean,'resolution'),ow,oh);gl.uniform2f(this.location(ocean,'scene'),frame.width,frame.height);gl.uniform2f(this.location(ocean,'center'),frame.centerX,frame.centerY);
    gl.uniform1f(this.location(ocean,'time'),frame.reduced?0:frame.time);gl.uniform1f(this.location(ocean,'strength'),.75);gl.uniform1f(this.location(ocean,'dark'),1);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.textures[0]!);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);gl.useProgram(main);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const scalar:Record<string,number>={phase:frame.time*1.5,energy:0,bubble:0,clarity:.94,dark:1,scale:dpr,corner:82,shape:frame.contour==='mirror'?1:frame.contour==='drop'?2:0,taper:frame.contour==='drop'?.115:0,companion:1,reveal:frame.reveal,show:frame.show};
    for(const [key,value]of Object.entries(scalar))gl.uniform1f(this.location(main,key),value);
    for(const [key,value]of Object.entries({size:[w,h],center:[frame.centerX*dpr,frame.centerY*dpr],radius:[frame.rx*dpr,frame.ry*dpr],flow:[0,0],bead:[-1000,-1000]}))gl.uniform2f(this.location(main,key),value[0]!,value[1]!);
    gl.uniform3f(this.location(main,'route'),frame.headX*dpr,frame.tailX*dpr,frame.routeY*dpr);
    gl.uniform4f(this.location(main,'ripple'),-1000,-1000,10,0);gl.uniform4f(this.location(main,'ripple2'),-1000,-1000,10,0);gl.drawArrays(gl.TRIANGLES,0,6);
  }
  dispose(){
    this.canvas.removeEventListener('webglcontextlost',this.lost);this.canvas.removeEventListener('webglcontextrestored',this.restored);
    const gl=this.gl;if(!gl)return;
    for(const texture of this.textures)gl.deleteTexture(texture);this.textures=[];
    if(this.main)gl.deleteProgram(this.main);if(this.ocean)gl.deleteProgram(this.ocean);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.target)gl.deleteFramebuffer(this.target);
    this.gl=null;
  }
}
