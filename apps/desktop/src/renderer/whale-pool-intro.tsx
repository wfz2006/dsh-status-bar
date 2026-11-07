import {useEffect,useRef} from 'react';
import {WhaleArt} from './whale-companion';

export function WhalePoolIntro({tryNow,later}:{tryNow:()=>void;later:()=>void}){
  const heading=useRef<HTMLHeadingElement>(null);
  const first=useRef<HTMLButtonElement>(null);
  useEffect(()=>{first.current?.focus();},[]);
  return <section className="pool-intro" role="dialog" aria-modal="true" aria-labelledby="pool-intro-title" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();later();}
    if(event.key==='Tab'){
      const buttons=event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
      const target=event.shiftKey?buttons[buttons.length-1]:buttons[0];
      if(event.shiftKey&&document.activeElement===buttons[0]||!event.shiftKey&&document.activeElement===buttons[buttons.length-1]){event.preventDefault();target?.focus();}
    }
  }}>
    <div className="pool-intro-art" aria-hidden="true"><WhaleArt/><span/><span/></div>
    <p className="pool-intro-eyebrow">新增外观</p>
    <h1 id="pool-intro-title" ref={heading}>小鲸鱼有自己的水池了</h1>
    <p className="pool-intro-copy">安静待机，轻点游动，水痕慢慢铺开成任务面板。</p>
    <p className="pool-intro-note">原有形态都还在。以后可在「设置 → 外观形态」随时切换，清流、轻舟、水笺三种排版也都可选。</p>
    <div className="pool-intro-actions"><button ref={first} className="primary-button" onClick={tryNow}>立即体验</button><button onClick={later}>暂时保留当前形态</button></div>
  </section>;
}
