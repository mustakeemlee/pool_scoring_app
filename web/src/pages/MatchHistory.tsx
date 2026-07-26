import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useMatchHistory } from '@/hooks/useMatchHistory';

export function MatchHistoryPage() {
  const seasonSelector = useSeasonSelector();
  const matchHistory = useMatchHistory(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (matchHistory.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (matchHistory.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

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
        <h1 className="text-3xl font-extrabold sm:text-4xl">Match History</h1>
      </div>
      <MatchTable matches={matchHistory.data ?? []} />
    </div>
  );
}
