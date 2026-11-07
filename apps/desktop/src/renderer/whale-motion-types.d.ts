type WhaleAnimator = {
  options:{mainSize:number;energy:number;pace:number};
  resize(width:number,height:number):void;setStatus(status:string):boolean;play(name:string):boolean;
  setReduced(reduced:boolean):void;setVisible(visible:boolean):void;setAutonomous(enabled:boolean):void;destroy():void;
  setSkin(image:HTMLImageElement|null,bounds:readonly [number,number,number,number]):void;
};
declare const WhaleMotion:{Animator:new(canvas:HTMLCanvasElement,effects:HTMLCanvasElement|null,options:Record<string,unknown>)=>WhaleAnimator};
