// src/rating/elo.test.ts
import { describe, it, expect } from 'vitest';
import { expectedScore, kEffective, movMultiplier, applyInstantNudge } from './elo';

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('matches the spec worked example: 1700 vs 1500 gives ~76%', () => {
    expect(expectedScore(1700, 1500)).toBeCloseTo(0.7597469266, 6);
  });
});

describe('kEffective', () => {
  it('returns K_min at the RD floor', () => {
    expect(kEffective(50)).toBe(10);
  });

  it('returns K_max at the RD ceiling', () => {
    expect(kEffective(350)).toBe(50);
  });

  it('interpolates linearly at the midpoint', () => {
    expect(kEffective(200)).toBe(30);
  });
});

describe('movMultiplier', () => {
  it('returns 1.0 for the narrowest possible win', () => {
    expect(movMultiplier(5, 4)).toBe(1.0);
  });

  it('returns 1.5 for a whitewash', () => {
    expect(movMultiplier(5, 0)).toBe(1.5);
  });

  it('scales linearly between the extremes', () => {
    expect(movMultiplier(5, 2)).toBe(1.25);
  });

  it('returns 1.0 for a race-to-1 match (no wider margin is possible)', () => {
    expect(movMultiplier(1, 0)).toBe(1.0);
  });
});

describe('applyInstantNudge', () => {
  it('moves both ratings by the same magnitude, opposite direction, for an expected win', () => {
    const result = applyInstantNudge({
      ratingA: 1500, rdA: 350, ratingB: 1500, rdB: 350, framesA: 5, framesB: 4,
    });
    expect(result.expectedScoreA).toBeCloseTo(0.5, 10);
    expect(result.actualScoreA).toBe(1);
    expect(result.kEffectiveA).toBe(50);
    expect(result.movMultiplier).toBe(1.0);
    expect(result.deltaA).toBeCloseTo(25, 10);
    expect(result.newRatingA).toBeCloseTo(1525, 10);
    expect(result.newRatingB).toBeCloseTo(1475, 10);
  });

  it('scales an upset whitewash win by both K and the MoV multiplier', () => {
    const result = applyInstantNudge({
      ratingA: 1400, rdA: 200, ratingB: 1700, rdB: 200, framesA: 5, framesB: 0,
    });
    const expectedE = expectedScore(1400, 1700);
    const expectedDelta = 30 * 1.5 * (1 - expectedE); // kEffective(200)=30, movMultiplier(5,0)=1.5

    expect(result.expectedScoreA).toBeCloseTo(expectedE, 10);
    expect(result.kEffectiveA).toBe(30);
    expect(result.movMultiplier).toBe(1.5);
    expect(result.deltaA).toBeCloseTo(expectedDelta, 10);
    expect(result.newRatingA).toBeCloseTo(1400 + expectedDelta, 10);
    expect(result.newRatingB).toBeCloseTo(1700 - expectedDelta, 10);
  });

  it('gives actualScoreA = 0 when player A loses', () => {
    const result = applyInstantNudge({
      ratingA: 1500, rdA: 350, ratingB: 1500, rdB: 350, framesA: 2, framesB: 5,
    });
    expect(result.actualScoreA).toBe(0);
  });
});
