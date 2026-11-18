import type { Connection } from '@glass/protocol';
import type { Task } from './task-views';

export type PoolSceneFacts = {
  connection: Connection;
  scope?: string;
  viewedRequest?: { kind: 'question' | 'approval'; key: string };
  reaction?: 'answering' | 'approval' | 'submitting' | 'sent' | 'unconfirmed' | 'readonly';
  otherPending: boolean;
  cue?: { id: number; kind: 'completed' | 'other-request' | 'typing' };
};

type SceneName = Task['status'] | Exclude<Connection, 'connected'>;
const restingClips = {
  empty: 'shallows', unknown: 'sound', starting: 'launch', stopping: 'brake',
  idle: 'idle', running: 'work', waiting_answer: 'listen', waiting_approval: 'wait',
  error: 'steady', limit_reached: 'breathe', cancelled: 'moor', archived: 'sleep',
  completed: 'settled', disconnected: 'sink', connecting: 'locate', reconnecting: 'search', incompatible: 'guard',
} as const satisfies Record<SceneName, string>;

export function poolScene(status: Task['status'], facts: PoolSceneFacts) {
  const name = facts.connection === 'connected' ? status : facts.connection;
  const online = status !== 'disconnected' && facts.connection === 'connected';
  const reaction = online ? facts.reaction : undefined;
  const question = facts.viewedRequest ? facts.viewedRequest.kind === 'question' : status === 'waiting_answer';
  const overlays = {
    answering: 'listen', approval: 'wait', submitting: 'hold', sent: 'received', unconfirmed: 'uncertain',
    readonly: question ? 'observeQuestion' : 'observeApproval',
  } as const;
  return { name, online, reaction, viewedRequest: facts.viewedRequest, base: reaction ? overlays[reaction] : restingClips[name] };
}

type Scene = ReturnType<typeof poolScene>;
type PlayContext = { scene: Scene; session?: string; scope?: string; animate: boolean; answering: boolean; otherPending: boolean };
type SceneActor = Pick<WhaleAnimator, 'action' | 'setBase' | 'play'>;

/** A cue is consumed even when its window is hidden, motion is reduced or its session has gone away. */
export class PoolScenePlayer {
  private previous?: PlayContext;
  private cueId = -1;

  update(actor: SceneActor, next: PlayContext, cue: PoolSceneFacts['cue']) {
    const previous = this.previous;
    this.previous = next;
    const fresh = !!cue && cue.id > this.cueId;
    if (fresh) this.cueId = cue.id;

    const boundary = !previous || previous.session !== next.session || previous.scope !== next.scope ||
      previous.animate !== next.animate || previous.scene.online !== next.scene.online;
    const stopNod = actor.action === 'nod' && (!next.answering || next.scene.reaction !== 'answering' ||
      previous?.scene.viewedRequest?.key !== next.scene.viewedRequest?.key ||
      previous?.scene.viewedRequest?.kind !== next.scene.viewedRequest?.kind);
    if (boundary || previous.scene.name !== next.scene.name || previous.scene.base !== next.scene.base ||
        actor.action === 'glance' && !next.otherPending || stopNod) {
      actor.setBase(next.scene.base, boundary || stopNod);
    }
    if (boundary || !next.animate || !next.scene.online) return;

    if (fresh && cue.kind === 'completed' && next.scene.name === 'completed' && !next.scene.reaction) {
      actor.play('happy', 'cue');
    } else if (fresh && cue.kind === 'typing' && next.answering && next.scene.reaction === 'answering') {
      actor.play('nod', 'cue');
    } else if (fresh && cue.kind === 'other-request' && next.otherPending && actor.action !== 'happy') {
      actor.play('glance', 'cue');
    } else if (previous.scene.name !== next.scene.name && !next.scene.reaction) {
      // Entry gestures describe changes observed in this session. A restored snapshot rests in its own pose.
      if (next.scene.name === 'error') actor.play('recoil', 'transition');
      if (next.scene.name === 'cancelled') actor.play('slowStop', 'transition');
      if (next.scene.name === 'archived') actor.play('farewell', 'transition');
      if ((next.scene.name === 'starting' || next.scene.name === 'running') &&
          (previous.scene.name === 'error' || previous.scene.name === 'limit_reached')) actor.play('restart', 'transition');
    }
  }
}
