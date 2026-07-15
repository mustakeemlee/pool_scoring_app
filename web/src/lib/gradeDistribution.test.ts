// web/src/lib/gradeDistribution.test.ts
import { describe, it, expect } from 'vitest';
import { toFullGradeDistribution } from './gradeDistribution';
import type { GradeDistributionEntry } from './types';

describe('toFullGradeDistribution', () => {
  it('fills in all 7 grade bands in A+ -> D order, defaulting missing ones to 0', () => {
    const entries: GradeDistributionEntry[] = [
      { season_id: 's1', grade: 'B', player_count: 5 },
      { season_id: 's1', grade: 'A+', player_count: 2 },
    ];
    const result = toFullGradeDistribution(entries);
    expect(result.map((r) => r.grade)).toEqual(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D']);
    expect(result.find((r) => r.grade === 'A+')?.player_count).toBe(2);
    expect(result.find((r) => r.grade === 'B')?.player_count).toBe(5);
    expect(result.find((r) => r.grade === 'D')?.player_count).toBe(0);
  });

  it('returns all-zero rows for an empty input', () => {
    const result = toFullGradeDistribution([]);
    expect(result.every((r) => r.player_count === 0)).toBe(true);
    expect(result).toHaveLength(7);
  });
});
