// web/src/components/GradeBadge.tsx
import { cn } from '@/lib/utils';
import type { Grade } from '@/lib/types';

const GRADE_COLORS: Record<Grade, string> = {
  'A+': 'bg-green-700',
  A: 'bg-green-600',
  'B+': 'bg-lime-600',
  B: 'bg-yellow-500',
  'C+': 'bg-orange-500',
  C: 'bg-orange-700',
  D: 'bg-red-700',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white',
        GRADE_COLORS[grade],
      )}
    >
      {grade}
    </span>
  );
}
