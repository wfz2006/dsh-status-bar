import { memo, useLayoutEffect, useRef } from 'react';
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

type MaterialProps = { strength: GlassSettings['strength']; moving: boolean; solid: boolean; frosted: boolean; autoTheme:boolean;appearance:GlassAppearance };
export const GlassMaterial = memo(function GlassMaterial({ strength, moving, solid, frosted, autoTheme, appearance }: MaterialProps) {
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
      {frosted && !solid && <div className="glass-frost" />}
      {!solid && <div ref={surface} className="lg-material-surface" data-glass data-lg-role="operation" />}
      {!solid && <div className="glass-tint" style={{backgroundColor:tintFill(appearance)}} />}
    </div>
    <svg className="glass-rim" width="100%" height="100%" focusable="false">
      <defs><linearGradient id="glass-rim-shine" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity=".82" />
        <stop offset=".26" stopColor="#ffffff" stopOpacity=".38" />
        <stop offset=".52" stopColor="#dcecff" stopOpacity=".22" />
        <stop offset=".78" stopColor="#ffe9d0" stopOpacity=".36" />
        <stop offset="1" stopColor="#ffffff" stopOpacity=".64" />
      </linearGradient></defs>
      <rect className="glass-rim-line" />
    </svg>
  </div>;
}, (before,after) => before.strength===after.strength && before.moving===after.moving && before.solid===after.solid && before.frosted===after.frosted
  && before.autoTheme===after.autoTheme && before.appearance.tintColor===after.appearance.tintColor && before.appearance.tintOpacity===after.appearance.tintOpacity
  && before.appearance.brightness===after.appearance.brightness);
