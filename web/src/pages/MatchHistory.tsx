// web/src/pages/MatchHistory.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useMatchHistory } from '@/hooks/useMatchHistory';

export function MatchHistoryPage() {
  const activeSeason = useActiveSeason();
  const matchHistory = useMatchHistory(activeSeason.data?.id);

  if (activeSeason.isLoading || matchHistory.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || matchHistory.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Match History</h1>
      <MatchTable matches={matchHistory.data ?? []} />
    </div>
  );
}
