import { create } from 'zustand';
import { initialProjection } from '@glass/protocol/initial-projection';
import type { DesktopProjection } from '../shared/api';
import { EMPTY_QUESTION_DRAFT, requestKey, type QuestionDraft } from './request-model';

function activeQuestions(projection: DesktopProjection) {
  return projection.questions.filter(q => {
    const session = Object.hasOwn(projection.sessions, q.sessionId) ? projection.sessions[q.sessionId] : undefined;
    return q.runtimeId === projection.runtimeId && q.sourceEpoch === projection.epoch &&
      (!session || !['finished', 'cancelled', 'archived', 'error', 'limit-reached'].includes(session.phase)) &&
      (q.status === 'pending' || q.status === 'submitting');
  });
}

// Across transport epochs, restore only editable text/choices for the identical
// durable question on the same authenticated host. Never carry a submission.
function durableKey(request: DesktopProjection['questions'][number]) {
  return JSON.stringify([request.sessionId, request.requestId, request.questions.map(q => [
    q.id, q.type, q.question, !!q.allowCustom, q.options?.map(o => [o.label, o.description ?? '']) ?? [],
  ])]);
}

export const useGlass = create<{
  projection: DesktopProjection;
  selected: string;
  drafts: Record<string, QuestionDraft>;
  heldDrafts: Record<string, QuestionDraft>;
  replace: (projection: DesktopProjection) => void;
  updateDraft: (key: string, update: (draft: QuestionDraft) => QuestionDraft) => void;
}>(set => ({
  projection: initialProjection(), selected: 'demo-main', drafts: {}, heldDrafts: {},
  replace: projection => set(state => {
    const selected = projection.selectedSession ??
      (Object.hasOwn(projection.sessions, state.selected) ? state.selected : Object.keys(projection.sessions)[0] ?? '');
    if (!Object.keys(state.drafts).length && !Object.keys(state.heldDrafts).length) return { projection, selected };
    const sameHost = !!projection.draftScope && projection.draftScope === state.projection.draftScope;
    const heldDrafts = sameHost ? { ...state.heldDrafts } : {};
    if (sameHost && (projection.stale || projection.epoch !== state.projection.epoch || projection.runtimeId !== state.projection.runtimeId)) {
      for (const q of activeQuestions(state.projection)) {
        const draft = state.drafts[requestKey(q)];
        if (q.requestId.startsWith('question:') && q.status === 'pending' && draft?.stage === 'idle') {
          heldDrafts[durableKey(q)] = draft;
        }
      }
    }
    const fresh = projection.connection === 'connected' && !projection.stale;
    const drafts: Record<string, QuestionDraft> = {};
    const previousQuestions = new Map(activeQuestions(state.projection).map(q => [requestKey(q), q]));
    for (const q of activeQuestions(projection)) {
      const key = requestKey(q);
      const previous = previousQuestions.get(key);
      const sameQuestion = previous && (q.questions === previous.questions || durableKey(q) === durableKey(previous));
      const existing = sameQuestion && projection.draftScope === state.projection.draftScope ? state.drafts[key] : undefined;
      const restored = fresh && q.status === 'pending' && Object.hasOwn(projection.sessions, q.sessionId) ? heldDrafts[durableKey(q)] : undefined;
      if (existing || restored) drafts[key] = existing ?? restored!;
    }
    return { projection, selected, drafts, heldDrafts: fresh ? {} : heldDrafts };
  }),
  updateDraft: (key, update) => set(state => activeQuestions(state.projection).some(q => requestKey(q) === key)
    ? { drafts: { ...state.drafts, [key]: update(state.drafts[key] ?? EMPTY_QUESTION_DRAFT) } }
    : state),
}));
