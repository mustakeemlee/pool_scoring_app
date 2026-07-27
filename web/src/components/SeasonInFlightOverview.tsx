// web/src/components/SeasonInFlightOverview.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useSeasonInFlight } from '@/hooks/useSeasonInFlight';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-surface p-4">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

export function SeasonInFlightOverview() {
  const seasonInFlight = useSeasonInFlight();

  if (seasonInFlight.isLoading) {
    return <Skeleton className="mb-6 h-24 w-full rounded-xl" />;
  }

  if (seasonInFlight.isError) {
    return <p className="text-destructive mb-6 text-sm">Couldn't load season status. Try refreshing.</p>;
  }

  const data = seasonInFlight.data;
  if (!data || !data.season) {
    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-2 text-lg font-bold">No active season</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          No season is currently running. Start one to begin recording matches.
        </p>
        <Link to="/admin/start-season" className="text-primary text-sm font-semibold hover:underline">
          Start Season →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-lg font-bold">{data.season.name}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Status" value={data.season.status} />
        <StatTile label="Start date" value={data.season.start_date} />
        <StatTile label="Days elapsed" value={data.daysElapsed} />
        <StatTile label="Matches played" value={data.matchesPlayed} />
        <StatTile label="Active players" value={data.activePlayerCount} />
      </div>
    </div>
  );
}
