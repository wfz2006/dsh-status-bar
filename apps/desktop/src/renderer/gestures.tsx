import { useEffect, useMemo, useRef, type RefObject, type PointerEvent, type MouseEvent } from 'react';
import { resizeBounds, type Bounds, type ResizeEdge } from '../shared/window';
import { createDragMotion } from './drag-motion';

export function useWindowDrag(root: RefObject<HTMLElement | null>, context: string, animation: string) {
  const suppress = useRef(false);
  const media = useMemo(() => matchMedia('(prefers-reduced-motion: reduce)'), []);
  const motion = useMemo(() => createDragMotion({
    now: () => performance.now(), position: () => ({ x: window.screenX, y: window.screenY }),
    move: point => window.glass.moveWindow(point),
    requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    animated: () => !!root.current && root.current.dataset.mode === 'capsule' && root.current.dataset.panel === 'none'
      && root.current.dataset.morph === 'idle' && root.current.dataset.animation === 'full' && !media.matches,
    paint: value => {
      const el = root.current; if (!el) return;
      if (!value) {
        delete el.dataset.drag;
        for (const key of ['--drag-x', '--drag-y', '--drag-lean', '--drag-energy']) el.style.removeProperty(key);
        return;
      }
      el.dataset.drag = value.phase;
      el.style.setProperty('--drag-x', value.x.toFixed(3) + 'px');
      el.style.setProperty('--drag-y', value.y.toFixed(3) + 'px');
      el.style.setProperty('--drag-lean', (value.x * 2.9).toFixed(3) + 'deg');
      el.style.setProperty('--drag-energy', value.energy.toFixed(3));
    },
  }), [root, media]);
  useEffect(() => {
    const cancel = () => motion.cancel();
    const visibility = () => { if (document.hidden) cancel(); };
    const keyboard = (event: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'ContextMenu'].includes(event.key) || event.key === 'F10' && event.shiftKey) cancel();
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('contextmenu', cancel, true);
    document.addEventListener('visibilitychange', visibility);
    // Transparent Electron windows can remain document.visible after hide.
    const offWindow = window.glass.subscribeWindow(state => { if (state.visible === false) cancel(); });
    const preference = () => motion.finish();
    media.addEventListener('change', preference);
    return () => {
      cancel(); offWindow(); window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', keyboard, true); window.removeEventListener('contextmenu', cancel, true);
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', preference);
    };
  }, [motion, media]);
  useEffect(() => { motion.cancel(); }, [motion, context]);
  useEffect(() => { motion.finish(); }, [motion, animation]);
  function cancelPointer(e: PointerEvent<HTMLElement>) {
    if (motion.owns(e.pointerId)) { motion.cancel(); suppress.current = true; }
  }
  return {
    onPointerDownCapture: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.currentTarget.dataset.morph !== 'idle') return;
      if(!(e.target instanceof Element) || e.target.closest('input,select,textarea,label,summary,pre,a,[data-no-window-drag],.resize-edge,button:not(.task-capsule):not(.peek-main)'))return;
      if (!motion.begin(e.pointerId, { x: e.screenX, y: e.screenY })) return;
      e.preventDefault();
      e.target.closest<HTMLButtonElement>('button')?.focus({preventScroll:true});
      suppress.current = false;
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!motion.owns(e.pointerId)) return;
      if (!(e.buttons & 1)) { cancelPointer(e); return; }
      if (motion.update(e.pointerId, { x: e.screenX, y: e.screenY })) {
        e.preventDefault();
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId);
        suppress.current = true;
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => motion.end(e.pointerId),
    onPointerCancel: cancelPointer,
    onLostPointerCapture: cancelPointer,
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
