import { afterEach, describe, expect, it, vi } from 'vitest';
import { poolScene, PoolScenePlayer, type PoolSceneFacts } from '../apps/desktop/src/renderer/pool-scene';
import type { Task } from '../apps/desktop/src/renderer/task-views';
import '../apps/desktop/src/renderer/vendor/whale-motion.js';

const connected: PoolSceneFacts = { connection: 'connected', otherPending: false };
const statuses: Task['status'][] = ['empty','unknown','starting','stopping','idle','running','waiting_answer',
  'waiting_approval','error','limit_reached','cancelled','archived','completed','disconnected'];

function context(status: Task['status'], facts = connected) {
  return { scene: poolScene(status, facts), session: 'a', scope: 'epoch 1', animate: true, answering: false, otherPending: facts.otherPending };
}

function recordActor() {
  return {
    action: 'idle', cues: [] as string[], transitions: [] as string[],
    setBase(name: string) { this.action = name; return true; },
    play(name: string, reason?: string) {
      this.action = name;
      if (reason === 'cue') this.cues.push(name);
      if (reason === 'transition') this.transitions.push(name);
      return true;
    },
  };
}

describe('native pool scene choreography', () => {
  it('uses distinct held silhouettes for every real task/transport state, including a static Canvas2D frame', () => {
    const scenes = statuses.map(status => poolScene(status, connected));
    for (const connection of ['connecting','reconnecting','incompatible'] as const) {
      const scene = poolScene('disconnected', { ...connected, connection, reaction: 'sent' });
      expect(scene.name).toBe(connection);
      expect(scene.reaction).toBeUndefined();
      scenes.push(scene);
    }
    expect(scenes.slice(0, statuses.length).map(scene => scene.name)).toEqual(statuses);
    expect(new Set(scenes.map(scene => scene.base)).size).toBe(scenes.length);
    const stills = scenes.map(({ base }) => {
      expect(WhaleMotion.clips[base]?.loop).toBe(true);
      const { x, y, roll, yaw } = WhaleMotion.sample(base, .38);
      return [x,y,roll,yaw].map(value => value.toFixed(2)).join(',');
    });
    expect(new Set(stills).size).toBe(stills.length);
  });

  it('holds request postures until the lifecycle changes and keeps a read-only question distinct from approval', () => {
    const reactions = ['answering','approval','submitting','sent','unconfirmed','readonly'] as const;
    const clips = reactions.map(reaction => poolScene('waiting_answer', { ...connected, reaction }).base);
    expect(new Set(clips).size).toBe(reactions.length);
    for (const clip of clips) expect(WhaleMotion.clips[clip]?.loop).toBe(true);
    expect(poolScene('waiting_approval', { ...connected, reaction: 'readonly' }).base).not.toBe(clips.at(-1));
    expect(poolScene('waiting_approval', { ...connected, reaction: 'readonly', viewedRequest: { kind: 'question', key: 'q' } }).base).toBe(clips.at(-1));
    expect(poolScene('disconnected', { ...connected, reaction: 'answering' }).base).toBe('sink');
  });

  it('plays a newly finished cue once; opening a finished snapshot, hiding, switching sessions, restoring and remounting stay quiet', () => {
    const player = new PoolScenePlayer(), actor = recordActor(), done = context('completed');
    const cue = { id: 10, kind: 'completed' } as const;
    player.update(actor, done, cue);
    expect(actor.action).toBe('settled');
    player.update(actor, context('running'), undefined);
    player.update(actor, done, undefined);
    expect(actor.action).toBe('settled');
    player.update(actor, done, { ...cue, id: 11 });
    player.update(actor, done, { ...cue, id: 11 });
    expect(actor.cues).toEqual(['happy']);
    player.update(actor, { ...done, animate: false }, { ...cue, id: 12 });
    player.update(actor, done, { ...cue, id: 12 });
    player.update(actor, { ...done, session: 'b' }, { ...cue, id: 13 });
    player.update(actor, done, { ...cue, id: 13 });
    player.update(actor, context('disconnected', { ...connected, connection: 'reconnecting' }), undefined);
    player.update(actor, { ...done, scope: 'epoch 2' }, { ...cue, id: 14 });
    new PoolScenePlayer().update(actor, done, { ...cue, id: 14 });
    expect(actor.action).toBe('settled');
    expect(actor.cues).toEqual(['happy']);
  });

  it('glances only for real other-session attention and nods only for input in the active writable form', () => {
    const player = new PoolScenePlayer(), actor = recordActor();
    const work = context('running'), listening = context('waiting_answer', { ...connected, reaction: 'answering' });
    player.update(actor, work, undefined);
    player.update(actor, work, { id: 1, kind: 'other-request' });
    player.update(actor, { ...work, otherPending: true }, { id: 2, kind: 'other-request' });
    expect(actor.action).toBe('glance');
    player.update(actor, work, undefined);
    expect(actor.action).toBe('work');
    player.update(actor, listening, { id: 3, kind: 'typing' });
    player.update(actor, { ...listening, answering: true }, { id: 4, kind: 'typing' });
    expect(actor.action).toBe('nod');
    player.update(actor, { ...context('waiting_answer', { ...connected, reaction: 'answering', viewedRequest:{ kind: 'question', key:'new' } }), answering:true }, undefined);
    expect(actor.action).toBe('listen');
    player.update(actor, { ...context('waiting_answer', { ...connected, reaction: 'submitting' }), answering: true }, { id: 5, kind: 'typing' });
    expect(actor.action).toBe('hold');
    expect(actor.cues).toEqual(['glance','nod']);
  });

  it('brakes and recovers on observed changes in the same session, while reconnecting adopts the fresh sustained pose', () => {
    const player = new PoolScenePlayer(), actor = recordActor();
    player.update(actor, context('running'), undefined);
    player.update(actor, context('error'), undefined);
    expect(actor.action).toBe('recoil');
    player.update(actor, context('starting'), undefined);
    expect(actor.action).toBe('restart');
    player.update(actor, context('disconnected'), undefined);
    player.update(actor, context('archived'), undefined);
    expect(actor.action).toBe('sleep');
    expect(actor.transitions).toEqual(['recoil','restart']);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('returns from a one-shot to its current native base and leaves no animation frames in reduced or hidden mode', () => {
  const noop = () => {};
  const draw = { scale: noop, fill: noop, setTransform: noop, clearRect: noop, save: noop, translate: noop, rotate: noop,
    drawImage: noop, restore: noop, beginPath: noop, arc: noop, stroke: noop, fillRect: noop, closePath: noop,
    moveTo: noop, rect: noop, bezierCurveTo: noop, clip: noop, createLinearGradient: () => ({ addColorStop: noop }) };
  const canvas = () => ({ getContext: (kind: string) => kind === '2d' ? draw : null, addEventListener: noop, removeEventListener: noop }) as unknown as HTMLCanvasElement;
  let sequence = 0, time = 0;
  const frames = new Map<number, FrameRequestCallback>();
  function advance(count: number) {
    for (let frame = 0; frame < count; frame++) {
      time += 16;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    }
  }
  vi.stubGlobal('document', { createElement: canvas });
  vi.stubGlobal('Path2D', class {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const actor = new WhaleMotion.Animator(canvas(), canvas(), { showNative: false, travel: false });
  actor.resize(150, 160);
  actor.setAutonomous(false);
  actor.setBase('settled', true);
  actor.play('happy', 'cue');
  advance(190);
  expect(actor.action).toBe('settled');
  actor.setBase('work');
  actor.play('glance', 'cue');
  advance(100);
  expect(actor.action).toBe('work');
  actor.setReduced(true);
  expect(frames.size).toBe(0);
  actor.setBase('search');
  expect(frames.size).toBe(0);
  actor.setReduced(false);
  expect(frames.size).toBe(1);
  actor.setVisible(false);
  expect(frames.size).toBe(0);
  actor.destroy();
});
