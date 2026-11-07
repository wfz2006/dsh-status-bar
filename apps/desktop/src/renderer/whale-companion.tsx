import { createContext, useContext, type ReactNode } from 'react';
import type { WhaleSkin } from '../shared/whale-skins';
import { Icon } from './icon';
import { whaleSkinSources } from './whale-skin-art';

export const WhaleSkinContext = createContext<WhaleSkin>('classic');

export function WhaleArt({ skin, className }: { skin?: WhaleSkin; className?: string }) {
  const preferred = useContext(WhaleSkinContext);
  const selected = skin ?? preferred;
  if (selected === 'classic') return <Icon name="whale" className={className} />;
  return <img className={className ? 'whale-skin-art ' + className : 'whale-skin-art'}
    src={whaleSkinSources[selected]} data-whale-skin={selected} alt="" draggable={false} />;
}

/** Decorative brand companion; the caller owns the real, accessible status. */
export function WhaleCompanion({ state, children }: { state: string; children: ReactNode }) {
  return <span className="whale-companion" data-whale-state={state}>
    <span className="whale-swimmer" aria-hidden="true"><WhaleArt /><i className="whale-bubble" /><i className="whale-bubble" /></span>
    {children}
  </span>;
}

export function WhaleEmpty({ children }: { children: ReactNode }) {
  return <div className="empty-state whale-empty">
    <span className="whale-empty-art" aria-hidden="true"><WhaleArt /><i /><i /></span>
    <p>{children}</p>
  </div>;
}
