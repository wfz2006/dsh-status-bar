import { useLayoutEffect, useRef, type RefObject } from 'react';
import { EDGE_ORB_SIZE, type EdgeMotion } from '../shared/edge-dock';
import type { CapsuleMotion, deriveTask } from '../shared/view-model';
import type { Bounds } from '../shared/window';
import { CapsuleEdgeOrb, TaskCapsule } from './task-views';

const place = ({ x, y, width, height }: Bounds) => ({ left: x, top: y, width, height });
const contour = ({ x, y, width, height }: Bounds, radius: number) => ({
  '--edge-x': `${x}px`, '--edge-y': `${y}px`,
  '--edge-width': `${width}px`, '--edge-height': `${height}px`,
  '--edge-radius': `${radius}px`,
});

export function CapsuleEdgeMotion({ surface, motion, task, style, feedback, pool }: {
  surface: RefObject<HTMLElement | null>;
  motion: EdgeMotion;
  task: ReturnType<typeof deriveTask>;
  style: CapsuleMotion;
  feedback: boolean;
  pool: boolean;
}) {
  const capsule = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = surface.current, caption = capsule.current, drop = orb.current;
    if (!host || !drop) return;
    const { direction, duration, startedAt } = motion;
    const gather = direction === 'gather';
    const order = (open: Keyframe, closed: Keyframe) => gather ? [open, closed] : [closed, open];
    const easing = gather ? 'cubic-bezier(.44,.04,.22,1)' : 'cubic-bezier(.33,.05,.23,1)';
    const options: KeyframeAnimationOptions = { duration, fill: 'both', easing };
    const animations: Animation[] = [];
    const closedWhale = drop.querySelector('.whale-companion')!.getBoundingClientRect();
    const openWhale = caption?.querySelector('.whale-companion')?.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    // The resting pool whale sits three quarters across the window at y=70.
    const openX = openWhale ? openWhale.x + openWhale.width / 2 : hostBounds.x + motion.capsule.x + motion.capsule.width * .75;
    const openY = openWhale ? openWhale.y + openWhale.height / 2 : hostBounds.y + motion.capsule.y + 70;
    const x = openX - (closedWhale.x + closedWhale.width / 2);
    const y = openY - (closedWhale.y + closedWhale.height / 2);
    const scale = openWhale ? openWhale.width / closedWhale.width : 1.8;
    if (pool) {
      const water = drop.querySelector('.pool-edge-water')!;
      animations.push(water.animate(order({ opacity: 0 }, { opacity: 1 }), options));
    } else if (caption) {
      animations.push(host.animate(order(contour(motion.capsule, 15), contour(motion.orb, EDGE_ORB_SIZE / 2)), options));
      const captionFrames = gather
        ? [{ opacity: 1 }, { opacity: 0, offset: .30 }, { opacity: 0 }]
        : [{ opacity: 0 }, { opacity: 0, offset: .38 }, { opacity: 1, offset: .91 }, { opacity: 1 }];
      animations.push(caption.animate(captionFrames, { duration, fill: 'both', easing: 'ease-in-out' }));
    }
    animations.push(drop.animate(order({ transform: `translate(${x}px, ${y}px) scale(${scale})` }, { transform: 'none' }), options));

    const elapsed = Math.max(0, Date.now() - startedAt);
    for (const animation of animations) animation.currentTime = Math.min(duration, elapsed);
    return () => { for (const animation of animations) animation.cancel(); };
  }, [motion, surface, pool]);

  return <>
    {!pool && <div ref={capsule} className="edge-motion-content edge-motion-caption" style={place(motion.capsule)} inert aria-hidden="true">
      <TaskCapsule task={task} motion={style} feedback={feedback} />
    </div>}
    <div ref={orb} className="edge-motion-content" style={place(motion.orb)} inert aria-hidden="true">
      <CapsuleEdgeOrb task={task} pool={pool} />
    </div>
  </>;
}
