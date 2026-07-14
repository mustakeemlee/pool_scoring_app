export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';

export function gradeForRating(rating: number): Grade {
  if (rating >= 2000) return 'A+';
  if (rating >= 1800) return 'A';
  if (rating >= 1600) return 'B+';
  if (rating >= 1400) return 'B';
  if (rating >= 1200) return 'C+';
  if (rating >= 1000) return 'C';
  return 'D';
}
