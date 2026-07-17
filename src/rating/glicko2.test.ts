// src/rating/glicko2.test.ts
import { describe, it, expect } from 'vitest';
import { reconcilePeriod } from './glicko2';

describe('reconcilePeriod', () => {
  it("matches Glickman's published Glicko-2 worked example", () => {
    // Reference: Glickman, "Example of the Glicko-2 system"
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const opponents: { rating: number; rd: number; score: 0 | 1 }[] = [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ];

    const result = reconcilePeriod(player, opponents);

    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });

  it('grows RD and leaves rating/volatility unchanged for a player with no games in the period', () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const result = reconcilePeriod(player, []);

    expect(result.rating).toBe(1500);
    expect(result.volatility).toBe(0.06);
    expect(result.rd).toBeGreaterThan(200);
  });

  it('increases rating for a player who beat a higher-rated opponent', () => {
    const player = { rating: 1500, rd: 100, volatility: 0.06 };
    const result = reconcilePeriod(player, [{ rating: 1700, rd: 100, score: 1 }]);
    expect(result.rating).toBeGreaterThan(1500);
  });

  it('shrinks RD for a player who is active relative to staying idle', () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const active = reconcilePeriod(player, [
      { rating: 1500, rd: 100, score: 1 },
      { rating: 1500, rd: 100, score: 0 },
    ]);
    const idle = reconcilePeriod(player, []);
    expect(active.rd).toBeLessThan(idle.rd);
  });

  it('never returns an RD below the spec floor of 50', () => {
    const player = { rating: 1500, rd: 50, volatility: 0.03 };
    const result = reconcilePeriod(player, [
      { rating: 1500, rd: 50, score: 1 },
      { rating: 1500, rd: 50, score: 0 },
      { rating: 1500, rd: 50, score: 1 },
    ]);
    expect(result.rd).toBeGreaterThanOrEqual(50);
  });

  it('never lets rd exceed INITIAL_RD even after many idle periods', () => {
    let state = { rating: 1500, rd: 100, volatility: 0.06 };
    for (let i = 0; i < 100; i++) {
      state = reconcilePeriod(state, []);
    }
    expect(state.rd).toBeLessThanOrEqual(350);
  });
});
