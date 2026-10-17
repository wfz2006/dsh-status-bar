import { useEffect, useRef } from 'react';
import type { GlassSettings } from '../shared/view-model';
import './vendor/edge-liquid-glass.js';
import './glass-material.css';

declare global {
  interface Window {
    LiquidGlass: {
      supported: boolean; init(): void; dispose(): void;
      refresh(elements?: HTMLElement[]): void;
      lite(elements: HTMLElement[], on: boolean): void;
    };
  }
}

export function GlassMaterial({ strength, moving, solid }: { strength: GlassSettings['strength']; moving: boolean; solid: boolean }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (solid) return;
    window.LiquidGlass.init();
    return () => window.LiquidGlass.dispose();
  }, [solid]);
  useEffect(() => {
    document.documentElement.dataset.glassProfile = strength;
    if (!surface.current || solid) return;
    // The original engine uses a 120ms resize debounce; do not generate a map
    // for every native morph frame. Rebuild in local CSS pixels once settled.
    if (moving) window.LiquidGlass.lite([surface.current], true);
    else {
      window.LiquidGlass.refresh([surface.current]);
      window.LiquidGlass.lite([surface.current], false);
    }
  }, [strength, moving, solid]);
  return <div className="glass-material" aria-hidden="true" data-source="edge-liquid-glass-newtab" data-optics={solid ? 'solid' : moving ? 'settling' : 'lens'}>
    <svg id="glass-defs" width="0" height="0" focusable="false" />
    {!solid && <div ref={surface} className="lg-material-surface" data-glass data-lg-role="operation" />}
    <div className="glass-rim" />
  </div>;
}
