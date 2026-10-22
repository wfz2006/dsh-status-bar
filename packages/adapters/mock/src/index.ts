import type { Frame, Session } from '@glass/protocol';

export const MOCK_RUNTIME = 'mock-runtime';
export const MOCK_EPOCH = 'mock-epoch-1';
const base = { protocolVersion: 1 as const, runtimeId: MOCK_RUNTIME, epoch: MOCK_EPOCH, sentAt: '2026-10-17T01:00:00.000Z' };
const initialSessions: Session[] = [
  { runtimeId: MOCK_RUNTIME, sessionId: 'demo-main', title: '构建 DSH Glass 悬浮伴侣', workspaceLabel: 'dsh-glass / 开发预览', agentStatus: 'running', phase: 'working', lastSourceSeq: 1,
    todos: [{ content: '梳理项目与接口边界', status: 'completed' }, { content: '搭建本地通信桥', status: 'in_progress' }, { content: '验证悬浮窗与状态同步', status: 'pending' }], activities: [],
    notes: [
      { id: 'mock-note-1', kind: 'message', text: '先把协议里的活动数据梳理清楚，再决定过程视图复用哪些字段。', sourceSeq: 1 },
      { id: 'mock-note-2', kind: 'reasoning', text: '过程页要像 DSH 的转录一样按时间排列：先思考，再调用工具，最后给出结果。', sourceSeq: 2 },
      { id: 'mock-note-0', kind: 'user', text: '帮我梳理一下这个仓库的结构，并说明过程视图该怎么设计。', sourceSeq: 0 },
    ],
    stats: { turns: 3, steps: 42, tokensPerSecond: 218, cacheHitPercent: 96.4, contextPercent: 7.2, tokens: { input: 18_400, cacheRead: 1_240_000, cacheWrite: 0, output: 21_800, total: 1_280_200 } } },
  { runtimeId: MOCK_RUNTIME, sessionId: 'demo-other', title: '视觉探索', workspaceLabel: 'design / Mock', agentStatus: 'idle', phase: 'unknown', lastSourceSeq: 1,
    todos: [{ content: '整理设计参考', status: 'pending' }], activities: [],
    stats: { turns: 2, steps: 11, tokensPerSecond: 154, cacheHitPercent: 91.3, contextPercent: 4.1, tokens: { input: 9_800, cacheRead: 410_000, cacheWrite: 0, output: 12_400, total: 432_200 } } },
];
export function mockWelcome(): Frame {
  return { ...base, messageId: 'welcome', kind: 'glass.welcome', payload: { source: 'mock', capabilities: {
    observeSessions: true, observeTodos: true, observeTools: true, respondApproval: false, respondQuestion: false,
  } } };
}
export function mockSnapshot(): Frame {
  return { ...base, messageId: 'snapshot', kind: 'glass.snapshot', payload: { sessions: structuredClone(initialSessions), approvals: [] } };
}
export function mockDeltas(): Frame[] {
  return [
    { ...base, messageId: 'todos-2', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 2, todos: initialSessions[0]!.todos } },
    { ...base, messageId: 'tool-3', kind: 'session.tool.activity', payload: { sessionId: 'demo-main', sourceSeq: 3, callId: 'mock-call-1', toolName: 'read_file', summary: 'packages/protocol/src/index.ts', } },
    { ...base, messageId: 'todos-4', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 4, todos: [
      { content: '梳理项目与接口边界', status: 'completed' }, { content: '验证悬浮窗与状态同步', status: 'in_progress' },
    ] } },
    { ...base, messageId: 'approval-5', kind: 'approval.requested', payload: { requestId: 'mock-approval-1', runtimeId: MOCK_RUNTIME, sessionId: 'demo-main', toolName: 'bash', callId: 'mock-call-2', reason: '这是只读的模拟审批卡片，没有连接 DSH。', commandPreview: 'echo "DSH Glass preview"', displayDetails: 'partial', status: 'pending', actionable: false, createdAt: base.sentAt, sourceEpoch: MOCK_EPOCH } },
    { ...base, messageId: 'note-6', kind: 'session.note', payload: { sessionId: 'demo-main', note: { id: 'mock-note-6', kind: 'reasoning', text: '过程视图需要同时展示思考与工具调用，才能还原 DSH 的工作节奏。', sourceSeq: 6 } } },
    { ...base, messageId: 'note-7', kind: 'session.note', payload: { sessionId: 'demo-main', note: { id: 'mock-note-7', kind: 'message', text: '已确认协议里可以携带活动与说明，接下来补齐过程页的图标与展开详情。', sourceSeq: 7 } } },
    { ...base, messageId: 'result-8', kind: 'session.tool.activity', payload: { sessionId: 'demo-main', sourceSeq: 8, callId: 'mock-call-1', toolName: 'read_file', summary: 'packages/protocol/src/index.ts', status: 'success', resultSummary: '工具执行完成' } },
  ];
}
export function mockFrames(): Frame[] { return [mockWelcome(), mockSnapshot(), ...mockDeltas()]; }

export type MockScenario = 'normal' | 'out-of-order' | 'disconnect' | 'approval-queue' | 'edge-cases' | 'completed' | 'long-approval';
export function createMockAdapter(publish: (f: Frame) => void, disconnect: () => void, scenario: MockScenario = 'normal') {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let snapshot = mockSnapshot();
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function start() {
    stop(); snapshot = mockSnapshot();
    const frames = scenario === 'edge-cases' ? [] : mockDeltas();
    if (scenario === 'long-approval') {
      const index = frames.findIndex(f => f.kind === 'approval.requested');
      const approval = frames[index];
      if (approval?.kind === 'approval.requested') frames[index] = { ...approval, payload: { ...approval.payload, commandPreview: Array.from({ length: 30 }, (_, i) => 'echo "Mock line ' + (i + 1) + ' · C:/Mock Workspace/very-long-path/verification-only"').join('\n') + '\n# END OF MOCK PREVIEW', reason: '这是长命令只读夹具，不会执行。'.repeat(8) } };
    }
    if (scenario === 'completed') {
      frames.splice(3);
      frames.push({ ...base, messageId: 'finished-6', kind: 'session.updated', payload: { sessionId: 'demo-main', sourceSeq: 6, fields: { agentStatus: 'idle', phase: 'finished' } } });
    }
    if (scenario === 'edge-cases' && snapshot.kind === 'glass.snapshot') snapshot = { ...snapshot, payload: { ...snapshot.payload, sessions: snapshot.payload.sessions.map(s => ({ ...s, title: '长中文任务：验证不同显示缩放、窄窗口、没有 Todo 以及复杂背景下的可读性。', todos: [] })) } };
    if (scenario === 'approval-queue') {
      const approval = frames.find(f => f.kind === 'approval.requested');
      if (approval?.kind === 'approval.requested') frames.push({ ...approval, messageId: 'approval-6', payload: { ...approval.payload, requestId: 'mock-approval-2', callId: 'mock-call-3', commandPreview: 'echo "Second independent Mock request"' } });
    }
    if (scenario === 'out-of-order') frames.push(frames[0]!);
    frames.forEach((f, i) => timers.push(setTimeout(() => {
      if (snapshot.kind === 'glass.snapshot' && (f.kind === 'session.todo.snapshot' || f.kind === 'session.tool.activity' || f.kind === 'session.note' || f.kind === 'session.updated')) {
        snapshot = { ...snapshot, payload: { ...snapshot.payload, sessions: snapshot.payload.sessions.map(s => {
          const seq = f.kind === 'session.note' ? f.payload.note.sourceSeq : f.payload.sourceSeq;
          if (!('sessionId' in f.payload) || f.payload.sessionId !== s.sessionId || seq <= s.lastSourceSeq) return s;
          if (f.kind === 'session.todo.snapshot') return { ...s, todos: f.payload.todos, lastSourceSeq: seq };
          if (f.kind === 'session.tool.activity') return { ...s, activities: [f.payload, ...s.activities.filter(a => a.callId !== f.payload.callId)].slice(0, 100), lastSourceSeq: seq };
          if (f.kind === 'session.note') return { ...s, notes: [f.payload.note, ...(s.notes ?? [])].slice(0, 60), lastSourceSeq: seq };
          if (f.kind === 'session.updated') return { ...s, ...f.payload.fields, lastSourceSeq: seq };
          return s;
        }) } };
      }
      if (snapshot.kind === 'glass.snapshot' && f.kind === 'approval.requested') snapshot = { ...snapshot, payload: { ...snapshot.payload, approvals: [...snapshot.payload.approvals.filter(a => a.sessionId !== f.payload.sessionId || a.requestId !== f.payload.requestId), f.payload] } };
      publish(f);
    }, (i + 1) * 1800)));
    if (scenario === 'disconnect') timers.push(setTimeout(disconnect, 8500));
  }
  let revision = 0;
  return { start, stop, welcome: mockWelcome, snapshot: () => ({ ...snapshot, messageId: `snapshot-${++revision}` }) };
}
