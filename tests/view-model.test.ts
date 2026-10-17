import { expect, it } from 'vitest';
import { initialProjection, reduceProjection } from '../packages/protocol/src/index';
import { mockFrames } from '../packages/adapters/mock/src/index';
import { DEFAULT_SETTINGS, normalizeSettings, deriveTask, initialView, observeFacts, manualView, viewForSize, viewSize, formatTokens, taskMetrics } from '../apps/desktop/src/shared/view-model';

it('defaults to a calm task capsule and validates persisted preferences', () => {
  expect(initialView().mode).toBe('capsule');
  expect(DEFAULT_SETTINGS.autoApproval).toBe(false);
  expect(DEFAULT_SETTINGS.pin).toBe('always');
  expect(normalizeSettings({ animation: 'invalid', theme: 'light', autoApproval: true }).theme).toBe('light');
  expect(normalizeSettings({ animation: 'invalid' }).animation).toBe('full');
  expect(viewSize('capsule')).toEqual({ width: 300, height: 52 });
  expect(viewSize('expanded')).toEqual({ width: 400, height: 360 });
  expect(viewForSize(330, 180, 'expanded')).toBe('peek');
  expect(viewForSize(400, 320, 'approval')).toBe('approval');
});
it('migrates the retired native acrylic comparison without resetting other preferences',()=>{
  const migrated=normalizeSettings({theme:'dark',material:'acrylic',autoApproval:true,pin:'always'});
  expect(migrated.material).toBe('transparent');
  expect(migrated.theme).toBe('dark');expect(migrated.autoApproval).toBe(true);expect(migrated.pin).toBe('always');
});
it('keeps the frosted glass theme as an explicit material',()=>{
  expect(normalizeSettings({ material: 'frosted' }).material).toBe('frosted');
  expect(normalizeSettings({ material: 'frosted', pin: 'normal', theme: 'light' })).toMatchObject({ material: 'frosted', pin: 'normal', theme: 'light' });
  expect(normalizeSettings({ material: 'nonsense' }).material).toBe('system');
});
it('derives status and progress from source facts, not Todo completion', () => {
  let p = initialProjection();
  for (const f of mockFrames().slice(0, 2)) p = reduceProjection(p, f);
  const task = deriveTask(p, 'demo-main');
  expect(task.total).toBe(3); expect(task.completed).toBe(1); expect(task.status).toBe('running');
  const s = p.sessions['demo-main']!;
  p = { ...p, sessions: { ...p.sessions, 'demo-main': { ...s, todos: [{ content: 'a', status: 'completed' }] } } };
  expect(deriveTask(p, 'demo-main').status).toBe('running');
  p = { ...p, sessions: { ...p.sessions, 'demo-main': { ...s, todos: [] } } };
  expect(deriveTask(p, 'demo-main').total).toBe(0);
  expect(deriveTask({ ...p, connection: 'disconnected', stale: true }, 'demo-main').status).toBe('disconnected');
});
it('summarises usage stats for the compact and detailed task views', () => {
  let p = initialProjection(); for (const f of mockFrames().slice(0, 2)) p = reduceProjection(p, f);
  const task = deriveTask(p, 'demo-main');
  expect(taskMetrics(task.session)).toEqual({ turns: 3, steps: 42, tokensPerSecond: 218, cacheHitPercent: 96.4, contextPercent: 7.2,
    totalTokens: 1_280_200, inputTokens: 18_400, cacheTokens: 1_240_000, outputTokens: 21_800 });
  expect(formatTokens(1_280_200)).toBe('1.3M');
  expect(formatTokens(432_200)).toBe('432K');
  expect(formatTokens(9800)).toBe('9.8K');
  expect(formatTokens(0)).toBe('0');
  expect(taskMetrics(undefined)).toBeUndefined();
});
it('keeps business approval facts independent of user-selected form', () => {
  const facts = { pending: ['r/s/a'], completed: null };
  expect(observeFacts(initialView(), facts, DEFAULT_SETTINGS).mode).toBe('capsule');
  const automatic = observeFacts(initialView(), facts, { ...DEFAULT_SETTINGS, autoApproval: true });
  expect(automatic.mode).toBe('approval'); expect(automatic.returnMode).toBe('capsule');
  expect(observeFacts(automatic, { pending: [], completed: null }, DEFAULT_SETTINGS).mode).toBe('capsule');
  const manual = manualView(initialView(), 'expanded');
  expect(observeFacts(manual, facts, { ...DEFAULT_SETTINGS, autoApproval: true }).mode).toBe('expanded');
});
it('a user shrinking an approval cancels automatic return and expansion', () => {
  const automatic = observeFacts(initialView(), { pending: ['a'], completed: null }, { ...DEFAULT_SETTINGS, autoApproval: true });
  const manual = manualView(automatic, 'peek');
  expect(manual.returnMode).toBe(null);
  expect(observeFacts(manual, { pending: ['a', 'b'], completed: null }, { ...DEFAULT_SETTINGS, autoApproval: true }).mode).toBe('peek');
});
it('preserves every selected-session request and hides stale actionable assumptions', () => {
  let p = initialProjection(); for (const f of mockFrames()) p = reduceProjection(p, f);
  const a = p.approvals[0]!;
  p = { ...p, approvals: [a, { ...a, requestId: 'second' }, { ...a, sessionId: 'demo-other', requestId: 'other' }] };
  expect(deriveTask(p, 'demo-main').pending.map(a => a.requestId)).toEqual(['mock-approval-1', 'second']);
  expect(deriveTask(p, 'demo-other').pending.map(a => a.requestId)).toEqual(['other']);
  expect(deriveTask({ ...p, stale: true }, 'demo-main').status).toBe('disconnected');
});
it('distinguishes empty, idle, unknown, starting, stopping and terminal states', () => {
  let p = initialProjection(); for (const f of mockFrames()) p = reduceProjection(p, f);
  expect(deriveTask(p, 'missing').status).toBe('empty');
  const original = p.sessions['demo-main']!;
  for (const agentStatus of ['idle', 'unknown', 'starting', 'stopping'] as const) {
    expect(deriveTask({ ...p, approvals: [], sessions: { ...p.sessions, 'demo-main': { ...original, agentStatus } } }, 'demo-main').status).toBe(agentStatus);
  }
  for (const [phase, expected] of [['finished', 'completed'], ['error', 'error'], ['cancelled', 'cancelled'], ['archived', 'archived']] as const) {
    const task = deriveTask({ ...p, sessions: { ...p.sessions, 'demo-main': { ...original, phase } } }, 'demo-main');
    expect(task.status).toBe(expected); expect(task.pending).toEqual([]); expect(task.attentionCount).toBe(0);
  }
});
it('includes only current runtime and session questions in the shared attention count', () => {
  let p = initialProjection(); for (const f of mockFrames()) p = reduceProjection(p, f);
  const q = { requestId: 'q', runtimeId: p.runtimeId!, sourceEpoch: p.epoch!, sessionId: 'demo-main', createdAt: '2026-10-18T00:00:00.000Z',
    status: 'pending' as const, actionable: false, questions: [{ id: 'q1', question: '选择方案', type: 'freeText' as const }] };
  p = { ...p, questions: [q, { ...q, sessionId: 'demo-other' }, { ...q, sourceEpoch: 'old' }, { ...q, status: 'answered' }] };
  const task = deriveTask(p, 'demo-main');
  expect(task.questions).toHaveLength(1); expect(task.attentionCount).toBe(2);
  expect(deriveTask({ ...p, approvals: [] }, 'demo-main').status).toBe('waiting_answer');
});
