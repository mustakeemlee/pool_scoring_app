// web/src/pages/Dashboard.tsx
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { MatchTable } from '@/components/MatchTable';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useUserProfile } from '@/hooks/useUserProfile';
import { usePendingClaims } from '@/hooks/usePendingClaims';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useMatchHistory } from '@/hooks/useMatchHistory';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { toRatingHistoryPoints } from '@/lib/ratingHistory';
import type { PlayerClaim } from '@/lib/types';

const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));

const ADMIN_ACTIONS = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
  { to: '/admin/players', label: 'Players' },
];

function AdminDashboard({ seasonId, seasonName }: { seasonId: string; seasonName: string }) {
  const pendingClaims = usePendingClaims();
  const matchHistory = useMatchHistory(seasonId);
  const recentMatches = (matchHistory.data ?? []).slice(0, 5);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-6 text-sm">{seasonName}</p>
      <Link to="/admin/players" className="card-surface mb-6 block p-4 hover:border-accent">
        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Pending claims</p>
        <p className="mt-1 text-2xl font-extrabold tabular-nums">{pendingClaims.data?.length ?? 0}</p>
      </Link>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {ADMIN_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="card-surface p-4 text-center text-sm font-semibold hover:border-accent"
          >
            {action.label}
          </Link>
        ))}
      </div>
      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
      <MatchTable matches={recentMatches} />
    </div>
  );
}

function LinkedPlayerDashboard({ playerId, seasonId }: { playerId: string; seasonId: string }) {
  const profile = usePlayerProfile(playerId, seasonId);
  const leaderboard = useLeaderboard(seasonId);

  if (profile.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (profile.isError || !profile.data) {
    return <p className="text-destructive">Couldn't load your profile. Try refreshing.</p>;
  }

  const { player, seasonRating, matches } = profile.data;
  const rank = leaderboard.data?.find((entry) => entry.player_id === playerId)?.rank;
  const chartPoints = toRatingHistoryPoints(profile.data.ratingEvents);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">{player.full_name}</h1>
      <div className="mb-6 flex items-center gap-3">
        {seasonRating && <GradeBadge grade={seasonRating.grade} />}
        {rank !== undefined && <span className="text-muted-foreground text-sm">Rank #{rank}</span>}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="card-surface p-4">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Rating</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{seasonRating?.rating ?? '—'}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Season Pts</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{seasonRating?.season_points ?? '—'}</p>
        </div>
        <Link to={`/players/${playerId}`} className="card-surface p-4 hover:border-accent">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Full profile</p>
          <p className="mt-1 text-sm font-semibold">View →</p>
        </Link>
      </div>
      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Rating history</h2>
      <div className="card-surface mb-6 p-4">
        <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
          <RatingChart points={chartPoints} />
        </Suspense>
      </div>
      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
      <MatchTable matches={matches} />
    </div>
  );
}

function UnlinkedDashboard({ pendingClaim, seasonId }: { pendingClaim: PlayerClaim | null; seasonId: string }) {
  const leaderboard = useLeaderboard(seasonId);
  const top5 = (leaderboard.data ?? []).slice(0, 5);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Welcome</h1>
      {pendingClaim ? (
        <p className="text-muted-foreground mb-6 text-sm">Your player claim is pending review by an admin.</p>
      ) : (
        <div className="card-surface mb-6 p-6">
          <h2 className="mb-2 text-lg font-bold">Claim your player profile</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            If you're a league player, link your account to see your own rating, rank, and match history here.
          </p>
          <Link to="/settings" className="text-primary text-sm font-semibold hover:underline">
            Go to Settings →
          </Link>
        </div>
      )}
      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Leaderboard</h2>
      <ul className="card-surface overflow-hidden">
        {top5.map((entry) => (
          <li key={entry.player_id} className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0">
            <span className="font-medium">
              #{entry.rank} {entry.full_name}
            </span>
            <GradeBadge grade={entry.grade} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);
  const activeSeason = useActiveSeason();

  if (isAdmin.isLoading || userProfile.isLoading || activeSeason.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError || activeSeason.isError || !activeSeason.data) {
    return <p className="text-destructive">Couldn't load your dashboard. Try refreshing.</p>;
  }

  const seasonId = activeSeason.data.id;

  if (isAdmin.data === true) {
    return <AdminDashboard seasonId={seasonId} seasonName={activeSeason.data.name} />;
  }
  if (userProfile.data?.linkedPlayerId) {
    return <LinkedPlayerDashboard playerId={userProfile.data.linkedPlayerId} seasonId={seasonId} />;
  }
  return <UnlinkedDashboard pendingClaim={userProfile.data?.pendingClaim ?? null} seasonId={seasonId} />;
}
