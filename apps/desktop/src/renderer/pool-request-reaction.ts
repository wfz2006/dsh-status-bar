import type { DesktopProjection, RequestKind, SubmissionResult } from '../shared/api';
import { requestKey } from './request-model';
import type { Task } from './task-views';
import type { PoolSceneFacts } from './pool-scene';

export type ViewedRequest = { kind: RequestKind; key: string };

export function activePoolRequest(task: Task, viewed?: ViewedRequest) {
  const approvals = task.pending;
  const questions = task.questions;
  return (viewed?.kind === 'approval' ? approvals.find(r => requestKey(r) === viewed.key)
    : viewed?.kind === 'question' ? questions.find(r => requestKey(r) === viewed.key) : undefined) ?? approvals[0] ?? questions[0];
}

export function poolRequestReaction(task: Task, projection: DesktopProjection, selected: string, results: SubmissionResult[],
  active = activePoolRequest(task), showingRequests = false): PoolSceneFacts['reaction'] {
  if (projection.stale || projection.connection !== 'connected') return;
  const matching = results.filter(r => r.identity.runtimeId === projection.runtimeId && r.identity.sourceEpoch === projection.epoch &&
    r.identity.sessionId === selected);
  if (active) {
    const kind = 'questions' in active ? 'question' : 'approval';
    const receipt = matching.find(r => r.kind === kind && r.identity.requestId === active.requestId);
    if (receipt?.status === 'confirmed') return 'sent';
    if (active.status === 'submitting' || receipt?.status === 'submitting') return 'submitting';
    if (receipt?.status === 'unconfirmed') return 'unconfirmed';
    if (!active.actionable) return 'readonly';
    return kind === 'question' ? 'answering' : 'approval';
  }
  // IPC and projection updates can arrive in either order. Keep waiting for
  // our scoped receipt even if the corresponding request has already closed.
  if (matching.some(r => r.status === 'submitting')) return 'submitting';
  if (showingRequests && matching[0]?.status === 'unconfirmed') return 'unconfirmed';
  if (showingRequests && matching[0]?.status === 'confirmed' && task.status.startsWith('waiting_')) return 'sent';
}
