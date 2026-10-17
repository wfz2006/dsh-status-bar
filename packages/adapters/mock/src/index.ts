import type { Frame, Session } from '@glass/protocol';

export const MOCK_RUNTIME = 'mock-runtime';
export const MOCK_EPOCH = 'mock-epoch-1';
const base = { protocolVersion: 1 as const, runtimeId: MOCK_RUNTIME, epoch: MOCK_EPOCH, sentAt: '2026-10-17T01:00:00.000Z' };
const initialSessions: Session[] = [
  { runtimeId: MOCK_RUNTIME, sessionId: 'demo-main', title: '构建 DSH Glass 悬浮伴侣', workspaceLabel: 'dsh-glass / 开发预览', agentStatus: 'running', phase: 'working', lastSourceSeq: 1,
    todos: [{ content: '梳理项目与接口边界', status: 'completed' }, { content: '搭建本地通信桥', status: 'in_progress' }, { content: '验证悬浮窗与状态同步', status: 'pending' }], activities: [] },
  { runtimeId: MOCK_RUNTIME, sessionId: 'demo-other', title: '视觉探索', workspaceLabel: 'design / Mock', agentStatus: 'idle', phase: 'unknown', lastSourceSeq: 1,
    todos: [{ content: '整理设计参考', status: 'pending' }], activities: [] },
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
    { ...base, messageId: 'tool-3', kind: 'session.tool.activity', payload: { sessionId: 'demo-main', sourceSeq: 3, callId: 'mock-call-1', toolName: 'read_file', summary: '查看协议与状态模型 · Mock 事件', } },
    { ...base, messageId: 'todos-4', kind: 'session.todo.snapshot', payload: { sessionId: 'demo-main', sourceSeq: 4, todos: [
      { content: '梳理项目与接口边界', status: 'completed' }, { content: '验证悬浮窗与状态同步', status: 'in_progress' },
    ] } },
    { ...base, messageId: 'approval-5', kind: 'approval.requested', payload: { requestId: 'mock-approval-1', runtimeId: MOCK_RUNTIME, sessionId: 'demo-main', toolName: 'bash', callId: 'mock-call-2', reason: '这是只读的模拟审批卡片，没有连接 DSH。', commandPreview: 'echo "DSH Glass preview"', displayDetails: 'partial', status: 'pending', actionable: false, createdAt: base.sentAt, sourceEpoch: MOCK_EPOCH } },
  ];
}
export function mockFrames(): Frame[] { return [mockWelcome(), mockSnapshot(), ...mockDeltas()]; }

export type MockScenario = 'normal' | 'out-of-order' | 'disconnect';
export function createMockAdapter(publish: (f: Frame) => void, disconnect: () => void, scenario: MockScenario = 'normal') {
  let timers: ReturnType<typeof setTimeout>[] = [];
  let snapshot = mockSnapshot();
  function stop() { timers.forEach(clearTimeout); timers = []; }
  function start() {
    stop(); snapshot = mockSnapshot();
    const frames = mockDeltas();
    if (scenario === 'out-of-order') frames.push(frames[0]!);
    frames.forEach((f, i) => timers.push(setTimeout(() => {
      if (snapshot.kind === 'glass.snapshot' && (f.kind === 'session.todo.snapshot' || f.kind === 'session.tool.activity')) {
        snapshot = { ...snapshot, payload: { ...snapshot.payload, sessions: snapshot.payload.sessions.map(s => {
          if (!('sessionId' in f.payload) || f.payload.sessionId !== s.sessionId || f.payload.sourceSeq <= s.lastSourceSeq) return s;
          if (f.kind === 'session.todo.snapshot') return { ...s, todos: f.payload.todos, lastSourceSeq: f.payload.sourceSeq };
          if (f.kind === 'session.tool.activity') return { ...s, activities: [f.payload, ...s.activities].slice(0, 100), lastSourceSeq: f.payload.sourceSeq };
          return s;
        }) } };
      }
      if (snapshot.kind === 'glass.snapshot' && f.kind === 'approval.requested') snapshot = { ...snapshot, payload: { ...snapshot.payload, approvals: [f.payload] } };
      publish(f);
    }, (i + 1) * 1800)));
    if (scenario === 'disconnect') timers.push(setTimeout(disconnect, 8500));
  }
  let revision = 0;
  return { start, stop, welcome: mockWelcome, snapshot: () => ({ ...snapshot, messageId: `snapshot-${++revision}` }) };
}
