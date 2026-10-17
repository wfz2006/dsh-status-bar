import type { Projection } from '@glass/protocol';
export type GlassViewMode = 'capsule' | 'peek' | 'expanded' | 'approval';
export type GlassSettings = {
  theme: 'auto' | 'light' | 'dark'; strength: 'clear' | 'balanced' | 'readable';
  defaultView: 'capsule' | 'peek' | 'remember-last'; autoApproval: boolean; autoCollapse: boolean;
  animation: 'full' | 'reduced' | 'off'; pin: 'always' | 'on-notification' | 'normal';
  material: 'system' | 'transparent' | 'solid';
};
export const DEFAULT_SETTINGS: GlassSettings = { theme: 'auto', strength: 'balanced', defaultView: 'capsule', autoApproval: false, autoCollapse: false, animation: 'full', pin: 'normal', material: 'system' };
export function normalizeSettings(value: unknown): GlassSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  function choice<T extends string>(key: string, options: readonly T[], fallback: T): T { return options.includes(v[key] as T) ? v[key] as T : fallback; }
  return { theme: choice('theme', ['auto', 'light', 'dark'], 'auto'), strength: choice('strength', ['clear', 'balanced', 'readable'], 'balanced'),
    defaultView: choice('defaultView', ['capsule', 'peek', 'remember-last'], 'capsule'), autoApproval: v.autoApproval === true, autoCollapse: v.autoCollapse === true,
    animation: choice('animation', ['full', 'reduced', 'off'], 'full'), pin: choice('pin', ['always', 'on-notification', 'normal'], 'normal'), material: choice('material', ['system', 'transparent', 'solid'], 'system') };
}
export function viewSize(mode: GlassViewMode) {
  return { capsule: { width: 300, height: 56 }, peek: { width: 340, height: 168 }, expanded: { width: 400, height: 280 }, approval: { width: 400, height: 340 } }[mode];
}
export function viewForSize(width: number, height: number, current: GlassViewMode): GlassViewMode {
  if (height < 96) return 'capsule';
  if (width < 360 || height < 250) return 'peek';
  return current === 'approval' ? 'approval' : 'expanded';
}
export type ViewState = { mode: GlassViewMode; manual: boolean; returnMode: GlassViewMode | null; pending: string[]; completed: string | null };
export function initialView(mode: GlassViewMode = 'capsule'): ViewState { return { mode, manual: false, returnMode: null, pending: [], completed: null }; }
export function manualView(state: ViewState, mode: GlassViewMode): ViewState { return { ...state, mode, manual: true, returnMode: null }; }
export type AttentionFacts = { pending: string[]; completed: string | null };
export function observeFacts(state: ViewState, facts: AttentionFacts, settings: GlassSettings): ViewState {
  let next = { ...state, pending: facts.pending, completed: facts.completed };
  const newRequest = facts.pending.some(id => !state.pending.includes(id));
  if (newRequest && settings.autoApproval && !state.manual) next = { ...next, mode: 'approval', returnMode: state.returnMode ?? state.mode };
  if (!facts.pending.length && state.returnMode && !state.manual) next = { ...next, mode: state.returnMode, returnMode: null };
  return next;
}
export function deriveTask(p: Projection, selected: string) {
  const session = Object.hasOwn(p.sessions, selected) ? p.sessions[selected] : undefined;
  const todos = session?.todos ?? [];
  const pending = p.approvals.filter(a => a.sessionId === selected && a.runtimeId === p.runtimeId && a.sourceEpoch === p.epoch && (a.status === 'pending' || a.status === 'submitting'));
  const status = p.connection !== 'connected' || p.stale ? 'disconnected' : pending.length ? 'waiting_approval' : session?.phase === 'error' ? 'error' : session?.phase === 'finished' ? 'completed' : session?.phase === 'waiting-question' ? 'waiting_answer' : session?.agentStatus === 'running' ? 'running' : 'waiting';
  const labels = { disconnected: p.connection === 'connecting' ? '正在重连' : p.connection === 'incompatible' ? '协议不兼容' : '连接已断开', waiting_approval: '等待确认', error: '任务出错', completed: '已完成', waiting_answer: '等待回答', running: '进行中', waiting: '等待新事件' };
  return { session, title: session?.title || '尚无任务', todos, current: todos.filter(t => t.status === 'in_progress'), completed: todos.filter(t => t.status === 'completed').length, total: todos.length, pending, status, label: labels[status] };
}
