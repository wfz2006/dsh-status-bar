import type { ReactNode } from 'react';
import { Icon } from './icon';

/** Decorative brand companion; the caller owns the real, accessible status. */
export function WhaleCompanion({ state, children }: { state: string; children: ReactNode }) {
  return <span className="whale-companion" data-whale-state={state}>
    <span className="whale-swimmer" aria-hidden="true"><Icon name="whale" /><i className="whale-bubble" /><i className="whale-bubble" /></span>
    {children}
  </span>;
}

export function WhaleEmpty({ children }: { children: ReactNode }) {
  return <div className="empty-state whale-empty">
    <span className="whale-empty-art" aria-hidden="true"><Icon name="whale" /><i /><i /></span>
    <p>{children}</p>
  </div>;
}
