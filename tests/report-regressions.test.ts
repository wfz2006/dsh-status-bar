import { afterEach, expect, it, vi } from 'vitest';
import { createDshAdapter } from '../packages/adapters/dsh/src/index';
import { initialProjection, reduceProjection } from '../packages/protocol/src/index';
import { deriveTask } from '../apps/desktop/src/shared/view-model';
import { FakeHost } from './helpers/dsh-host';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const host = new FakeHost(); host.sessions = [{ sessionId: 's1', running: true }];
  await host.start(); cleanups.push(() => host.stop()); let projection = initialProjection();
  const adapter = createDshAdapter({ publish: frame => { projection = reduceProjection(projection, frame); },
    onConnection: connection => { if (connection !== 'connected') projection = reduceProjection(projection, { kind: connection === 'connecting' ? 'transport.connecting' : 'transport.closed' }); },
  });
  cleanups.push(() => adapter.stop()); await adapter.connect(host.link()); return { host, adapter, state: () => projection };
}
it('does not carry pending requests or answer channels across turn boundaries', async () => {
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', seq: 1, data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo safe"}' } });
  h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
  h.host.waterfall({ eventId: 'qev', agentId: 's1', event: 'user-questions/request', request: { wait: { callId: 'q1' }, questions: [{ id: 'q1', question: 'Which?' }] } });
  await expect.poll(() => deriveTask(h.state(), 's1').attentionCount).toBe(2);
  const approval = h.state().approvals[0]!; const question = h.state().questions[0]!;
  h.host.audit('s1', { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } });
  await expect.poll(() => h.state().approvals[0]?.status).toBe('unavailable');
  expect(h.state().questions[0]?.status).toBe('unavailable');
  h.host.audit('s1', { type: 'turn/start', seq: 3, data: {} });
  await expect.poll(() => h.state().sessions['s1']?.phase).toBe('working');
  expect(deriveTask(h.state(), 's1').attentionCount).toBe(0);
  await expect(h.adapter.respondApproval(approval, 'allowed-once')).rejects.toThrow();
  await expect(h.adapter.respondQuestion(question, [{ questionId: 'q1', values: ['yes'] }])).rejects.toThrow();
  expect(h.host.requests.some(r => r.method === '$events/result')).toBe(false);
});
it.each([
  ['curl -H "Authorization: Bearer opaque-bearer-value" https://example.test', 'opaque-bearer-value'],
  ['curl https://user:private-password@example.test/resource', 'private-password'],
  ['API_KEY=private-value curl https://example.test', 'private-value'],
  ['curl https://example.test/?token=private-value', 'private-value'],
  ['curl -H "Authorization: Basic private-encoded-value" https://example.test', 'private-encoded-value'],
  ['run --token private-flag-value', 'private-flag-value'],
  ['run sk-private-value-secret', 'sk-private-value-secret'],
])('keeps credentials in tool string values out of every projection: %s', async (command, credential) => {
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command }) } });
  h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
  await expect.poll(() => h.state().approvals.length).toBe(1);
  expect(h.state().approvals[0]).toMatchObject({ displayDetails: 'partial', actionable: false });
  expect(JSON.stringify(h.state())).not.toContain(command);
  expect(JSON.stringify(h.adapter.snapshot())).not.toContain(command);
  expect(JSON.stringify(h.state())).not.toContain(credential);
  expect(JSON.stringify(h.adapter.snapshot())).not.toContain(credential);
});
it('tolerates one failed list poll and recovers inventory while retaining the healthy event stream', async () => {
  const h = await setup(); vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  // Reconnect once so the actual adapter poll is scheduled using the test clock.
  await h.adapter.connect(h.host.link());
  h.host.rpc = method => { if (method === 'session/list') throw new Error('transient'); return true; };
  vi.advanceTimersByTime(10000);
  await expect.poll(() => h.host.requests.filter(r => r.method === 'session/list').length).toBe(3);
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(h.state().connection).toBe('connected');
  h.host.audit('s1', { type: 'todo/write', seq: 2, data: { todos: [{ content: 'still live', status: 'in_progress' }] } });
  await expect.poll(() => h.state().sessions['s1']?.todos[0]?.content).toBe('still live');
  h.host.rpc = undefined; h.host.sessions.push({ sessionId: 'after-retry', running: true });
  vi.advanceTimersByTime(10000);
  await expect.poll(() => h.state().sessions['after-retry']?.phase).toBe('working');
  expect(h.state().connection).toBe('connected');
});
it('ignores late events after session removal and releases every session-scoped cache', async () => {
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"echo safe"}' } });
  h.host.audit('s1', { type: 'approval/asked', data: { id: 'audit', toolName: 'bash', callId: 'c1' } });
  await expect.poll(() => h.state().sessions['s1']?.phase).toBe('waiting-approval');
  h.host.gateway({ type: 'emit', event: 'api-session/removed', args: ['s1'] });
  await expect.poll(() => Object.keys(h.state().sessions)).toEqual([]);
  h.host.audit('s1', { type: 'todo/write', seq: 200, data: { todos: [{ content: 'late', status: 'pending' }] } });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(Object.keys(h.state().sessions)).toEqual([]);
  expect(Object.values(h.adapter.retained())).toEqual(expect.arrayContaining([0]));
  expect(h.adapter.retained()).toMatchObject({ sessions: 0, toolArguments: 0, auditApprovals: 0, followed: 0, projectionClocks: 0, coldRead: 0, emittedSessions: 0 });
  h.host.gateway({ type: 'emit', event: 'api-session/added', args: [{ sessionId: 's1', running: true, agentAvailable: true }] });
  await expect.poll(() => Object.keys(h.state().sessions)).toEqual(['s1']);
});
it('bounds settled history and tool arguments without dropping a live pending approval', async () => {
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', data: { callId: 'keep', name: 'bash', arguments: '{"command":"echo keep"}' } });
  h.host.waterfall({ eventId: 'keep', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'keep' } });
  await expect.poll(() => h.state().approvals.some(a => a.callId === 'keep' && a.actionable)).toBe(true);
  for (let i = 0; i < 320; i++) {
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c' + i, name: 'bash', arguments: '{"command":"echo safe"}' } });
    h.host.audit('s1', { type: 'approval/asked', data: { id: 'a' + i, toolName: 'bash', callId: 'c' + i } });
    h.host.audit('s1', { type: 'approval/decided', data: { id: 'a' + i, outcome: 'rejected' } });
  }
  await expect.poll(() => h.state().sessions['s1']?.activities[0]?.callId, { timeout: 10000 }).toBe('c319');
  const sizes = h.adapter.retained(); expect(sizes.toolArguments).toBeLessThanOrEqual(257);
  expect(sizes.approvals).toBeLessThanOrEqual(101); expect(sizes.auditApprovals).toBeLessThanOrEqual(1);
  const approval = (h.adapter.snapshot() as Extract<ReturnType<typeof h.adapter.snapshot>, { kind: 'glass.snapshot' }>).payload.approvals.find(a => a.callId === 'keep');
  expect(approval?.actionable).toBe(true); if (!approval) throw new Error('Lost active approval');
  expect(h.state().approvals.some(a => a.callId === 'keep' && a.actionable)).toBe(true);
  await h.adapter.respondApproval(approval, 'rejected');
}, 15000);
it('cannot confirm an old continued answer after its session has been removed', async () => {
  const h = await setup();
  h.host.control({ type: 'projection', sessionId: 's1', key: 'userQuestions', seq: 10, value: { active: [{ callId: 'continued', questions: [{ id: 'q1', question: 'Which?' }] }] } });
  await expect.poll(() => h.state().questions[0]?.actionable).toBe(true);
  let finish: (value: boolean) => void = () => {};
  h.host.rpc = method => method === 'userQuestions/answer' ? new Promise(resolve => { finish = resolve; }) : true;
  const result = h.adapter.respondQuestion(h.state().questions[0]!, [{ questionId: 'q1', values: ['yes'] }]);
  // Attach the rejection observer before delivering the removal.
  const rejected = expect(result).rejects.toThrow('答案提交失败');
  await expect.poll(() => h.host.requests.some(request => request.method === 'userQuestions/answer')).toBe(true);
  h.host.gateway({ type: 'emit', event: 'api-session/removed', args: ['s1'] });
  await expect.poll(() => Object.keys(h.state().sessions)).toEqual([]); finish(true); await rejected;
  expect(h.state().questions).toEqual([]); expect(h.adapter.retained().questions).toBe(0);
});
it('a historical follow replay neither resurrects ended requests nor disables a current live delivery', async () => {
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', seq: 100, data: { callId: 'live', name: 'bash', arguments: '{"command":"echo live"}' } });
  h.host.waterfall({ eventId: 'live', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'live' } });
  await expect.poll(() => h.state().approvals[0]?.actionable).toBe(true);
  h.host.send('audit:s1', { type: 'snapshot', projections: { values: { turnBoundary: { openTurnStartSeq: 90 } } },
    assistantStream: { revision: 2, activeAttempt: { attemptId: 'current', turn: 2, step: 1, startedAfterSeq: 100, nextIndex: 1, stream: [{ type: 'text-chunks', index: 0, texts: ['current prefix'] }] } }, records: [
    { type: 'event', event: { type: 'approval/asked', seq: 2, data: { id: 'old', callId: 'old', toolName: 'bash' } } },
    { type: 'event', event: { type: 'turn/end', seq: 3, data: { reason: { kind: 'completed' } } } },
  ] });
  await expect.poll(() => h.state().approvals.some(request => request.callId === 'old' && request.status === 'unavailable')).toBe(true);
  const current = h.state().approvals.find(request => request.callId === 'live');
  expect(current?.actionable).toBe(true); expect(deriveTask(h.state(), 's1').attentionCount).toBe(1);
  expect(h.state().sessions.s1?.notes?.[0]).toMatchObject({ text: 'current prefix', streaming: true });
});
it('revokes requests on audit-stream loss and follows again without replaying authentication', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  const h = await setup();
  h.host.audit('s1', { type: 'tool/call', data: { callId: 'lost', name: 'bash', arguments: '{"command":"echo safe"}' } });
  h.host.waterfall({ eventId: 'lost', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'lost' } });
  await expect.poll(() => h.state().approvals[0]?.actionable).toBe(true);
  h.host.end('audit:s1');
  await expect.poll(() => h.state().approvals[0]?.status).toBe('unavailable');
  expect(h.state().connection).toBe('connected'); expect(h.adapter.retained().followed).toBe(0);
  vi.advanceTimersByTime(10000);
  await expect.poll(() => h.host.openStreams.filter(stream => stream === 'audit:s1').length).toBe(2);
  h.host.audit('s1', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'recovered' }] } } });
  await expect.poll(() => h.state().sessions.s1?.notes?.[0]?.text).toBe('recovered');
  expect(h.host.authAttempts).toBe(1); expect(h.host.requests.filter(request => request.method === '$events/result')).toHaveLength(0);
});
