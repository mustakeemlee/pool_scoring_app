// web/src/pages/Leaderboard.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { cn } from '@/lib/utils';

const RANK_STYLES: Record<number, string> = {
  1: 'bg-primary text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.45)]',
  2: 'bg-accent text-accent-foreground',
  3: 'bg-fpl-magenta text-white',
};

export function LeaderboardPage() {
  const activeSeason = useActiveSeason();
  const leaderboard = useLeaderboard(activeSeason.data?.id);

  if (activeSeason.isLoading || leaderboard.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || leaderboard.isError) {
    return <p className="text-destructive">Couldn't load the leaderboard. Try refreshing.</p>;
  }

  const entries = leaderboard.data ?? [];

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">
          {activeSeason.data?.name}
        </p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Leaderboard</h1>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active players yet.</p>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="text-muted-foreground grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]">
          <span>#</span>
          <span>Player</span>
          <span className="text-center">Grade</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Pts</span>
          </div>
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.player_id}
                className={cn(
                  'grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-foreground/5 sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]',
                  entry.rank <= 3 && 'bg-foreground/[0.03]',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                    RANK_STYLES[entry.rank] ?? 'bg-foreground/10 text-foreground',
                  )}
                >
                  {entry.rank}
                </span>
                <Link
                  to={`/players/${entry.player_id}`}
                  className="group flex min-w-0 items-center gap-3"
                >
                  <PlayerAvatar name={entry.full_name} photoUrl={entry.photo_url} size="md" />
                  <span className="truncate font-semibold group-hover:text-primary">
                    {entry.full_name}
                  </span>
                </Link>
                <span className="text-center">
                  <GradeBadge grade={entry.grade} />
                </span>
                <span className="text-right font-bold tabular-nums">{entry.rating}</span>
                <span className="fpl-gradient-text text-right font-extrabold tabular-nums">
                  {entry.season_points}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
