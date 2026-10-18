import type { Projection, Session } from '@glass/protocol';
import { DEFAULT_GLASS_APPEARANCE, normalizeGlassAppearance, type GlassAppearance } from './glass-appearance';
export type GlassViewMode = 'capsule' | 'peek' | 'expanded' | 'approval';
export type GlassSettings = GlassAppearance & {
  theme: 'auto' | 'light' | 'dark'; strength: 'clear' | 'balanced' | 'readable';
  defaultView: 'capsule' | 'peek' | 'remember-last'; autoApproval: boolean; autoCollapse: boolean;
  animation: 'full' | 'reduced' | 'off'; pin: 'always' | 'on-notification' | 'normal';
  material: 'system' | 'transparent' | 'acrylic' | 'frosted' | 'solid'; sound: boolean;
};
export const DEFAULT_SETTINGS: GlassSettings = { ...DEFAULT_GLASS_APPEARANCE, theme: 'auto', strength: 'balanced', defaultView: 'capsule', autoApproval: false, autoCollapse: false, animation: 'full', pin: 'always', material: 'system', sound: true };
export function normalizeSettings(value: unknown): GlassSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const v = value as Record<string, unknown>;
  function choice<T extends string>(key: string, options: readonly T[], fallback: T): T { return options.includes(v[key] as T) ? v[key] as T : fallback; }
  return { ...normalizeGlassAppearance(v), theme: choice('theme', ['auto', 'light', 'dark'], 'auto'), strength: choice('strength', ['clear', 'balanced', 'readable'], 'balanced'),
    defaultView: choice('defaultView', ['capsule', 'peek', 'remember-last'], 'capsule'), autoApproval: v.autoApproval === true, autoCollapse: v.autoCollapse === true,
    animation: choice('animation', ['full', 'reduced', 'off'], 'full'), pin: choice('pin', ['always', 'on-notification', 'normal'], 'always'), material: v.material==='acrylic' ? 'transparent' : choice('material', ['system', 'transparent', 'frosted', 'solid'], 'system'), sound: v.sound !== false };
}
export function viewSize(mode: GlassViewMode, attention = false) {
  return { capsule: { width: 288, height: 50 }, peek: { width: 340, height: attention ? 224 : 178 }, expanded: { width: 400, height: 360 }, approval: { width: 400, height: 340 } }[mode];
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
  const terminal = !!session && ['finished', 'limit-reached', 'error', 'cancelled', 'archived'].includes(session.phase);
  const pending = terminal ? [] : p.approvals.filter(a => a.sessionId === selected && a.runtimeId === p.runtimeId && a.sourceEpoch === p.epoch && (a.status === 'pending' || a.status === 'submitting'));
  const questions = terminal ? [] : p.questions.filter(q => q.sessionId === selected && q.runtimeId === p.runtimeId && q.sourceEpoch === p.epoch && (q.status === 'pending' || q.status === 'submitting'));
  const status = p.connection !== 'connected' || p.stale ? 'disconnected' : !session ? 'empty' : session.phase === 'error' ? 'error'
    : session.phase === 'finished' ? 'completed' : session.phase === 'cancelled' ? 'cancelled' : session.phase === 'archived' ? 'archived'
    : session.phase === 'limit-reached' ? 'limit_reached'
    : pending.length || session.phase === 'waiting-approval' ? 'waiting_approval' : questions.length || session.phase === 'waiting-question' ? 'waiting_answer'
    : session.agentStatus === 'running' ? 'running' : session.agentStatus === 'starting' ? 'starting' : session.agentStatus === 'stopping' ? 'stopping'
    : session.agentStatus === 'idle' ? 'idle' : 'unknown';
  const labels = { disconnected: p.connection === 'connecting' || p.connection === 'reconnecting' ? '正在重连' : p.connection === 'incompatible' ? '协议不兼容' : '连接已断开',
    waiting_approval: '等待确认', error: '任务出错', completed: '已完成', limit_reached: '达到输出上限', waiting_answer: '等待回答', running: '进行中', starting: '正在启动', stopping: '正在停止',
    idle: '空闲', unknown: '状态待同步', empty: '尚无会话', cancelled: '已取消', archived: '已归档' };
  return { session, title: session?.title || '尚无任务', todos, current: todos.filter(t => t.status === 'in_progress'), completed: todos.filter(t => t.status === 'completed').length,
    total: todos.length, pending, questions, attentionCount: pending.length + questions.length, status, label: labels[status] };
}
/** Compact token counts in the same 1.3M / 432K shape DSH's own status bar uses. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (value >= 1000) return (value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(Math.round(value));
}
/** Summarise the usage stats the adapter derived from DSH projections, if any are known. */
export function taskMetrics(session: Session | undefined) {
  const stats = session?.stats;
  if (!stats) return undefined;
  const totalTokens = stats.tokens?.total ?? 0;
  if (stats.turns === 0 && stats.steps === 0 && totalTokens === 0) return undefined;
  return { turns: stats.turns, steps: stats.steps, tokensPerSecond: stats.tokensPerSecond, cacheHitPercent: stats.cacheHitPercent,
    contextPercent: stats.contextPercent, totalTokens: stats.tokens?.total, inputTokens: stats.tokens?.input,
    cacheTokens: stats.tokens?.cacheRead, outputTokens: stats.tokens?.output };
}
