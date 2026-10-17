import type { Projection } from '@glass/protocol';
import type { Bounds } from './window';
import type { GlassViewMode, GlassSettings } from './view-model';
export type WindowAction = 'expand' | 'collapse' | 'hide' | 'quit' | 'pin' | 'settings' | 'activity' | 'back' | 'approval' | 'menu' | 'open-dsh' | 'reconnect';
export type MockAction = 'restart' | 'disconnect' | 'reconnect' | 'out-of-order' | 'approval-queue' | 'edge-cases' | 'completed';
export type PresentationState = { material: 'acrylic' | 'clear' | 'solid'; morphing: 'expanding' | 'collapsing' | null };
export type WindowState = PresentationState & { pinned: boolean; viewMode: GlassViewMode; manualSize: boolean; panel: 'settings' | 'activity' | null; settings: GlassSettings; completionFeedback: boolean };
export interface GlassAPI {
  getState(): Promise<Projection>;
  subscribe(callback: (state: Projection) => void): () => void;
  getWindowState(): Promise<WindowState>;
  subscribeWindow(callback: (state: WindowState) => void): () => void;
  windowAction(action: WindowAction, reduceMotion?: boolean): Promise<WindowState>;
  resizeWindow(bounds: Bounds): Promise<void>;
  moveWindow(position: { x: number; y: number }): Promise<void>;
  setSettings(settings: Partial<GlassSettings>): Promise<WindowState>;
  selectSession(id: string): Promise<void>;
  copyApproval(identity: { sessionId: string; requestId: string }): Promise<void>;
  mockAction(action: MockAction): Promise<void>;
}
