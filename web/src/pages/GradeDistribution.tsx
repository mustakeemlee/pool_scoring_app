import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';

export function GradeDistributionPage() {
  const seasonSelector = useSeasonSelector();
  const distribution = useGradeDistribution(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (distribution.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (distribution.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  const rows = toFullGradeDistribution(distribution.data ?? []);
  const maxCount = Math.max(1, ...rows.map((r) => r.player_count));

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <div className="mb-3 flex justify-center sm:justify-start">
          <SeasonPillSwitcher
            selectedSeason={seasonSelector.selectedSeason}
            seasons={seasonSelector.seasons}
            onSelectSeason={seasonSelector.selectSeason}
            onPrevious={seasonSelector.selectPrevious}
            onNext={seasonSelector.selectNext}
            hasPrevious={seasonSelector.hasPrevious}
            hasNext={seasonSelector.hasNext}
          />
        </div>
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
