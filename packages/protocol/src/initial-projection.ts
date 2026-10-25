import type { Projection } from './index';

/** Renderer-safe state factory. Schema validation stays at the Main boundary. */
export function initialProjection(): Projection {
  return { connection: 'connecting', stale: true, source: null, runtimeId: null, epoch: null,
    capabilities: { observeSessions: false, observeTodos: false, observeTools: false, respondApproval: false, respondQuestion: false },
    sessions: {}, approvals: [], questions: [], seen: [], removedSessions: {} };
}
