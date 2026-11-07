import {useEffect,useRef,useState} from 'react';
import type {GlassSettings,GlassViewMode} from '../shared/view-model';
import type {Task} from './task-views';
import {WaterPoolEngine} from './water-pool-engine';
import {WHALE_SKIN_BOUNDS,whaleSkinSources} from './whale-skin-art';
import './vendor/whale-motion.js';

const smooth=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
const whaleStatus=(status:string)=>status==='completed'?'completed':status==='running'||status==='starting'?'working':status.startsWith('waiting')?'waiting':status==='disconnected'?'resting':'idle';

export function WhalePool({task,mode,settings,visible,expand,details,approval,menu,reconnect}:{task:Task;mode:GlassViewMode;settings:GlassSettings;visible:boolean;expand:()=>void;details:()=>void;approval:()=>void;menu:()=>void;reconnect:()=>void}){
  const host=useRef<HTMLDivElement>(null),waterCanvas=useRef<HTMLCanvasElement>(null),whaleCanvas=useRef<HTMLCanvasElement>(null),effects=useRef<HTMLCanvasElement>(null),whaleTarget=useRef<HTMLButtonElement>(null);
  const params=useRef({mode,settings,visible,task});params.current={mode,settings,visible,task};
  const wake=useRef<()=>void>(()=>{}),engine=useRef<WaterPoolEngine|null>(null);
  const whaleAnimator=useRef<WhaleAnimator|null>(null);
  const lastMode=useRef(mode),transition=useRef<{kind:'opening'|'closing';start:number;fromX:number}|null>(null),position=useRef({x:165,y:70});
  const [ready,setReady]=useState(mode!=='capsule'),[fallback,setFallback]=useState(false);
  useEffect(()=>{
    const element=host.current,canvas=waterCanvas.current,actor=whaleCanvas.current,fx=effects.current;
    if(!element||!canvas||!actor||!fx)return;
    const water=new WaterPoolEngine(canvas,value=>{setFallback(value);wake.current();});engine.current=water;setFallback(water.fallback);
    const animator=new WhaleMotion.Animator(actor,fx,{showNative:false,travel:false,mainSize:64,energy:.85,pace:1,color:'#86acff'});animator.resize(150,160);animator.setAutonomous(false);
    whaleAnimator.current=animator;
    const media=matchMedia('(prefers-reduced-motion: reduce)');let frame=0,last=0,lastStatus='',wasReady=false,disposed=false;
    const run=(now:number)=>{
      frame=0;if(disposed)return;
      const {mode,settings,visible,task}=params.current;
      if(!visible||document.hidden){animator.setVisible(false);return;}
      if(now-last<30){frame=requestAnimationFrame(run);return;}last=now;
      const reduced=media.matches||settings.animation!=='full';animator.setReduced(reduced);
      const width=element.clientWidth,height=element.clientHeight;
      const dockX=settings.poolLayout==='stream'?width-112:settings.poolLayout==='letter'?width/2:112;
      const idleX=width*.75;
      let show=mode==='capsule'?0:1,reveal=show,x=mode==='capsule'?idleX:dockX;
      const flight=transition.current;
      if(flight&&!reduced){
        const age=(now-flight.start)/1000;
        if(flight.kind==='opening'){
          x=flight.fromX+(dockX-flight.fromX)*smooth(age/1.2);show=1;reveal=smooth((age-.5)/1.65);
          if(age>=2.15)transition.current=null;
        }else{
          const progress=smooth(age/.36);x=flight.fromX+(idleX-flight.fromX)*progress;show=1-progress;reveal=1;
          if(progress>=1)transition.current=null;
        }
      }else if(flight)transition.current=null;
      position.current={x,y:70};
      const readable=mode!=='capsule'&&reveal>.96;
      if(readable!==wasReady){wasReady=readable;setReady(readable);if(readable&&document.activeElement===whaleTarget.current)element.querySelector<HTMLButtonElement>('.pool-details')?.focus({preventScroll:true});}
      element.dataset.transition=transition.current?.kind??'idle';
      water.draw({width,height,centerX:width/2,centerY:height/2,rx:Math.max(24,width/2-9),ry:Math.max(24,height/2-9),headX:x,tailX:flight?.fromX??x,routeY:70,reveal,show,time:now/1000,contour:settings.poolContour,reduced});
      const target=whaleTarget.current;if(target)target.style.transform=`translate(${x-48}px,22px)`;
      const status=whaleStatus(task.status);if(status!==lastStatus){lastStatus=status;animator.setStatus(status);animator.setAutonomous(mode==='capsule'&&status==='idle');}
      animator.options.mainSize=mode==='capsule'?76:64;animator.setVisible(true);
      if(!reduced||transition.current)frame=requestAnimationFrame(run);
    };
    const start=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(run);};wake.current=start;
    const observer=new ResizeObserver(start);observer.observe(element);media.addEventListener('change',start);document.addEventListener('visibilitychange',start);start();
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();media.removeEventListener('change',start);document.removeEventListener('visibilitychange',start);animator.destroy();water.dispose();whaleAnimator.current=null;engine.current=null;wake.current=()=>{};};
  },[]);
  useEffect(()=>{
    const animator=whaleAnimator.current;
    if(!animator)return;
    if(settings.whaleSkin==='classic'){animator.setSkin(null,WHALE_SKIN_BOUNDS);return;}
    const image=new Image();
    image.onload=()=>animator.setSkin(image,WHALE_SKIN_BOUNDS);
    image.onerror=()=>animator.setSkin(null,WHALE_SKIN_BOUNDS);
    image.src=whaleSkinSources[settings.whaleSkin];
    return()=>{image.onload=null;image.onerror=null;};
  },[settings.whaleSkin]);
  useEffect(()=>{
    if(lastMode.current!==mode){transition.current={kind:mode==='capsule'?'closing':'opening',start:performance.now(),fromX:position.current.x};lastMode.current=mode;if(mode==='capsule')setReady(false);}
    wake.current();
  },[mode,settings,visible,task]);
  const activeIndex=task.todos.findIndex(todo=>todo.status==='in_progress'),start=Math.max(0,(activeIndex<0?0:activeIndex)-1),todos=task.todos.slice(start,start+3);
  return <div ref={host} className="pool-view" data-layout={settings.poolLayout} data-fallback={fallback} data-readable={ready} data-idle={mode==='capsule'} onPointerMove={event=>{
    if(settings.animation!=='full')return;const rect=event.currentTarget.getBoundingClientRect();engine.current?.pointerMove(event.clientX-rect.left,event.clientY-rect.top,rect.width,rect.height);
  }} onPointerLeave={()=>engine.current?.pointerLeave()}>
    <canvas ref={waterCanvas} className="pool-water" aria-hidden="true"/>
    <button ref={whaleTarget} className="pool-whale-target task-capsule" onClick={mode==='capsule'?expand:()=>{}} aria-label={mode==='capsule'?`小鲸鱼，${task.label}，点击展开水池`:'小鲸鱼'} aria-expanded={mode!=='capsule'} disabled={mode!=='capsule'}>
      <canvas ref={whaleCanvas} className="pool-whale-art" aria-hidden="true"/><canvas ref={effects} className="pool-whale-effects" aria-hidden="true"/>
    </button>
    {mode==='capsule'&&<button className="pool-idle-menu" aria-label="鲸鱼水池菜单" onClick={menu}>···</button>}
    {mode==='capsule'&&task.attentionCount>0&&<button className="pool-attention" onClick={approval} aria-label={`${task.attentionCount} 项操作需要确认`}>{task.attentionCount}</button>}
    <section className="pool-sheet" aria-hidden={!ready} inert={!ready}>
      <header className="pool-heading"><div><h1 title={task.title}>{task.title}</h1><p>{task.label}</p></div></header>
      {task.total>0?<><div className="pool-progress-label"><span>已完成步骤</span><span>{task.completed}<small> / {task.total}</small></span></div><ol className="pool-steps">{todos.map((todo,index)=><li key={start+index} data-todo-status={todo.status} aria-current={todo.status==='in_progress'?'step':undefined}><span className="pool-step-mark" aria-hidden="true">{settings.poolLayout==='letter'?String(start+index+1).padStart(2,'0'):todo.status==='completed'?'✓':todo.status==='in_progress'?'·':'○'}</span><span title={todo.content}>{todo.content}</span><small>{todo.status==='completed'?'已完成':todo.status==='in_progress'?'进行中':'等待'}</small></li>)}</ol></>:<p className="pool-empty">{task.status==='disconnected'?'连接恢复后，将在这里显示任务进展。':task.session?'当前任务暂无步骤，可打开详情查看过程。':'开始一个任务，小鲸鱼就会陪你工作。'}</p>}
      <div className="pool-actions"><button className="pool-details" onClick={details}>任务详情{task.total>3?` · ${task.total} 步`:''}</button>{task.attentionCount>0&&<button onClick={approval}>{task.attentionCount} 项需要确认</button>}{task.status==='disconnected'&&<button onClick={reconnect}>检查连接并重试</button>}</div>
    </section>
  </div>;
}
