// web/src/components/GradeBadge.tsx
import { cn } from '@/lib/utils';
import type { Grade } from '@/lib/types';

const GRADE_COLORS: Record<Grade, string> = {
  'A+': 'bg-green-700 text-white',
  A: 'bg-green-600 text-white',
  'B+': 'bg-lime-600 text-black',
  B: 'bg-yellow-500 text-black',
  'C+': 'bg-orange-500 text-black',
  C: 'bg-orange-700 text-white',
  D: 'bg-red-700 text-white',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold',
        GRADE_COLORS[grade],
      )}
    >
      {grade}
    </span>
  );
}
