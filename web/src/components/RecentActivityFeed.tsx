// web/src/components/RecentActivityFeed.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { MatchTable } from '@/components/MatchTable';
import { useRecentActivity } from '@/hooks/useRecentActivity';

export function RecentActivityFeed() {
  const recentActivity = useRecentActivity();

  if (recentActivity.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (recentActivity.isError) {
    return <p className="text-destructive text-sm">Couldn't load recent activity. Try refreshing.</p>;
  }

  const recentMatches = recentActivity.data?.recentMatches ?? [];
  const recentPlayers = recentActivity.data?.recentPlayers ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
        <MatchTable matches={recentMatches} />
      </div>
      <div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
          Recently active players
        </h2>
        {recentPlayers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No player activity yet.</p>
        ) : (
          <ul className="card-surface overflow-hidden">
            {recentPlayers.map((player) => (
              <li
                key={player.id}
                className="flex min-w-0 items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                <span className="min-w-0 flex-1 truncate font-semibold">{player.full_name}</span>
                <span className="text-muted-foreground shrink-0 text-xs font-semibold uppercase tracking-wider">
                  {player.activity === 'signup' ? 'New player' : 'Recent match'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
