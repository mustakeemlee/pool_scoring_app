// web/src/pages/MatchHistory.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useMatchHistory } from '@/hooks/useMatchHistory';

export function MatchHistoryPage() {
  const activeSeason = useActiveSeason();
  const matchHistory = useMatchHistory(activeSeason.data?.id);

  if (activeSeason.isLoading || matchHistory.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || matchHistory.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {activeSeason.data?.name}
        </p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Match History</h1>
      </div>
      <MatchTable matches={matchHistory.data ?? []} />
    </div>
  );
}
