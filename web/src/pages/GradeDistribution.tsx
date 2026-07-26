import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';

export function GradeDistributionPage() {
  const activeSeason = useActiveSeason();
  const distribution = useGradeDistribution(activeSeason.data?.id);

  if (activeSeason.isLoading || distribution.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || distribution.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  const rows = toFullGradeDistribution(distribution.data ?? []);
  const maxCount = Math.max(1, ...rows.map((r) => r.player_count));

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {activeSeason.data?.name}
        </p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Grade Distribution</h1>
      </div>
      <div className="card-surface flex flex-col gap-4 p-6">
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-4">
            <div className="w-10">
              <GradeBadge grade={row.grade} />
            </div>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-foreground/5">
              <div
                className="fpl-gradient h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(row.player_count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-sm font-bold tabular-nums">{row.player_count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
