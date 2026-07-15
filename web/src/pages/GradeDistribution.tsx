import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';

export function GradeDistributionPage() {
  const activeSeason = useActiveSeason();
  const distribution = useGradeDistribution(activeSeason.data?.id);

  if (activeSeason.isLoading || distribution.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || distribution.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  const rows = toFullGradeDistribution(distribution.data ?? []);
  const maxCount = Math.max(1, ...rows.map((r) => r.player_count));

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Grade Distribution</h1>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-3">
            <div className="w-10">
              <GradeBadge grade={row.grade} />
            </div>
            <div className="bg-muted h-4 flex-1 overflow-hidden rounded">
              <div
                className="h-full bg-primary"
                style={{ width: `${(row.player_count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-sm">{row.player_count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
