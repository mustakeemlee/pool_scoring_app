// src/rating/odds.test.ts
import { describe, it, expect } from 'vitest';
import { winProbability, impliedDecimalOdds } from './odds';

describe('winProbability', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(winProbability(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('matches the spec worked example: 1700 vs 1500', () => {
    expect(winProbability(1700, 1500)).toBeCloseTo(0.7597469266, 6);
  });
});

describe('impliedDecimalOdds', () => {
  it('matches the spec worked example', () => {
    expect(impliedDecimalOdds(winProbability(1700, 1500))).toBeCloseTo(1.3162277660, 6);
  });

  it('is exactly 2.0 for a 50% probability', () => {
    expect(impliedDecimalOdds(0.5)).toBeCloseTo(2.0, 10);
  });

  it('throws for a non-positive probability', () => {
    expect(() => impliedDecimalOdds(0)).toThrow();
    expect(() => impliedDecimalOdds(-0.1)).toThrow();
  });
});
