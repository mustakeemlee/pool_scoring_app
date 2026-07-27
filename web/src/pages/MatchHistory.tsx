// web/src/pages/MatchHistory.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useMatchHistory } from '@/hooks/useMatchHistory';
import { useFixtures, type Fixture } from '@/hooks/useFixtures';
import { useVoidFixture } from '@/hooks/useVoidFixture';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

function isOverdue(fixture: Fixture): boolean {
  return fixture.status === 'scheduled' && fixture.scheduled_date < new Date().toISOString().slice(0, 10);
}

function FixturesList({ seasonId, isAdmin }: { seasonId: string; isAdmin: boolean }) {
  const fixtures = useFixtures(seasonId);
  const voidFixture = useVoidFixture();

  async function handleVoid(fixtureId: string) {
    try {
      await voidFixture.mutateAsync({ fixtureId, seasonId });
      toast.success('Fixture voided.');
    } catch (voidError) {
      toast.error(voidError instanceof Error ? voidError.message : 'Failed to void fixture.');
    }
  }

  if (fixtures.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (fixtures.isError) {
    return <p className="text-destructive text-sm">Couldn't load fixtures. Try refreshing.</p>;
  }

  const rows = fixtures.data ?? [];
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No fixtures scheduled yet.</p>;
  }

  return (
    <ul className="card-surface overflow-hidden">
      {rows.map((fixture) => (
        <li
          key={fixture.id}
          className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <span className="text-muted-foreground w-24 text-sm">{fixture.scheduled_date}</span>
          <div className="flex flex-1 items-center gap-2">
            <PlayerAvatar name={fixture.player_a.full_name} photoUrl={fixture.player_a.photo_url} size="sm" />
            <span className="font-semibold">{fixture.player_a.full_name}</span>
            <span className="text-muted-foreground text-xs">vs</span>
            <PlayerAvatar name={fixture.player_b.full_name} photoUrl={fixture.player_b.photo_url} size="sm" />
            <span className="font-semibold">{fixture.player_b.full_name}</span>
          </div>
          {fixture.status === 'voided' && (
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Voided</span>
          )}
          {fixture.status === 'completed' && (
            <span className="text-primary text-xs font-semibold uppercase tracking-wider">Completed</span>
          )}
          {isOverdue(fixture) && (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold uppercase text-destructive">
              Overdue
            </span>
          )}
          {isAdmin && fixture.status === 'scheduled' && (
            <div className="flex gap-3">
              <Link
                to={`/admin/enter-match?fixtureId=${fixture.id}`}
                className="text-primary text-xs font-semibold hover:underline"
              >
                Enter Result
              </Link>
              <button
                type="button"
                onClick={() => handleVoid(fixture.id)}
                className="text-destructive text-xs font-semibold hover:underline"
              >
                Void
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function MatchHistoryPage() {
  const seasonSelector = useSeasonSelector();
  const matchHistory = useMatchHistory(seasonSelector.selectedSeasonId);
  const { session } = useAuth();
  const isAdmin = useIsAdmin(session?.user.id);
  const [view, setView] = useState<'fixtures' | 'results'>('results');

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
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
        <h1 className="mb-4 text-3xl font-extrabold sm:text-4xl">Matches</h1>
        <div className="flex justify-center gap-2 sm:justify-start">
          <Button
            type="button"
            variant={view === 'fixtures' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('fixtures')}
          >
            Fixtures
          </Button>
          <Button
            type="button"
            variant={view === 'results' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('results')}
          >
            Results
          </Button>
        </div>
      </div>
      {view === 'fixtures' ? (
        <FixturesList seasonId={seasonSelector.selectedSeasonId} isAdmin={isAdmin.data === true} />
      ) : matchHistory.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : matchHistory.isError ? (
        <p className="text-destructive">Couldn't load match history. Try refreshing.</p>
      ) : (
        <MatchTable matches={matchHistory.data ?? []} />
      )}
    </div>
  );
}
