import { useEffect, useRef, type PointerEvent, type MouseEvent } from 'react';
import { resizeBounds, type Bounds, type ResizeEdge } from '../shared/window';

export function useWindowDrag() {
  const gesture = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const pending=useRef<{x:number;y:number}|null>(null);
  const busy=useRef(false);
  async function flush() {
    if(busy.current)return;
    busy.current=true;
    try {while(pending.current){const value=pending.current;pending.current=null;await window.glass.moveWindow(value);}}
    catch {pending.current=null;}
    finally {busy.current=false;}
  }
  return {
    onPointerDownCapture: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      gesture.current=null;suppress.current=false;
      if(!(e.target instanceof Element) || e.target.closest('input,select,textarea,label,summary,pre,a,[data-no-window-drag],.resize-edge,button:not(.task-capsule):not(.peek-main)'))return;
      e.preventDefault();
      e.target.closest<HTMLButtonElement>('button')?.focus({preventScroll:true});
      suppress.current = false;
      gesture.current = { x: e.screenX, y: e.screenY, left: window.screenX, top: window.screenY, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const g = gesture.current; if (!g) return;
      if(!(e.buttons&1)){gesture.current=null;return;}
      const dx = e.screenX - g.x; const dy = e.screenY - g.y;
      if (Math.hypot(dx, dy) >= 6) g.moved = true;
      if (g.moved) { e.preventDefault();if(!e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.setPointerCapture(e.pointerId);suppress.current = true;pending.current={ x:g.left+dx,y:g.top+dy };void flush(); }
    },
    onPointerUp: () => { gesture.current = null; },
    onPointerCancel: () => { gesture.current = null; suppress.current = true; },
    onLostPointerCapture: () => { gesture.current = null; },
    onClickCapture: (e:MouseEvent<HTMLElement>) => { if(suppress.current && e.detail!==0){e.preventDefault();e.stopPropagation();}suppress.current=false; },
  };
}
export function ResizeHandles() {
  const drag = useRef<{ edge: ResizeEdge; start: Bounds; x: number; y: number } | null>(null);
  const pending = useRef<Bounds | null>(null);
  const raf = useRef<number | null>(null);
  useEffect(() => () => { if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);
  function flush() {
    raf.current = null;
    if (pending.current) { void window.glass.resizeWindow(pending.current).catch(() => {}); pending.current = null; }
  }
  function cancel() { if (raf.current !== null) cancelAnimationFrame(raf.current); raf.current = null; pending.current = null; drag.current = null; }
  const edges: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  return <>{edges.map(edge => <div key={edge} className={'resize-edge resize-' + edge} aria-hidden="true"
    onPointerDown={e => {
      if (e.button !== 0) return;
      if (e.currentTarget.closest('.glass')?.getAttribute('data-morph') !== 'idle') return;
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { edge, start: { x: window.screenX, y: window.screenY, width: window.outerWidth, height: window.outerHeight }, x: e.screenX, y: e.screenY };
    }}
    onPointerMove={e => { const d = drag.current; if (!d || !(e.buttons & 1)) return; pending.current = resizeBounds(d.start, d.edge, e.screenX - d.x, e.screenY - d.y); if (raf.current === null) raf.current = requestAnimationFrame(flush); }}
    onPointerUp={() => { flush(); cancel(); }} onPointerCancel={cancel} onLostPointerCapture={cancel}
  />)}</>;
}
