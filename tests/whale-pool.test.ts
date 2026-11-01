import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, appearanceViewSize } from '../apps/desktop/src/shared/view-model';
import { WHALE_POOL_FEATURE, normalizeAnnouncements, acknowledgeFeature, shouldIntroduceWhalePool } from '../apps/desktop/src/shared/feature-announcements';

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
