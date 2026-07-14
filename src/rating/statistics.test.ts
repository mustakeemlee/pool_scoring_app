// src/rating/statistics.test.ts
import { describe, it, expect } from 'vitest';
import {
  winPercentage,
  currentStreak,
  longestStreak,
  averageOpponentRating,
  formPercentage,
  formScore,
} from './statistics';

describe('winPercentage', () => {
  it('computes a basic win percentage', () => {
    expect(winPercentage(7, 3)).toBe(70);
  });

  it('returns 0 when no matches have been played', () => {
    expect(winPercentage(0, 0)).toBe(0);
  });
});

describe('currentStreak', () => {
  it('returns a positive count for an active win streak', () => {
    expect(currentStreak([false, true, true, true])).toBe(3);
  });

  it('returns a negative count for an active loss streak', () => {
    expect(currentStreak([true, false, false])).toBe(-2);
  });

  it('returns 0 when there are no matches', () => {
    expect(currentStreak([])).toBe(0);
  });
});

describe('longestStreak', () => {
  it('finds the longest historical win streak', () => {
    expect(longestStreak([true, true, false, true, true, true, false])).toBe(3);
  });

  it('returns 0 when there are no wins', () => {
    expect(longestStreak([false, false])).toBe(0);
  });
});

describe('averageOpponentRating', () => {
  it('computes the mean opponent rating', () => {
    expect(averageOpponentRating([1400, 1600, 1500])).toBeCloseTo(1500, 10);
  });

  it('returns 0 when there are no matches', () => {
    expect(averageOpponentRating([])).toBe(0);
  });
});

describe('formPercentage', () => {
  it('computes win percentage over the given window', () => {
    expect(formPercentage([true, true, true, false, true])).toBe(80);
  });
});

describe('formScore', () => {
  it('blends last-5 and last-10 win percentage 65/35', () => {
    const last5 = [true, true, true, false, true]; // 4/5 = 80%
    const last10 = [true, true, true, false, true, false, true, false, true, false]; // 6/10 = 60%
    expect(formScore(last5, last10)).toBeCloseTo(0.65 * 80 + 0.35 * 60, 10); // 73
  });
});
