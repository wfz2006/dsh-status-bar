import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, appearanceViewSize } from '../apps/desktop/src/shared/view-model';
import { WHALE_POOL_FEATURE, normalizeAnnouncements, acknowledgeFeature, shouldIntroduceWhalePool } from '../apps/desktop/src/shared/feature-announcements';
import { samplePoolOpening } from '../apps/desktop/src/renderer/pool-whale-flight';

describe('optional whale pool appearance', () => {
  it('keeps the existing appearance and original sizes for old preferences', () => {
    expect(DEFAULT_SETTINGS.appearance).toBe('classic');
    expect(normalizeSettings({material:'solid',pin:'normal'})).toMatchObject({appearance:'classic',material:'solid',pin:'normal',poolLayout:'clear',poolContour:'pearl'});
    expect(appearanceViewSize('capsule',false,'classic')).toEqual({width:288,height:44});
    expect(appearanceViewSize('approval',false,'whale-pool')).toEqual({width:400,height:300});
  });
  it('accepts the new appearance with each layout and rejects unknown values', () => {
    for(const poolLayout of ['clear','stream','letter'])expect(normalizeSettings({appearance:'whale-pool',poolLayout,poolContour:'mirror'})).toMatchObject({appearance:'whale-pool',poolLayout,poolContour:'mirror'});
    expect(normalizeSettings({appearance:'unknown',poolLayout:'unknown',poolContour:'unknown'})).toMatchObject({appearance:'classic',poolLayout:'clear',poolContour:'pearl'});
  });
  it('allocates enough native space for the independent idle whale and pool', () => {
    expect(appearanceViewSize('capsule',false,'whale-pool')).toEqual({width:220,height:140});
    expect(appearanceViewSize('peek',false,'whale-pool')).toEqual({width:440,height:360});
  });
});
describe('first install and first feature update notice', () => {
  it('introduces the feature once for both absent and old preferences', () => {
    expect(shouldIntroduceWhalePool(undefined,false)).toBe(true);
    expect(shouldIntroduceWhalePool([],false)).toBe(true);
    const seen=acknowledgeFeature([],WHALE_POOL_FEATURE);
    expect(shouldIntroduceWhalePool(seen,false)).toBe(false);
    expect(acknowledgeFeature(seen,WHALE_POOL_FEATURE)).toEqual(seen);
  });
  it('keeps acknowledgement separate from settings and tolerates corrupt history', () => {
    expect(normalizeAnnouncements({})).toEqual([]);
    expect(normalizeAnnouncements([null,12,'future-feature','future-feature'])).toEqual(['future-feature']);
    expect(shouldIntroduceWhalePool([],true)).toBe(false);
    expect(acknowledgeFeature(['future-feature'],WHALE_POOL_FEATURE)).toContain('future-feature');
    expect(acknowledgeFeature(Array.from({length:32},(_,i)=>`future-${i}`),WHALE_POOL_FEATURE)).toContain(WHALE_POOL_FEATURE);
  });
});

describe('whale pool opening route', () => {
  const left = { x: 165, y: 70, yaw: 0 };
  const right = { x: 328, y: 70, yaw: 0 };

  it('turns in place before swimming right and turns back at the destination', () => {
    const turning = samplePoolOpening(left, right, 0.12);
    expect(turning.x).toBe(left.x);
    expect(turning.yaw).toBeGreaterThan(0);
    expect(turning.yaw).toBeLessThan(Math.PI);
    expect(turning.swim).toBe(0);
    expect(turning.reveal).toBe(0);

    const swimming = samplePoolOpening(left, right, 0.7);
    expect(swimming.x).toBeGreaterThan(left.x);
    expect(swimming.x).toBeLessThan(right.x);
    expect(swimming.yaw).toBe(Math.PI);
    expect(swimming.swim).toBeGreaterThan(0);
    expect(swimming.swim).toBeLessThan(1);

    const arriving = samplePoolOpening(left, right, 1.5);
    expect(arriving.x).toBe(right.x);
    expect(arriving.swim).toBe(1);
    expect(arriving.yaw).toBeGreaterThan(0);
    expect(arriving.yaw).toBeLessThan(Math.PI);
    expect(samplePoolOpening(left, right, 3)).toMatchObject({ x: right.x, yaw: 0, reveal: 1 });
  });

  it('swims left immediately when already facing left', () => {
    const swimming = samplePoolOpening(right, left, 0.12);
    expect(swimming.x).toBeLessThan(right.x);
    expect(swimming.yaw).toBe(0);
  });

  it('resumes an interrupted turn from the displayed orientation', () => {
    const halfway = { ...left, yaw: Math.PI / 2 };
    expect(samplePoolOpening(halfway, right, 0)).toMatchObject(halfway);
    expect(samplePoolOpening(halfway, right, 0.12).yaw).toBeGreaterThan(halfway.yaw);
  });
});
