// web/src/pages/Dashboard.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { RecentActivityFeed } from '@/components/RecentActivityFeed';
import { SeasonInFlightOverview } from '@/components/SeasonInFlightOverview';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useUserProfile } from '@/hooks/useUserProfile';
import { usePendingClaims } from '@/hooks/usePendingClaims';
import type { PlayerClaim } from '@/lib/types';

const ADMIN_ACTIONS = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
  { to: '/admin/players', label: 'Players' },
];

function AdminDashboard() {
  const pendingClaims = usePendingClaims();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-6 text-sm">League operations at a glance.</p>
      <SeasonInFlightOverview />
      {pendingClaims.isLoading ? (
        <Skeleton className="mb-6 h-[72px] w-full rounded-xl" />
      ) : pendingClaims.isError ? (
        <p className="text-destructive mb-6 text-sm">Couldn't load pending claims. Try refreshing.</p>
      ) : (
        <Link to="/admin/players" className="card-surface mb-6 block p-4 hover:border-accent">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Pending claims</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{pendingClaims.data?.length ?? 0}</p>
        </Link>
      )}
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
      <RecentActivityFeed />
    </div>
  );
}

function LinkedPlayerDashboard({ playerId }: { playerId: string }) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Welcome back</h1>
      <Link
        to={`/players/${playerId}`}
        className="card-surface mb-6 block p-4 text-sm font-semibold hover:border-accent"
      >
        View your full profile →
      </Link>
      <RecentActivityFeed />
    </div>
  );
}

function UnlinkedDashboard({ pendingClaim }: { pendingClaim: PlayerClaim | null }) {
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
      <RecentActivityFeed />
    </div>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);

  if (isAdmin.isLoading || userProfile.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError) {
    return <p className="text-destructive">Couldn't load your dashboard. Try refreshing.</p>;
  }

  if (isAdmin.data === true) {
    return <AdminDashboard />;
  }
  if (userProfile.data?.linkedPlayerId) {
    return <LinkedPlayerDashboard playerId={userProfile.data.linkedPlayerId} />;
  }
  return <UnlinkedDashboard pendingClaim={userProfile.data?.pendingClaim ?? null} />;
}
