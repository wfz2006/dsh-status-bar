import type { Projection } from '@glass/protocol';
import type { Bounds } from './window';
export type WindowAction = 'expand' | 'collapse' | 'hide' | 'quit' | 'pin' | 'material' | 'theme-system' | 'theme-dark' | 'theme-light';
export type MockAction = 'restart' | 'disconnect' | 'reconnect' | 'out-of-order';
export type WindowState = { pinned: boolean; material: 'acrylic' | 'clear' | 'solid'; morphing: 'expanding' | 'collapsing' | null };
export interface GlassAPI {
  getState(): Promise<Projection>;
  subscribe(callback: (state: Projection) => void): () => void;
  getWindowState(): Promise<WindowState>;
  subscribeWindow(callback: (state: WindowState) => void): () => void;
  windowAction(action: WindowAction, reduceMotion?: boolean): Promise<WindowState>;
  resizeWindow(bounds: Bounds): Promise<void>;
  mockAction(action: MockAction): Promise<void>;
}
