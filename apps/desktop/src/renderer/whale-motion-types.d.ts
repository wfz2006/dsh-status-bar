type WhaleAnimator = {
  readonly action:string;
  options:{mainSize:number;energy:number;pace:number;heading:number};
  resize(width:number,height:number):void;setBase(name:string,snap?:boolean):boolean;play(name:string,reason?:string):boolean;render():void;
  setReduced(reduced:boolean):void;setVisible(visible:boolean):void;setAutonomous(enabled:boolean):void;destroy():void;
  setPointer(x:number,y:number,active:boolean):void;
  setSkin(image:HTMLImageElement|null,bounds:readonly [number,number,number,number],coat?:HTMLCanvasElement|null):void;
};
declare const WhaleMotion:{
  Animator:new(canvas:HTMLCanvasElement,effects:HTMLCanvasElement|null,options:Record<string,unknown>)=>WhaleAnimator;
  clips:Record<string,{label:string;duration:number;loop:boolean}>;
  sample(name:string,progress:number,travel?:number):{x:number;y:number;roll:number;yaw:number;sx:number;sy:number;fin:number;tail:number;rate:number;eye:number;bob:number};
};
