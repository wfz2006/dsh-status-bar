import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {GlassSettings,GlassViewMode} from '../shared/view-model';
import type {Task} from './task-views';
import {poolScene,PoolScenePlayer,type PoolSceneFacts} from './pool-scene';
import {WaterPoolEngine} from './water-pool-engine';
import {PoolDragMotion} from './pool-drag-motion';
import type {DragPaint} from './drag-motion';
import {WHALE_SKIN_BOUNDS,loadWhaleSkin} from './whale-skin-art';
import {samplePoolClosing,samplePoolOpening,smooth,type PoolPoint,type PoolSize,type PoolWhalePose} from './pool-whale-flight';
import type {PresentationState} from '../shared/api';
import './vendor/whale-motion.js';

type WhaleVisualPose=PoolWhalePose&{size:number};
type ClosingFlight={kind:'closing';start:number;from:WhaleVisualPose;viewport:PoolSize};
type Flight =
  | {kind:'opening';start:number;screenPose:WhaleVisualPose;route?:{start:number;from:WhaleVisualPose;to:PoolPoint&{size:number}}}
  | {kind:'berth';start:number;from:WhaleVisualPose;viewport:PoolSize}
  | ClosingFlight;
const ROUTE_Y = 70;
const REST_SIZE = 76;

function placeWhale(target:HTMLButtonElement|null,x:number,y:number,viewport?:PoolSize){
  if(!target)return;
  // Percentage anchors update with the viewport layout, before the next
  // animation or resize observer callback can paint the closing whale.
  target.style.left=viewport?`${x/Math.max(1,viewport.width)*100}%`:'';
  target.style.top=viewport?`${y/Math.max(1,viewport.height)*100}%`:'';
  target.style.transform=viewport?'translate(-48px,-48px)':`translate(${x-48}px,${y-48}px)`;
}

export function WhalePool({task,scene,mode,morphing,settings,visible,settleDrag,expand,details,approval,menu,reconnect,openDSH}:{task:Task;scene:PoolSceneFacts;mode:GlassViewMode;morphing:PresentationState['morphing'];settings:GlassSettings;visible:boolean;settleDrag:()=>Promise<void>|undefined;expand:()=>Promise<void>;details:()=>void;approval:()=>void;menu:()=>void;reconnect:()=>void;openDSH:()=>void}){
  const host=useRef<HTMLDivElement>(null),waterCanvas=useRef<HTMLCanvasElement>(null),whaleCanvas=useRef<HTMLCanvasElement>(null),effects=useRef<HTMLCanvasElement>(null),whaleTarget=useRef<HTMLButtonElement>(null),whaleLane=useRef<HTMLDivElement>(null);
  const panelMode=mode==='expanded'||mode==='approval',posture=poolScene(task.status,scene);
  const params=useRef({mode,morphing,settings,visible,task,scene,posture});params.current={mode,morphing,settings,visible,task,scene,posture};
  const wake=useRef<()=>void>(()=>{}),engine=useRef<WaterPoolEngine|null>(null);
  const resetWaterDrag=useRef<()=>void>(()=>{});
  const syncScene=useRef<()=>void>(()=>{});
  const whaleAnimator=useRef<WhaleAnimator|null>(null);
  const lastMode=useRef(mode),transition=useRef<Flight|null>(null);
  const pendingOpen=useRef<{pose:WhaleVisualPose;expires:number}|null>(null);
  const openingClick=useRef(false);
  const detailsTarget=useRef<HTMLButtonElement>(null);
  const openFocus=useRef<'details'|'pool'|null>(null),focusOnReturn=useRef(false);
  const position=useRef({
    local:{x:165,y:ROUTE_Y,yaw:0,size:REST_SIZE},
    screen:{x:window.screenX+165,y:window.screenY+ROUTE_Y,yaw:0,size:REST_SIZE},
    viewport:{width:window.innerWidth,height:window.innerHeight},
  });
  const lastReady=useRef(mode!=='capsule');
  const [ready,setReady]=useState(lastReady.current),[fallback,setFallback]=useState(false);
  useEffect(()=>{
    const element=host.current,canvas=waterCanvas.current,actor=whaleCanvas.current,fx=effects.current,lane=whaleLane.current;
    if(!element||!canvas||!actor||!fx||!lane)return;
    let useFallback=false;
    const water=new WaterPoolEngine(canvas,value=>{useFallback=value;setFallback(value);wake.current();});
    engine.current=water;useFallback=water.fallback;setFallback(useFallback);
    const animator=new WhaleMotion.Animator(actor,fx,{showNative:false,travel:false,mainSize:REST_SIZE,energy:.85,pace:1,color:'#86acff',
      onChange:(clip:string,reason:string)=>{
        element.dataset.poolClip=clip;
        if(reason==='cue')element.dataset.poolCue=clip==='happy'?'completed':clip==='nod'?'typing':'other-request';
        else delete element.dataset.poolCue;
      },
    });
    animator.resize(150,160);animator.setAutonomous(false);
    whaleAnimator.current=animator;
    const player=new PoolScenePlayer(),media=matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0,last=0,lastWater=0,autonomous=false,disposed=false;
    const dragMotion=new PoolDragMotion();
    let hasDrag=false,moving=false,activeSlosh=false,paintedFallback=false;
    function closingPose(flight:ClosingFlight,width:number,height:number,now:number) {
      const {progress,...pose}=samplePoolClosing(flight.from,flight.viewport,{width,height},{x:width*.75,y:ROUTE_Y},(now-flight.start)/1000);
      return {progress,pose:{...pose,size:flight.from.size+(REST_SIZE-flight.from.size)*progress}};
    }
    function showPose(pose:WhaleVisualPose,width:number,height:number,relative=false) {
      const viewport={width,height};
      position.current={local:pose,screen:{...pose,x:window.screenX+pose.x,y:window.screenY+pose.y},viewport};
      placeWhale(whaleTarget.current,pose.x,pose.y,relative?viewport:undefined);
      animator.options.heading=pose.yaw;
      animator.options.mainSize=pose.size;
    }
    const clearFallback=()=>{
      if(!paintedFallback)return;
      element.style.removeProperty('--pool-slosh-x');
      element.style.removeProperty('--pool-slosh-y');
      paintedFallback=false;
    };
    const clearSlosh=()=>{
      if(!hasDrag)return;
      hasDrag=moving=activeSlosh=false;
      dragMotion.reset();
      clearFallback();
    };
    resetWaterDrag.current=clearSlosh;
    const sync=()=>{
      const {mode,settings,visible,task,scene,posture}=params.current;
      const shown=visible&&!document.hidden,reduced=media.matches||settings.animation!=='full';
      animator.setVisible(shown);animator.setReduced(reduced);
      player.update(animator,{scene:posture,scope:scene.scope,session:task.session?.sessionId,animate:shown&&!reduced,
        answering:mode==='approval',otherPending:scene.otherPending},scene.cue);
      if(!shown||reduced){
        transition.current=null;pendingOpen.current=null;
        animator.setPointer(0,0,false);clearSlosh();
        if(!shown){cancelAnimationFrame(frame);frame=0;}
      }
    };
    syncScene.current=sync;
    const run=(now:number)=>{
      frame=0;if(disposed)return;
      const {mode,morphing,settings,visible,posture}=params.current;
      if(!visible||document.hidden){clearSlosh();animator.setVisible(false);return;}
      const traveling=!!transition.current||!!pendingOpen.current;
      if(!traveling&&now-last<(activeSlosh?12:30)){frame=requestAnimationFrame(run);return;}last=now;
      const reduced=media.matches||settings.animation!=='full';
      const width=element.clientWidth,height=element.clientHeight;
      const laneWidth=lane.offsetWidth;
      const dock={x:lane.offsetLeft+laneWidth/2,y:Math.round(lane.offsetHeight*.59),size:Math.round(laneWidth*.56)};
      const idleX=width*.75;
      const screenX=window.screenX,screenY=window.screenY;
      let show=mode==='capsule'?0:1,reveal=show;
      let pose:WhaleVisualPose={...(mode==='capsule'?{x:idleX,y:ROUTE_Y,size:REST_SIZE}:dock),yaw:0};
      let tail:PoolPoint=pose;
      const flight=transition.current;
      if(pendingOpen.current&&(reduced||now>=pendingOpen.current.expires))pendingOpen.current=null;
      if(flight&&!reduced){
        const age=(now-flight.start)/1000;
        if(flight.kind==='opening'){
          // Keep the whale still as the window grows or is pushed inward by a screen edge.
          // The final window position determines the real direction, even for the same layout.
          const from={...flight.screenPose,x:flight.screenPose.x-screenX,y:flight.screenPose.y-screenY};
          if(!flight.route&&!morphing&&age>=0.05)flight.route={start:now,from,to:dock};
          const route=flight.route;
          if(route){
            const sample=samplePoolOpening(route.from,route.to,(now-route.start)/1000);
            pose={...sample,size:route.from.size+(route.to.size-route.from.size)*sample.swim};
            reveal=sample.reveal;tail=route.from;
            show=Math.max(reveal,smooth(Math.hypot(pose.x-tail.x,pose.y-tail.y)/12));
            if(sample.settled){transition.current=null;pose={...dock,yaw:0};}
          }else{
            pose=from;tail=from;show=0;reveal=0;
          }
        }else if(flight.kind==='closing'){
          const closing=closingPose(flight,width,height,now);
          const {progress}=closing;
          pose=closing.pose;
          show=1-progress;reveal=1;
          if(progress>=1)transition.current=null;
        }else{
          const progress=smooth(age/.36),from=flight.from;
          const x=from.x*width/Math.max(1,flight.viewport.width),y=from.y*height/Math.max(1,flight.viewport.height);
          pose={x:x+(dock.x-x)*progress,y:y+(dock.y-y)*progress,yaw:from.yaw*(1-progress),size:from.size+(dock.size-from.size)*progress};
          if(progress>=1)transition.current=null;
        }
      }else if(flight)transition.current=null;
      else if(pendingOpen.current){
        const anchor=pendingOpen.current.pose;
        pose={...anchor,x:anchor.x-screenX,y:anchor.y-screenY};
      }
      const readable=mode!=='capsule'&&!morphing&&(!transition.current||transition.current.kind==='berth'||transition.current.kind==='opening'&&reveal>=.98);
      if(readable!==lastReady.current){lastReady.current=readable;setReady(readable);}
      element.dataset.transition=transition.current?.kind??'idle';
      if(!readable||reduced)clearSlosh();
      const drag=hasDrag?dragMotion.sample(now):undefined;
      if(drag){
        activeSlosh=drag.energy>.02||drag.rippleStrength>.02;
        if(!moving&&!drag.energy&&!drag.rippleStrength)clearSlosh();
      }
      if(useFallback&&activeSlosh&&drag){
        element.style.setProperty('--pool-slosh-x',(drag.sloshX*34).toFixed(2)+'px');
        element.style.setProperty('--pool-slosh-y',(drag.sloshY*24).toFixed(2)+'px');
        paintedFallback=true;
      }else clearFallback();
      // Place the traveling whale on every display frame while bounding water shader work.
      if(!traveling||!transition.current||reduced||now-lastWater>=14){
        water.draw({width,height,centerX:width/2,centerY:height/2,rx:Math.max(24,width/2-9),ry:Math.max(24,height/2-9),headX:pose.x,headY:pose.y,tailX:tail.x,tailY:tail.y,reveal,show,time:now/1000,contour:settings.poolContour,reduced,drag});
        lastWater=now;
      }
      showPose(pose,width,height,flight?.kind==='closing'&&!reduced);
      const nextAutonomous=!reduced&&mode==='capsule'&&!transition.current&&posture.base==='idle';
      if(nextAutonomous!==autonomous){autonomous=nextAutonomous;animator.setAutonomous(autonomous);}
      if(reduced)animator.render();
      if(!reduced||transition.current)frame=requestAnimationFrame(run);
    };
    const start=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(run);};wake.current=start;
    const dragRoot=element.closest<HTMLElement>('main.glass');
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&params.current.mode!=='capsule')focusOnReturn.current=true;
      if(event.key==='Tab')openFocus.current=null;
    };
    const onDrag=(event:Event)=>{
      const {mode,morphing,settings,visible}=params.current;
      if(!visible||document.hidden||mode==='capsule'||morphing||transition.current||settings.animation!=='full'||media.matches){
        clearSlosh();
        return;
      }
      const paint=(event as CustomEvent<DragPaint>).detail;
      moving=paint?.phase==='moving';
      if(moving){hasDrag=true;activeSlosh=true;}
      if(hasDrag){dragMotion.set(paint,performance.now());start();}
    };
    const preference=()=>{sync();if(params.current.visible&&!document.hidden)start();};
    const observer=new ResizeObserver(()=>{
      const flight=transition.current;
      // Apply native move compensation before paint, independent of the water frame rate.
      const anchor=flight?.kind==='opening'&&!flight.route?flight.screenPose:pendingOpen.current?.pose;
      if(!media.matches&&params.current.settings.animation==='full'){
        if(anchor)placeWhale(whaleTarget.current,anchor.x-window.screenX,anchor.y-window.screenY);
        else if(flight?.kind==='closing') {
          const {clientWidth:width,clientHeight:height}=element;
          showPose(closingPose(flight,width,height,performance.now()).pose,width,height,true);
        }
      }
      start();
    });
    observer.observe(element);observer.observe(lane);dragRoot?.addEventListener('glass:drag-motion',onDrag);
    document.addEventListener('keydown',onKeyDown);
    media.addEventListener('change',preference);document.addEventListener('visibilitychange',preference);sync();start();
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();dragRoot?.removeEventListener('glass:drag-motion',onDrag);document.removeEventListener('keydown',onKeyDown);media.removeEventListener('change',preference);document.removeEventListener('visibilitychange',preference);clearSlosh();animator.destroy();water.dispose();whaleAnimator.current=null;engine.current=null;wake.current=()=>{};resetWaterDrag.current=()=>{};syncScene.current=()=>{};};
  },[]);
  useEffect(()=>{
    const animator=whaleAnimator.current;
    if(!animator)return;
    if(settings.whaleSkin==='classic'){animator.setSkin(null,WHALE_SKIN_BOUNDS);return;}
    let active=true;
    void loadWhaleSkin(settings.whaleSkin).then(([image,coat])=>{
      if(active)animator.setSkin(image,WHALE_SKIN_BOUNDS,coat);
    },()=>{if(active)animator.setSkin(null,WHALE_SKIN_BOUNDS);});
    return()=>{active=false;};
  },[settings.whaleSkin]);
  useLayoutEffect(()=>{
    if(!visible||mode==='capsule'||morphing||settings.animation!=='full')resetWaterDrag.current();
    if(lastMode.current!==mode){
      const start=performance.now();
      transition.current=mode==='capsule'
        ? {kind:'closing',start,from:position.current.local,viewport:position.current.viewport}
        : mode==='peek'&&lastMode.current==='capsule'
          ? {kind:'opening',start,screenPose:pendingOpen.current?.pose??position.current.screen}
          : {kind:'berth',start,from:position.current.local,viewport:position.current.viewport};
      pendingOpen.current=null;
      if(settings.animation==='full'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        if(transition.current.kind==='opening'){
          const anchor=transition.current.screenPose;
          placeWhale(whaleTarget.current,anchor.x-window.screenX,anchor.y-window.screenY);
        }else{
          const {from,viewport}=transition.current;
          placeWhale(whaleTarget.current,from.x,from.y,viewport);
        }
      }
      lastMode.current=mode;
      if(mode!=='peek')openFocus.current=null;
      if(mode==='capsule'){
        if(lastReady.current){lastReady.current=false;setReady(false);}
      }
    }
    syncScene.current();
    if(visible&&!document.hidden)wake.current();
  },[mode,morphing,settings.animation,settings.poolContour,settings.poolLayout,visible,task.session?.sessionId,
    posture.name,posture.base,posture.reaction,scene.scope,scene.otherPending,scene.viewedRequest?.kind,scene.viewedRequest?.key,scene.cue?.id]);
  const readable=ready&&mode!=='capsule'&&!morphing;
  useLayoutEffect(()=>{
    if(mode==='peek'&&readable&&openFocus.current){
      const target=openFocus.current==='details'?detailsTarget.current:host.current;
      openFocus.current=null;
      if(document.activeElement===document.body||document.activeElement===whaleTarget.current)target?.focus({preventScroll:true});
    }
    if(mode==='capsule'&&!morphing&&focusOnReturn.current){
      focusOnReturn.current=false;
      whaleTarget.current?.focus({preventScroll:true});
    }
  },[readable,mode,morphing]);
  const openWhale=async(fromKeyboard:boolean)=>{
    if(openingClick.current)return;
    openingClick.current=true;
    try{
      const drop=settleDrag();
      if(drop)await drop;
      const current=params.current;
      if(!host.current||!current.visible||current.mode!=='capsule')return;
      openFocus.current=fromKeyboard?'details':'pool';
      if(current.settings.animation==='full'&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
        const pose=position.current.local;
        pendingOpen.current={pose:{...pose,x:window.screenX+pose.x,y:window.screenY+pose.y},expires:performance.now()+750};
      }
      await expand();
    }finally{
      openingClick.current=false;
    }
  };
  const activeIndex=task.todos.findIndex(todo=>todo.status==='in_progress'),start=Math.max(0,(activeIndex<0?0:activeIndex)-1),todos=task.todos.slice(start,start+3);
  return <div ref={host} className="pool-view" tabIndex={-1} data-layout={settings.poolLayout} data-contour={settings.poolContour} data-fallback={fallback}
    data-readable={readable} data-idle={mode==='capsule'} data-panel-mode={panelMode} data-pool-scene={posture.name} data-pool-reaction={posture.reaction??'none'} data-other-pending={scene.otherPending}
    onPointerMove={event=>{
      if(settings.animation!=='full'||event.buttons&1||event.pointerType==='touch'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      const rect=event.currentTarget.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
      engine.current?.pointerMove(x,y,rect.width,rect.height);
      const pose=position.current.local,dx=x-pose.x,dy=y-pose.y;
      whaleAnimator.current?.setPointer(dx/52,dy/52,Math.hypot(dx,dy)<74);
    }} onPointerLeave={()=>{engine.current?.pointerLeave();whaleAnimator.current?.setPointer(0,0,false);}}>
    <canvas ref={waterCanvas} className="pool-water" aria-hidden="true"/>
    <div className="pool-whale-layer">
      <div ref={whaleLane} className="pool-whale-lane" aria-hidden="true" />
      <button ref={whaleTarget} className="pool-whale-target task-capsule" onClick={event=>void openWhale(event.detail===0)} aria-label={mode==='capsule'?`小鲸鱼，${task.label}，点击展开水池`:'小鲸鱼'} aria-expanded={mode!=='capsule'} aria-disabled={mode!=='capsule'} tabIndex={mode==='capsule'?0:-1} disabled={readable}>
        <canvas ref={whaleCanvas} className="pool-whale-art" aria-hidden="true"/><canvas ref={effects} className="pool-whale-effects" aria-hidden="true"/>
      </button>
    </div>
    {mode==='capsule'&&<button className="pool-idle-menu" aria-label="鲸鱼水池菜单" title="鲸鱼水池菜单" onClick={menu}>···</button>}
    {mode==='capsule'&&task.attentionCount>0&&<button className="pool-attention" onClick={approval} aria-label={`${task.attentionCount} 项操作需要确认`}>{task.attentionCount}</button>}
    {!panelMode&&<section className="pool-sheet" aria-hidden={!readable} inert={!readable}>
      <header className="pool-heading"><div><h1 title={task.title}>{task.title}</h1><p>{task.label}</p></div></header>
      <div className="pool-content">
        {task.total>0?<>
          <div className="pool-progress-label"><span>已完成步骤</span><span>{task.completed}<small> / {task.total}</small></span></div>
          <ol className="pool-steps">{todos.map((todo,index)=>
            <li key={start+index} data-todo-status={todo.status} aria-current={todo.status==='in_progress'?'step':undefined}>
              <span className="pool-step-mark" aria-hidden="true">{settings.poolLayout==='letter'?String(start+index+1).padStart(2,'0'):todo.status==='completed'?'✓':todo.status==='in_progress'?'·':'○'}</span>
              <span title={todo.content}>{todo.content}</span>
              <small>{todo.status==='completed'?'已完成':todo.status==='in_progress'?'进行中':'等待'}</small>
            </li>)}</ol>
        </>:<p className="pool-empty">{task.status==='disconnected'?'连接恢复后，将在这里显示任务进展。':task.session?'当前任务暂无步骤，可打开详情查看过程。':'开始一个任务，小鲸鱼就会陪你工作。'}</p>}
      </div>
      <div className="pool-actions"><button className="pool-details" ref={detailsTarget} onClick={details}>任务详情{task.total>3?` · ${task.total} 步`:''}</button>{task.attentionCount>0&&<button onClick={approval}>{task.attentionCount} 项待处理</button>}{task.status==='disconnected'&&<button onClick={reconnect}>重新连接</button>}{task.status==='error'&&<button onClick={openDSH}>打开 DSH</button>}</div>
    </section>}
  </div>;
}
