import type { Projection } from '@glass/protocol';
export type WindowAction = 'expand' | 'collapse' | 'hide' | 'quit' | 'pin' | 'material';
export type MockAction = 'restart' | 'disconnect' | 'reconnect' | 'out-of-order';
export type WindowState = { pinned: boolean };
export interface GlassAPI {
  getState(): Promise<Projection>;
  subscribe(callback: (state: Projection) => void): () => void;
  getWindowState(): Promise<WindowState>;
  subscribeWindow(callback: (state: WindowState) => void): () => void;
  windowAction(action: WindowAction): Promise<WindowState>;
  mockAction(action: MockAction): Promise<void>;
}
