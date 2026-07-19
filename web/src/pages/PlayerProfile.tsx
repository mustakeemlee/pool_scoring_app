// web/src/pages/PlayerProfile.tsx
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { toRatingHistoryPoints } from '@/lib/ratingHistory';
import { toPlayerProfileMatches } from '@/lib/playerProfileMatches';

const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));

function streakLabel(streak: number): string {
  if (streak === 0) return '—';
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

export function PlayerProfilePage() {
  const { playerId } = useParams<{ playerId: string }>();
  const activeSeason = useActiveSeason();
  const profile = usePlayerProfile(playerId, activeSeason.data?.id);

  if (activeSeason.isLoading || profile.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || profile.isError || !profile.data) {
    return <p className="text-destructive">Couldn't load this player. Try refreshing.</p>;
  }

  const { player, seasonRating, statistics, ratingEvents, matches } = profile.data;
  const chartPoints = toRatingHistoryPoints(ratingEvents);
  const recentMatches = toPlayerProfileMatches(player.id, matches, ratingEvents);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{player.full_name}</h1>
          <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
        </div>
        {seasonRating && <GradeBadge grade={seasonRating.grade} />}
      </div>

      {!seasonRating && (
        <p className="text-muted-foreground mb-6 text-sm">No rating yet this season — check back after their first match.</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Rating</p>
          <p className="text-lg font-bold">{seasonRating?.rating ?? '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Win %</p>
          <p className="text-lg font-bold">{statistics ? `${statistics.win_pct}%` : '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Streak</p>
          <p className="text-lg font-bold">{statistics ? streakLabel(statistics.current_streak) : '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Form</p>
          <p className="text-lg font-bold">{statistics?.form_score ?? '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Season Pts</p>
          <p className="text-lg font-bold">{seasonRating?.season_points ?? '—'}</p>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Rating history</h2>
      <div className="mb-6">
        <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
          <RatingChart points={chartPoints} />
        </Suspense>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Recent matches</h2>
      {recentMatches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matches yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Opponent</th>
              <th className="py-2">Score</th>
              <th className="py-2">Result</th>
              <th className="py-2">Δ Rating</th>
            </tr>
          </thead>
          <tbody>
            {recentMatches.map((match) => (
              <tr key={match.id} className={match.is_voided ? 'opacity-50' : undefined}>
                <td className="py-2">{match.match_date}</td>
                <td className="py-2">{match.opponent_name}</td>
                <td className="py-2">
                  {match.frames_for}–{match.frames_against}
                </td>
                <td className={`py-2 ${match.won ? 'text-green-600' : ''}`}>{match.won ? 'Win' : 'Loss'}</td>
                <td className={`py-2 ${match.rating_delta !== null && match.rating_delta > 0 ? 'text-green-600' : ''}`}>
                  {match.rating_delta !== null ? match.rating_delta.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
