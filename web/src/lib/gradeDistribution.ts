// web/src/lib/gradeDistribution.ts
import type { Grade, GradeDistributionEntry } from './types';

const GRADE_ORDER: Grade[] = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'];

export interface GradeDistributionRow {
  grade: Grade;
  player_count: number;
}

export function toFullGradeDistribution(entries: GradeDistributionEntry[]): GradeDistributionRow[] {
  const countByGrade = new Map(entries.map((entry) => [entry.grade, entry.player_count]));
  return GRADE_ORDER.map((grade) => ({ grade, player_count: countByGrade.get(grade) ?? 0 }));
}
