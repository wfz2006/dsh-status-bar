import { WHALE_MARK } from './whale-mark';

export type IconName = 'collapse' | 'more' | 'back' | 'chevron' | 'chevron-right' | 'code' | 'external' | 'file' | 'image' | 'terminal' | 'pencil' | 'search' | 'globe' | 'list' | 'wrench' | 'brain' | 'chat' | 'user' | 'shield' | 'check' | 'x' | 'whale';
const paths: Record<Exclude<IconName, 'more'>, React.ReactNode> = {
  collapse: <path d="m7 10 5 5 5-5" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  'chevron-right': <path d="m10 7 5 5-5 5" />,
  back: <path d="m14 6-6 6 6 6" />,
  code: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-10-2 12" />,
  external: <path d="M14 4h6v6m0-6L10 14m0-10H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4" /><path d="M9 13h6M9 17h6" /></>,
  image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.4" /><path d="m4 17 5-5 4 4 3-3 4 4" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  pencil: <path d="m4 20 4-.8L20 7.2a2 2 0 0 0-3-3L5 16.2 4 20Z" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  wrench: <path d="M14.5 6.5a3.5 3.5 0 0 0 4.7 4.6L21 13a4 4 0 0 1-5.6 5.6l-8.5-8.5a4 4 0 0 1 5.6-5.6Z" />,
  brain: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8V20" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-4 2.8V20" /><path d="M9 9.5c1.2 0 2 .8 2 2M15 9.5c-1.2 0-2 .8-2 2" /></>,
  chat: <path d="M4 5h16v11H9l-5 4V5Z" />,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></>,
  shield: <><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="M12 8.5v4.5" /><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" /></>,
  check: <path d="m5 12 4.5 4.5L19 7" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  whale: <path d={WHALE_MARK} fill="currentColor" stroke="none" />,
};
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? 'ui-icon ' + className : 'ui-icon'} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'more' ? <><circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none" /></> : paths[name]}
  </svg>;
}
