import type { Frame, LocalEvent, Projection } from '@glass/protocol';

/** Snapshot installation and session selection establish a pose without replaying old events. */
export function poolEvent(previous: Projection, next: Projection, event: Frame | LocalEvent, selected: string, liveCompletion?: boolean) {
  if (previous === next || !selected || previous.stale || next.stale ||
      previous.connection !== 'connected' || next.connection !== 'connected' ||
      previous.runtimeId !== next.runtimeId || previous.epoch !== next.epoch) return;
  if (event.kind === 'session.upserted' || event.kind === 'session.updated') {
    if (event.payload.sessionId !== selected || next.sessions[selected]?.phase !== 'finished') return;
    const before = previous.sessions[selected];
    if (!before || before.phase === 'finished') return;
    // DSH may publish idle immediately before its authoritative turn/end arrives.
    const wasRunning = ['working', 'waiting-approval', 'waiting-question'].includes(before.phase) ||
      before.phase === 'unknown' && ['running', 'starting', 'stopping'].includes(before.agentStatus);
    if (liveCompletion ?? wasRunning) return 'completed' as const;
  }
  if (event.kind === 'approval.requested' || event.kind === 'question.requested') {
    const { sessionId, requestId, status } = event.payload;
    const target = next.sessions[sessionId];
    if (sessionId === selected || status !== 'pending' || !target ||
        ['finished','cancelled','archived','error','limit-reached'].includes(target.phase)) return;
    const queue = event.kind === 'approval.requested' ? previous.approvals : previous.questions;
    if (!queue.some(r => r.sessionId === sessionId && r.requestId === requestId)) return 'other-request' as const;
  }
}
