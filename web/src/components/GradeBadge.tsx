// web/src/components/GradeBadge.tsx
import { cn } from '@/lib/utils';
import type { Grade } from '@/lib/types';

const GRADE_COLORS: Record<Grade, string> = {
  'A+': 'bg-green-700 text-white',
  A: 'bg-green-600 text-black',
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
        'inline-flex min-w-[2.25rem] items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-extrabold tracking-wide shadow-sm',
        GRADE_COLORS[grade],
      )}
    >
      {grade}
    </span>
  );
}
