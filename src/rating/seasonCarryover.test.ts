import { describe, it, expect } from 'vitest';
import { applySeasonCarryover } from './seasonCarryover';

describe('applySeasonCarryover', () => {
  it('regresses rating 75% of the way back toward 1500', () => {
    const result = applySeasonCarryover({ rating: 1900, rd: 100, volatility: 0.06 });
    expect(result.rating).toBeCloseTo(1500 + 0.75 * 400, 10); // 1800
  });

  it('regresses a below-baseline rating back up toward 1500', () => {
    const result = applySeasonCarryover({ rating: 1100, rd: 100, volatility: 0.06 });
    expect(result.rating).toBeCloseTo(1500 + 0.75 * -400, 10); // 1200
  });

  it('grows RD by 50, capped at the initial RD ceiling of 350', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 320, volatility: 0.06 });
    expect(result.rd).toBe(350);
  });

  it('grows RD by 50 without capping when below the ceiling', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 100, volatility: 0.06 });
    expect(result.rd).toBe(150);
  });

  it('leaves volatility unchanged', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 100, volatility: 0.073 });
    expect(result.volatility).toBe(0.073);
  });
});
