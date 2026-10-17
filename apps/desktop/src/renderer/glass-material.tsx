import { useLayoutEffect, useRef } from 'react';
import type { GlassSettings } from '../shared/view-model';
import './vendor/edge-liquid-glass.js';
import './glass-material.css';
import { DesktopBackdrop } from './desktop-backdrop';
import { tintFill, type GlassAppearance } from '../shared/glass-appearance';

declare global {
  interface Window {
    LiquidGlass: {
      supported: boolean; init(): void; dispose(): void;
      refresh(elements?: HTMLElement[]): void;
      lite(elements: HTMLElement[], on: boolean): void;
    };
  }
}

export function GlassMaterial({ strength, moving, solid,autoTheme,appearance }: { strength: GlassSettings['strength']; moving: boolean; solid: boolean;autoTheme:boolean;appearance:GlassAppearance }) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { document.documentElement.dataset.glassProfile = strength; }, [strength]);
  useLayoutEffect(() => {
    if (solid) return;
    window.LiquidGlass.init();
    // Follow the actual local rectangle while morphing. Keep all three RGB
    // passes; coalesce native resize bursts instead of restoring glass later.
    let timer:ReturnType<typeof setTimeout>|undefined;
    let frame=0,last=0;
    const refresh=()=>{frame=0;last=performance.now();if(surface.current)window.LiquidGlass.refresh([surface.current]);};
    const observer=new ResizeObserver(()=>{
      if(timer!==undefined || frame)return;
      timer=setTimeout(()=>{timer=undefined;frame=requestAnimationFrame(refresh);},Math.max(0,32-(performance.now()-last)));
    });
    if(surface.current)observer.observe(surface.current);
    return () => {observer.disconnect();clearTimeout(timer);cancelAnimationFrame(frame);window.LiquidGlass.dispose();};
  }, [solid]);
  useLayoutEffect(() => {
    if (!surface.current || solid) return;
    window.LiquidGlass.refresh([surface.current]);
  }, [strength, moving, solid]);
  return <div className="glass-material" aria-hidden="true" data-source="edge-liquid-glass-newtab" data-optics={solid ? 'solid' : 'lens'}>
    <svg id="glass-defs" width="0" height="0" focusable="false" />
    <div className="glass-body" style={{filter:solid || appearance.brightness===100?'none':`brightness(${appearance.brightness / 100})`}}>
      <DesktopBackdrop paused={solid} autoTheme={autoTheme} appearance={appearance} />
      {!solid && <div ref={surface} className="lg-material-surface" data-glass data-lg-role="operation" />}
      {!solid && <div className="glass-tint" style={{backgroundColor:tintFill(appearance)}} />}
    </div>
    <div className="glass-rim" />
  </div>;
}
