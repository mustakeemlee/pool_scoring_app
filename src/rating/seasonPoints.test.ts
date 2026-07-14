import { describe, it, expect } from 'vitest';
import { calculateSeasonPoints } from './seasonPoints';

describe('calculateSeasonPoints', () => {
  it('awards base win points plus one point per frame won, no bonuses for a routine win', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 3, ownRating: 1500, opponentRating: 1450,
    });
    expect(points).toBe(3 + 5);
  });

  it('awards zero base points but still frame points for a competitive loss', () => {
    const points = calculateSeasonPoints({
      won: false, framesFor: 4, framesAgainst: 5, ownRating: 1500, opponentRating: 1600,
    });
    expect(points).toBe(0 + 4);
  });

  it('awards an upset bonus, capped at 5, for beating a much higher-rated opponent', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 2, ownRating: 1200, opponentRating: 1900,
    });
    // upset bonus = min(5, round(700/100)) = min(5, 7) = 5
    expect(points).toBe(3 + 5 + 5);
  });

  it('does not award an upset bonus when beating a lower-rated opponent', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 1, ownRating: 1700, opponentRating: 1400,
    });
    expect(points).toBe(3 + 5);
  });

  it('awards a whitewash bonus for winning by the maximum possible margin', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 0, ownRating: 1500, opponentRating: 1400,
    });
    expect(points).toBe(3 + 5 + 2);
  });

  it('does not award a whitewash bonus on a loss even with framesAgainst of 0', () => {
    const points = calculateSeasonPoints({
      won: false, framesFor: 0, framesAgainst: 5, ownRating: 1500, opponentRating: 1600,
    });
    expect(points).toBe(0);
  });
});
