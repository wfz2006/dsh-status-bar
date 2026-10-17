import { create } from 'zustand';
import { initialProjection, type Projection } from '@glass/protocol';
export const useGlass = create<{ projection: Projection; selected: string; replace: (p: Projection) => void; select: (id: string) => void }>(set => ({
  projection: initialProjection(), selected: 'demo-main',
  replace: projection => set(state => ({ projection, selected: Object.hasOwn(projection.sessions, state.selected) ? state.selected : Object.keys(projection.sessions)[0] ?? '' })),
  select: selected => set({ selected }),
}));
