import { afterEach, describe, expect, it } from 'vitest';
import { assertApprovalResponse, assertQuestionResponse } from '../apps/desktop/src/main/request-gate';
import { createDshAdapter } from '../packages/adapters/dsh/src/index';
import { initialProjection, reduceProjection, type Frame, type Projection } from '../packages/protocol/src/index';
import { FakeHost, TOKEN, object, type Seed, type AuthMode } from './helpers/dsh-host';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(options: { seeds?: Seed[]; auth?: AuthMode } = {}) {
  const host = new FakeHost();
  if (options.seeds) host.sessions = options.seeds;
  if (options.auth) host.auth = options.auth;
  cleanups.push(() => host.stop());
  await host.start();
  const frames: Frame[] = [];
  const connections: string[] = [];
  let projection: Projection = initialProjection();
  const adapter = createDshAdapter({
    publish: frame => { frames.push(frame); projection = reduceProjection(projection, frame); },
    onConnection: connection => {
      connections.push(connection);
      if (connection !== 'connected') projection = reduceProjection(projection, { kind: connection === 'connecting' ? 'transport.connecting' : 'transport.closed' });
    },
  });
  cleanups.push(() => adapter.stop());
  return { host, adapter, frames, connections, state: () => projection };
}

describe('dsh host contract', () => {
  it('rejects malformed links before contacting any host', async () => {
    const h = await setup();
    const links = [
      'http://example.com/?token=x',
      'https://127.0.0.1:1/?token=x&extra=1',
      'http://user:pass@127.0.0.1:1/?token=x',
      `${h.host.link()}#fragment`,
      `${h.host.link()}&token=second`,
      'http://127.0.0.1:1/subpath?token=x',
      'http://127.0.0.1:1/',
    ];
    for (const link of links) await expect(h.adapter.connect(link)).rejects.toThrow(/连接 DSH 失败/);
    expect(h.host.authAttempts).toBe(0);
    expect(h.frames).toHaveLength(0);
  });

  it('refuses authentication that does not establish a host session', async () => {
    for (const auth of ['not-found', 'foreign', 'no-cookie'] as const) {
      const h = await setup({ auth });
      await expect(h.adapter.connect(h.host.link())).rejects.toThrow(/连接 DSH 失败/);
      expect(h.host.requests).toHaveLength(0);
    }
    const wrong = await setup();
    await expect(wrong.adapter.connect(wrong.host.link('wrong-token'))).rejects.toThrow(/连接 DSH 失败/);
    expect(wrong.host.requests).toHaveLength(0);
  });

  it('projects sessions, todos and capabilities after a verified connect', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', title: '构建会话', cwd: 'C:\\ws\\alpha', running: true, todos: [{ content: '读规范', status: 'completed' }] }] });
    await h.adapter.connect(h.host.link());
    expect(h.connections).toEqual(['connecting', 'connected']);
    expect(h.frames.map(frame => frame.kind)).toEqual(['glass.welcome', 'glass.snapshot']);
    const welcome = h.frames[0] as Extract<Frame, { kind: 'glass.welcome' }>;
    expect(welcome.payload.source).toBe('dsh');
    expect(welcome.payload.capabilities).toEqual({ observeSessions: true, observeTodos: true, observeTools: true, respondApproval: true, respondQuestion: true });
    const state = h.state();
    expect(state.connection).toBe('connected');
    expect(state.stale).toBe(false);
    expect(state.runtimeId).toBe(welcome.runtimeId);
    expect(state.sessions['s1']).toMatchObject({ title: '构建会话', workspaceLabel: 'C:\\ws\\alpha', agentStatus: 'running', phase: 'working' });
    expect(state.sessions['s1']?.todos).toEqual([{ content: '读规范', status: 'completed' }]);
    expect(h.host.openStreams).toEqual(expect.arrayContaining(['control', 'gateway', 'workspace', 'audit:s1']));
    expect(h.host.requests.map(request => request.method)).toEqual(['session/list']);
    expect(JSON.stringify(h.frames)).not.toContain(TOKEN);
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('applies audit todo and turn events to the followed session', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'todo/write', data: { todos: [{ content: 'A', status: 'pending' }, { content: 'B', status: 'in_progress' }] } });
    await expect.poll(() => h.state().sessions['s1']?.todos.length, { timeout: 3000 }).toBe(2);
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    await expect.poll(() => h.state().sessions['s1']?.phase, { timeout: 3000 }).toBe('finished');
    expect(h.state().sessions['s1']?.agentStatus).toBe('idle');
  });

  it('shows live reasoning before the durable assistant message exists, then replaces it without duplicates', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.assistant('s1', { type: 'start', attemptId: 's1:1', revision: 1, turn: 1, step: 1, startedAfterSeq: 4 });
    const started = performance.now();
    h.host.assistant('s1', { type: 'chunk', attemptId: 's1:1', revision: 2, index: 0, time: Date.now(), chunk: { type: 'reasoning-delta', index: 0, text: '先检查' } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text, { timeout: 500, interval: 5 }).toBe('先检查');
    const first = h.state().sessions['s1']?.notes?.[0];
    expect(performance.now() - started).toBeLessThan(500);
    h.host.assistant('s1', { type: 'chunk', attemptId: 's1:1', revision: 3, index: 1, time: Date.now(), chunk: { type: 'reasoning-delta', index: 0, text: '代码。' } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text).toBe('先检查代码。');
    expect(h.state().sessions['s1']?.notes?.[0]?.id).toBe(first?.id);
    expect(h.host.followRequests.get('s1')?.assistantStream).toBe(true);
    h.host.audit('s1', { type: 'assistant/message', seq: 5, data: { turn: 1, step: 1, message: { content: [{ type: 'reasoning', text: '先检查代码。' }] } } });
    h.host.assistant('s1', { type: 'end', attemptId: 's1:1', revision: 4, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 5 } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.streaming ?? false).toBe(false);
    expect(h.state().sessions['s1']?.notes?.[0]).toMatchObject({ id: first?.id, sourceSeq: 5, text: '先检查代码。' });
    expect(h.state().sessions['s1']?.notes).toHaveLength(1);
  });

  it('restores an active stream baseline and separates simultaneous sessions before clearing on disconnect', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }, { sessionId: 's2', running: true }] });
    h.host.assistantBaselines.set('s1', { revision: 3, activeAttempt: { attemptId: 's1:1', turn: 1, step: 1, startedAfterSeq: 4, nextIndex: 2,
      stream: [{ type: 'text-chunks', index: 0, time0: 100, dt: [1], texts: ['重连', '前缀'] }] } });
    await h.adapter.connect(h.host.link());
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text).toBe('重连前缀');
    h.host.assistant('s1', { type: 'chunk', revision: 4, attemptId: 's1:1', index: 2, chunk: { type: 'text-delta', index: 0, text: '继续' } });
    h.host.assistant('s2', { type: 'start', revision: 1, attemptId: 's2:1', turn: 1, step: 1, startedAfterSeq: 2 });
    h.host.assistant('s2', { type: 'chunk', revision: 2, attemptId: 's2:1', index: 0, chunk: { type: 'text-delta', index: 0, text: '另一会话' } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text).toBe('重连前缀继续');
    await expect.poll(() => h.state().sessions['s2']?.notes?.[0]?.text).toBe('另一会话');
    h.adapter.disconnect();
    const snapshot = h.adapter.snapshot() as Extract<Frame, { kind: 'glass.snapshot' }>;
    expect(snapshot.payload.sessions.every(s => !s.notes?.some(n => n.streaming))).toBe(true);
    await h.adapter.connect(h.host.link());
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text).toBe('重连前缀');
    expect(h.state().sessions['s2']?.notes ?? []).toEqual([]);
  });

  it('starts following newly available agents immediately without waiting for list polling', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', agentAvailable: false }] });
    await h.adapter.connect(h.host.link());
    expect(h.host.openStreams).not.toContain('audit:s1');
    h.host.gateway({ type: 'emit', event: 'api-session/added', args: [{ sessionId: 's1', agentAvailable: true, running: true }] });
    await expect.poll(() => h.host.followRequests.get('s1')?.assistantStream, { timeout: 500, interval: 5 }).toBe(true);
    expect(h.host.requests.filter(r => r.method === 'session/list')).toHaveLength(1);
  });

  it('continues streaming across turn boundaries in the same Agent lifecycle', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.assistant('s1', { type: 'start', attemptId: 's1:1', revision: 1, turn: 1, step: 1, startedAfterSeq: 4 });
    h.host.assistant('s1', { type: 'chunk', attemptId: 's1:1', revision: 2, index: 0, chunk: { type: 'text-delta', index: 0, text: '第一轮' } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text).toBe('第一轮');
    h.host.audit('s1', { type: 'assistant/message', seq: 5, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一轮' }] } } });
    h.host.assistant('s1', { type: 'end', attemptId: 's1:1', revision: 3, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 5 } });
    h.host.audit('s1', { type: 'turn/end', seq: 6, data: { reason: { kind: 'completed' } } });
    h.host.audit('s1', { type: 'turn/start', seq: 7, data: { turn: 2 } });
    h.host.assistant('s1', { type: 'start', attemptId: 's1:2', revision: 4, turn: 2, step: 1, startedAfterSeq: 7 });
    h.host.assistant('s1', { type: 'chunk', attemptId: 's1:2', revision: 5, index: 0, chunk: { type: 'text-delta', index: 0, text: '第二轮实时内容' } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.[0]?.text, { timeout: 500, interval: 5 }).toBe('第二轮实时内容');
  });

  it('projects assistant transcript notes with reasoning and message kinds', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'assistant/message', data: { message: { content: [
      { type: 'reasoning', text: '  先读规范，再改协议。  ' },
      { type: 'text', text: '第一步已经完成。' },
      { type: 'text', text: '   ' },
    ] } } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.length, { timeout: 3000 }).toBe(2);
    const session = h.state().sessions['s1'];
    expect(session?.notes).toEqual([
      expect.objectContaining({ kind: 'message', text: '第一步已经完成。' }),
      expect.objectContaining({ kind: 'reasoning', text: '先读规范，再改协议。' }),
    ]);
    expect(h.state().sessions['s1']?.notes?.[0]?.sourceSeq).toEqual(expect.any(Number));
  });

  it('projects user prompts into the transcript and orders by session seq', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'user/message', seq: 4, data: { message: { content: [{ type: 'text', text: '  帮我看下这个目录  ' }] } } });
    h.host.audit('s1', { type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '好的。' }] } } });
    await expect.poll(() => h.state().sessions['s1']?.notes?.length, { timeout: 3000 }).toBe(2);
    const notes = h.state().sessions['s1']?.notes ?? [];
    expect(notes[0]).toMatchObject({ kind: 'message', text: '好的。', sourceSeq: 5 });
    expect(notes[1]).toMatchObject({ kind: 'user', text: '帮我看下这个目录', sourceSeq: 4 });
  });

  it('marks a tool activity complete when its result arrives', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', seq: 7, data: { callId: 'c9', name: 'pwsh', arguments: JSON.stringify({ command: 'Get-Date' }) } });
    await expect.poll(() => h.state().sessions['s1']?.activities?.[0]?.status, { timeout: 3000 }).toBe('running');
    h.host.audit('s1', { type: 'tool/result', seq: 8, data: { message: { toolCallId: 'c9', isError: false } } });
    await expect.poll(() => h.state().sessions['s1']?.activities?.[0]?.status, { timeout: 3000 }).toBe('success');
    expect(h.state().sessions['s1']?.activities?.[0]).toMatchObject({ toolName: 'pwsh', sourceSeq: 7, resultSummary: '工具执行完成' });
  });

  it('derives compact usage stats from cached session projections', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', stats: {
      sessionStats: { turns: 5, steps: 137, decodeMs: 625876, decodeTokens: 159154 },
      tokenUsage: { uncachedInputTokens: 404103, outputTokens: 159154, cacheReadTokens: 8790912, cacheWriteTokens: 0 },
      contextPressure: { projectedTokens: 103981, contextWindow: 1048576 },
    } }] });
    await h.adapter.connect(h.host.link());
    await expect.poll(() => h.state().sessions['s1']?.stats?.turns, { timeout: 3000 }).toBe(5);
    expect(h.state().sessions['s1']?.stats).toEqual({
      turns: 5, steps: 137, tokensPerSecond: 254, cacheHitPercent: 95.6, contextPercent: 9.9,
      tokens: { input: 404103, cacheRead: 8790912, cacheWrite: 0, output: 159154, total: 9354169 },
    });
  });

  it('keeps derived stats when a later snapshot carries only one projection key', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true, stats: {
      sessionStats: { turns: 5, steps: 137, decodeMs: 625876, decodeTokens: 159154 },
      tokenUsage: { uncachedInputTokens: 404103, outputTokens: 159154, cacheReadTokens: 8790912, cacheWriteTokens: 0 },
      contextPressure: { projectedTokens: 103981, contextWindow: 1048576 },
    } }] });
    await h.adapter.connect(h.host.link());
    await expect.poll(() => h.state().sessions['s1']?.stats?.turns, { timeout: 3000 }).toBe(5);
    h.host.snapshot('s1', { todos: [{ content: '后续步骤', status: 'pending' }] });
    await expect.poll(() => h.state().sessions['s1']?.todos.length, { timeout: 3000 }).toBe(1);
    expect(h.state().sessions['s1']?.stats).toMatchObject({ turns: 5, steps: 137, tokensPerSecond: 254 });
  });

  it('only actionables complete approvals and submits through the live delivery identity', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }) } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1', reason: '执行测试' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    const approval = h.state().approvals[0]!;
    expect(approval).toMatchObject({ toolName: 'bash', status: 'pending', actionable: true, displayDetails: 'complete', commandPreview: 'pnpm test' });
    expect(h.state().sessions['s1']?.phase).toBe('waiting-approval');
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    expect(() => assertApprovalResponse(h.state(), identity, 'allowed-once')).not.toThrow();
    await h.adapter.respondApproval(identity, 'allowed-once');
    const submitted = h.host.requests.find(request => request.method === '$events/result')!;
    expect(submitted.args).toMatchObject({ clientId: 'client-1', eventId: 'ev1', outcome: { kind: 'result', value: 'allowed-once' } });
    await expect.poll(() => h.state().approvals[0]?.status, { timeout: 3000 }).toBe('allowed-once');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    expect(h.state().sessions['s1']?.phase).toBe('working');
  });

  it('keeps approvals without verifiable arguments non-actionable', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', reason: '执行命令' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    const approval = h.state().approvals[0]!;
    expect(approval).toMatchObject({ displayDetails: 'partial', actionable: false });
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    expect(() => assertApprovalResponse(h.state(), identity, 'allowed-once')).toThrow();
    await expect(h.adapter.respondApproval(identity, 'allowed-once')).rejects.toThrow(/参数尚未完整/);
    expect(h.host.requests.some(request => request.method === '$events/result')).toBe(false);
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: JSON.stringify({ apiKey: 'sk-live-secret' }) } });
    h.host.waterfall({ eventId: 'ev2', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c2' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(2);
    const sensitive = h.state().approvals.find(item => item.callId === 'c2')!;
    expect(sensitive.displayDetails).toBe('partial');
    expect(sensitive.commandPreview).toMatch(/敏感字段/);
    expect(JSON.stringify(h.frames)).not.toContain('sk-live-secret');
  });

  it('finalizes cancelled approvals and host-rejected submissions', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"git push"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(1);
    h.host.gateway({ type: 'cancel', eventId: 'ev1' });
    await expect.poll(() => h.state().approvals[0]?.status, { timeout: 3000 }).toBe('cancelled');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '{"command":"deploy"}' } });
    h.host.waterfall({ eventId: 'ev2', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c2' } });
    await expect.poll(() => h.state().approvals.length, { timeout: 3000 }).toBe(2);
    const second = h.state().approvals[1]!;
    h.host.rejectResults = true;
    await expect(h.adapter.respondApproval({ runtimeId: second.runtimeId, sourceEpoch: second.sourceEpoch, sessionId: 's1', requestId: second.requestId }, 'rejected'))
      .rejects.toThrow(/审批提交失败/);
    await expect.poll(() => h.state().approvals[1]?.status, { timeout: 3000 }).toBe('unavailable');
    expect(h.state().approvals[1]?.actionable).toBe(false);
  });

  it('answers questions only through a live delivery and refuses foreign identities', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'q1-ev', agentId: 's1', event: 'user-questions/request', request: {
      wait: { callId: 'w1' }, questions: [{ id: 'q1', question: '选哪个?', options: [{ label: '甲' }, { label: '乙' }] }],
    } });
    await expect.poll(() => h.state().questions.length, { timeout: 3000 }).toBe(1);
    const question = h.state().questions[0]!;
    expect(question.actionable).toBe(true);
    expect(question.questions[0]).toMatchObject({ id: 'q1', type: 'single', allowCustom: true });
    const identity = { runtimeId: question.runtimeId, sourceEpoch: question.sourceEpoch, sessionId: 's1', requestId: question.requestId };
    const answers = [{ questionId: 'q1', values: ['乙'] }];
    expect(() => assertQuestionResponse(h.state(), identity, answers)).not.toThrow();
    expect(() => assertQuestionResponse(h.state(), { ...identity, requestId: 'approval:nope' }, answers)).toThrow();
    await h.adapter.respondQuestion(identity, answers);
    const submitted = h.host.requests.find(request => request.method === '$events/result')!;
    expect(submitted.args).toMatchObject({ eventId: 'q1-ev', outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['乙'] }] } } });
    await expect.poll(() => h.state().questions[0]?.status, { timeout: 3000 }).toBe('answered');
  });

  it('keeps a delivered question open when projections do not list it', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'q2-ev', agentId: 's1', event: 'user-questions/request', request: {
      wait: { callId: 'w2' }, questions: [{ id: 'q2', question: '要哪个?', options: [{ label: '甲' }, { label: '乙' }] }],
    } });
    await expect.poll(() => h.state().questions.length, { timeout: 3000 }).toBe(1);
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'userQuestions', value: { active: [], settled: [] } });
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(h.state().questions[0]?.status).toBe('pending');
    expect(h.state().questions[0]?.actionable).toBe(true);
  });

  it('fails closed when the host channel drops', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals[0]?.actionable, { timeout: 3000 }).toBe(true);
    const approval = h.state().approvals[0]!;
    const identity = { runtimeId: approval.runtimeId, sourceEpoch: approval.sourceEpoch, sessionId: 's1', requestId: approval.requestId };
    await h.host.stop();
    await expect.poll(() => h.state().connection, { timeout: 3000 }).toBe('disconnected');
    expect(h.state().approvals[0]?.actionable).toBe(false);
    await expect(h.adapter.respondApproval(identity, 'allowed-once')).rejects.toThrow(/失效/);
  });

  it('tracks session lifecycle events from the gateway', async () => {
    const h = await setup();
    await h.adapter.connect(h.host.link());
    expect(h.state().sessions).toEqual({});
    h.host.gateway({ type: 'emit', event: 'api-session/added', args: [{ sessionId: 's2', cwd: 'C:\\ws\\beta', running: true, agentAvailable: true, projections: { values: { title: '新会话' } } }] });
    await expect.poll(() => h.state().sessions['s2']?.title, { timeout: 3000 }).toBe('新会话');
    expect(h.host.openStreams).toContain('audit:s2');
    h.host.gateway({ type: 'emit', event: 'api-session/status', args: ['s2', false] });
    await expect.poll(() => h.state().sessions['s2']?.agentStatus, { timeout: 3000 }).toBe('idle');
    h.host.gateway({ type: 'emit', event: 'api-session/removed', args: ['s2'] });
    await expect.poll(() => h.state().sessions['s2'], { timeout: 3000 }).toBeUndefined();
  });

  it('does not activate cold history or label idle as a completed turn', async () => {
    const h = await setup({ seeds: [{ sessionId: 'cold', agentAvailable: false }, { sessionId: 'live-idle', agentAvailable: true }] });
    await h.adapter.connect(h.host.link());
    expect(h.host.openStreams).not.toContain('audit:cold');
    expect(h.host.openStreams).toContain('audit:live-idle');
    expect(h.state().sessions['cold']).toMatchObject({ agentStatus: 'idle', phase: 'unknown' });
    expect(h.state().sessions['live-idle']).toMatchObject({ agentStatus: 'idle', phase: 'unknown' });
  });

  it('maps object-shaped cancellation and failure reasons and clears todos at turn start', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'todo/write', data: { todos: [{ content: 'old', status: 'completed' }] } });
    await expect.poll(() => h.state().sessions['s1']?.todos.length).toBe(1);
    h.host.audit('s1', { type: 'turn/start', data: { turn: 2 } });
    await expect.poll(() => h.state().sessions['s1']?.todos.length).toBe(0);
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'aborted', reason: 'user' } } });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('cancelled');
    h.host.audit('s1', { type: 'turn/start', data: { turn: 3 } });
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'error', error: {} } } });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('error');
  });

  it('rejects ok:true with accepted:false instead of claiming approval success', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals[0]?.actionable).toBe(true);
    const a = h.state().approvals[0]!;
    h.host.rpc = () => false;
    await expect(h.adapter.respondApproval(a, 'allowed-once')).rejects.toThrow('审批提交失败');
    expect(h.state().approvals[0]?.status).toBe('unavailable');
    expect(h.state().approvals.some(a => a.status === 'allowed-once')).toBe(false);
  });

  it('keeps timed questions pending and answers continued requests without reusing cancelled deliveries', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    const items = [{ id: 'q1', question: '确认方案?', options: [{ label: '甲' }, { label: '乙' }] }];
    h.host.waterfall({ eventId: 'qev', agentId: 's1', event: 'user-questions/request', request: { wait: { callId: 'c1', timed: true }, questions: items } });
    await expect.poll(() => h.state().questions[0]?.actionable).toBe(true);
    h.host.rpc = method => method === 'session/projections' ? { values: { userQuestions: { active: [{ callId: 'c1', questions: items, state: 'continued' }], settled: [] } } } : true;
    h.host.gateway({ type: 'cancel', eventId: 'qev' });
    await expect.poll(() => h.host.requests.some(r => r.method === 'session/projections')).toBe(true);
    await expect.poll(() => h.state().questions[0]?.actionable).toBe(true);
    const q = h.state().questions[0]!;
    expect(q.status).toBe('pending');
    await h.adapter.respondQuestion(q, [{ questionId: 'q1', values: ['乙'] }]);
    expect(h.host.requests.find(r => r.method === 'userQuestions/answer')?.args).toEqual({ agentId: 's1', callId: 'c1', answer: { answers: [{ id: 'q1', selected: ['乙'] }] } });
    expect(h.host.requests.some(r => r.method === '$events/result')).toBe(false);
    expect(h.state().questions[0]?.status).toBe('answered');
  });

  it('answers a projection-only open question through userQuestions/answer', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    const items = [{ id: 'q1', question: '确认方案?', options: [{ label: '甲' }, { label: '乙' }] }];
    h.host.control({ type: 'projection', sessionId: 's1', key: 'userQuestions', value: { active: [{ callId: 'c1', questions: items, state: 'open' }], settled: [] } });
    await expect.poll(() => h.state().questions[0]?.actionable).toBe(true);
    const q = h.state().questions[0]!;
    await h.adapter.respondQuestion(q, [{ questionId: 'q1', values: ['甲'] }]);
    expect(h.host.requests.find(r => r.method === 'userQuestions/answer')?.args).toEqual({ agentId: 's1', callId: 'c1', answer: { answers: [{ id: 'q1', selected: ['甲'] }] } });
    expect(h.state().questions[0]?.status).toBe('answered');
  });

  it('correlates approval audit identities without using them as remote event IDs', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } });
    h.host.audit('s1', { type: 'approval/asked', data: { id: 'audit-id', callId: 'c1', toolName: 'bash' } });
    h.host.waterfall({ eventId: 'remote-id', agentId: 's1', event: 'approval/request', request: { callId: 'c1', toolName: 'bash' } });
    await expect.poll(() => h.state().approvals[0]?.actionable).toBe(true);
    expect(h.state().approvals).toHaveLength(1);
    const a = h.state().approvals[0]!;
    await h.adapter.respondApproval(a, 'rejected');
    expect(h.host.requests.find(r => r.method === '$events/result')?.args.eventId).toBe('remote-id');
  });

  it('accepts independent projection keys sharing a native sequence and rejects stale snapshots', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'title', value: '最新标题', seq: 10 });
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'todos', value: [{ content: '最新任务', status: 'in_progress' }], seq: 10 });
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'todos', value: [{ content: '旧任务', status: 'pending' }], seq: 9 });
    await expect.poll(() => h.state().sessions['s1']?.todos[0]?.content).toBe('最新任务');
    expect(h.state().sessions['s1']?.title).toBe('最新标题');
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'todos', value: [{ content: '后续任务', status: 'pending' }], seq: 11 });
    await expect.poll(() => h.state().sessions['s1']?.todos[0]?.content).toBe('后续任务');
    const updates = h.frames.filter((f): f is Extract<Frame, { kind: 'session.upserted' }> => f.kind === 'session.upserted');
    expect(updates.every((f, i) => i === 0 || f.payload.lastSourceSeq > updates[i - 1]!.payload.lastSourceSeq)).toBe(true);
  });

  it('does not resurrect completed questions from unrelated projection updates', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    const items = [{ id: 'q1', question: '颜色?', options: [{ label: '蓝' }] }];
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'userQuestions', value: { active: [{ callId: 'c1', state: 'continued', questions: items }] }, seq: 3 });
    await expect.poll(() => h.state().questions[0]?.actionable).toBe(true);
    await h.adapter.respondQuestion(h.state().questions[0]!, [{ questionId: 'q1', values: ['蓝'] }]);
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'title', value: 'Changed', seq: 4 });
    await expect.poll(() => h.state().sessions['s1']?.title).toBe('Changed');
    expect(h.state().questions[0]?.status).toBe('answered');
    expect(h.state().questions[0]?.actionable).toBe(false);
  });

  it('only calls explicitly completed turn endings finished', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'unrecognized' } } });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('unknown');
    expect(h.state().sessions['s1']?.agentStatus).toBe('idle');
    h.host.audit('s1', { type: 'turn/start', data: { turn: 2 } });
    h.host.audit('s1', { type: 'turn/end', data: {} });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('unknown');
    h.host.audit('s1', { type: 'turn/start', data: { turn: 3 } });
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind: 'completed' } } });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('finished');
  });

  it('keeps authoritative current-turn projections when the follow baseline replays historical starts', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.send('control', { type: 'projection', sessionId: 's1', key: 'todos', value: [{ content: '当前任务', status: 'in_progress' }], seq: 12 });
    await expect.poll(() => h.state().sessions['s1']?.todos[0]?.content).toBe('当前任务');
    h.host.send('audit:s1', { type: 'snapshot', projections: { asOfSeq: 10, values: { todos: [{ content: '旧任务', status: 'pending' }], turnBoundary: { openTurnStartSeq: 7 } } }, records: [
      { type: 'event', event: { type: 'turn/start', seq: 1, data: {} } },
      { type: 'event', event: { type: 'turn/end', seq: 5, data: { reason: { kind: 'completed' } } } },
    ] });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('working');
    expect(h.state().sessions['s1']?.todos[0]?.content).toBe('当前任务');
  });

  it('projects archive and gateway errors without inventing a successful completion', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.send('workspace', { type: 'archived', archivedSessionIds: ['s1'] });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('archived');
    h.host.send('workspace', { type: 'archived', archivedSessionIds: [] });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('working');
    h.host.gateway({ type: 'emit', event: 'api-session/error', args: ['s1', 'private diagnostic'] });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe('error');
    expect(h.state().sessions['s1']?.agentStatus).toBe('idle');
    expect(JSON.stringify(h.frames)).not.toContain('private diagnostic');
  });

  it('leaves an unconfirmed void submission unavailable after the receipt deadline', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    h.host.suppressDecision = true;
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'tool/call', data: { callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } });
    h.host.waterfall({ eventId: 'ev1', agentId: 's1', event: 'approval/request', request: { toolName: 'bash', callId: 'c1' } });
    await expect.poll(() => h.state().approvals[0]?.actionable).toBe(true);
    const response = h.adapter.respondApproval(h.state().approvals[0]!, 'allowed-once');
    expect(h.state().approvals[0]).toMatchObject({ status: 'submitting', actionable: false });
    await expect(response).rejects.toThrow('审批提交失败');
    expect(h.state().approvals[0]).toMatchObject({ status: 'unavailable', actionable: false });
    expect(h.state().approvals.some(a => a.status === 'allowed-once')).toBe(false);
  }, 15000);

  it.each([
    ['completed', 'finished'], ['error', 'error'], ['aborted', 'cancelled'], ['blocked', 'error'], ['max-tokens', 'limit-reached'], ['future-reason', 'unknown'],
  ])('maps the official %s turn-ending reason to %s', async (kind, phase) => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.audit('s1', { type: 'turn/end', data: { reason: { kind } } });
    await expect.poll(() => h.state().sessions['s1']?.phase).toBe(phase);
  });

  it('reads cold terminal boundaries through page without promoting historical Agents', async () => {
    const h = await setup();
    const ends = new Map([['done', 'completed'], ['failed', 'error'], ['stopped', 'aborted'], ['limited', 'max-tokens'], ['unknown', 'future-reason']]);
    h.host.rpc = (method, args) => {
      if (method === 'session/list') return { items: [...ends.keys()].map(sessionId => ({ sessionId, agentAvailable: false, running: false, projections: { kind: 'cached', asOfSeq: 42, values: { turnBoundary: { lastTurn: 9 } } } })) };
      if (method === 'session/page') {
        const request = object(args.request); const sessionId = String(object(request.address).sessionId);
        return { records: [{ type: 'event', event: { type: 'turn/end', seq: 42, data: { reason: { kind: ends.get(sessionId) } } } }], hasMore: false };
      }
      return true;
    };
    await h.adapter.connect(h.host.link());
    expect(Object.fromEntries(Object.entries(h.state().sessions).map(([id, s]) => [id, s.phase]))).toEqual({ done: 'finished', failed: 'error', stopped: 'cancelled', limited: 'limit-reached', unknown: 'unknown' });
    expect(h.host.requests.filter(r => r.method === 'session/page')).toHaveLength(5);
    expect(h.host.openStreams.some(s => s.startsWith('audit:'))).toBe(false);
    expect(h.host.requests.filter(r => r.method === 'session/page').every(r => object(r.args.request).throughSeq === 42 && object(r.args.request).maxMessages === 1)).toBe(true);
  });

  it('answers delivered questions through $events/result even without a wait call id', async () => {
    const h = await setup({ seeds: [{ sessionId: 's1', running: true }] });
    await h.adapter.connect(h.host.link());
    h.host.waterfall({ eventId: 'legacy', agentId: 's1', event: 'user-questions/request', request: { questions: [{ id: 'q1', question: '说明你的想法' }] } });
    await expect.poll(() => h.state().questions.length).toBe(1);
    const question = h.state().questions[0]!;
    expect(question.actionable).toBe(true);
    await h.adapter.respondQuestion(question, [{ questionId: 'q1', values: ['示例'] }]);
    const result = h.host.requests.find(r => r.method === '$events/result');
    expect(result).toBeTruthy();
    expect(object(result!.args).eventId).toBe('legacy');
    expect(JSON.stringify(object(result!.args).outcome)).toContain('示例');
    await expect.poll(() => h.state().questions[0]?.status).toBe('answered');
  });
});
