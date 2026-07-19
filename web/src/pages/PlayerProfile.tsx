// web/src/pages/PlayerProfile.tsx
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { toRatingHistoryPoints } from '@/lib/ratingHistory';
import { toPlayerProfileMatches } from '@/lib/playerProfileMatches';
import { cn } from '@/lib/utils';

const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));

function streakLabel(streak: number): string {
  if (streak === 0) return '—';
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

function StatTile({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="card-surface p-4">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</p>
      <p className={cn('mt-1 text-2xl font-extrabold tabular-nums', highlight && 'fpl-gradient-text')}>
        {value}
      </p>
    </div>
  );
}

export function PlayerProfilePage() {
  const { playerId } = useParams<{ playerId: string }>();
  const activeSeason = useActiveSeason();
  const profile = usePlayerProfile(playerId, activeSeason.data?.id);

  if (activeSeason.isLoading || profile.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || profile.isError || !profile.data) {
    return <p className="text-destructive">Couldn't load this player. Try refreshing.</p>;
  }

  const { player, seasonRating, statistics, ratingEvents, matches } = profile.data;
  const chartPoints = toRatingHistoryPoints(ratingEvents);
  const recentMatches = toPlayerProfileMatches(player.id, matches, ratingEvents);

  return (
    <div>
      {/* Hero */}
      <div className="fpl-gradient-soft mb-6 flex flex-col items-start gap-5 rounded-2xl border border-white/10 px-6 py-8 sm:flex-row sm:items-center">
        <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="xl" className="fpl-glow-green" />
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            {activeSeason.data?.name}
          </p>
          <h1 className="truncate text-3xl font-extrabold sm:text-4xl">{player.full_name}</h1>
          {seasonRating && (
            <div className="mt-2">
              <GradeBadge grade={seasonRating.grade} />
            </div>
          )}
        </div>
      </div>

      {!seasonRating && (
        <p className="text-muted-foreground mb-6 text-sm">
          No rating yet this season — check back after their first match.
        </p>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Rating" value={seasonRating?.rating ?? '—'} />
        <StatTile label="Win %" value={statistics ? `${statistics.win_pct}%` : '—'} />
        <StatTile label="Streak" value={statistics ? streakLabel(statistics.current_streak) : '—'} />
        <StatTile label="Form" value={statistics?.form_score ?? '—'} />
        <StatTile label="Season Pts" value={seasonRating?.season_points ?? '—'} highlight />
      </div>

      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
        Rating history
      </h2>
      <div className="card-surface mb-8 p-4">
        <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
          <RatingChart points={chartPoints} />
        </Suspense>
      </div>

      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
        Recent matches
      </h2>
      {recentMatches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matches yet.</p>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider">
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Opponent</th>
                <th className="px-4 py-2.5">Score</th>
                <th className="px-4 py-2.5">Result</th>
                <th className="px-4 py-2.5">Δ Rating</th>
              </tr>
            </thead>
            <tbody>
              {recentMatches.map((match) => (
                <tr
                  key={match.id}
                  className={cn(
                    'border-b border-white/5 transition-colors last:border-0 hover:bg-white/5',
                    match.is_voided && 'opacity-50',
                  )}
                >
                  <td className="text-muted-foreground px-4 py-3">{match.match_date}</td>
                  <td className="px-4 py-3 font-medium">{match.opponent_name}</td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {match.frames_for}–{match.frames_against}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                        match.won ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive',
                      )}
                    >
                      {match.won ? 'Win' : 'Loss'}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 font-semibold tabular-nums',
                      match.rating_delta !== null && match.rating_delta > 0 && 'text-primary',
                      match.rating_delta !== null && match.rating_delta < 0 && 'text-destructive',
                    )}
                  >
                    {match.rating_delta !== null ? match.rating_delta.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
