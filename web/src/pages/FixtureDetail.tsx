// web/src/pages/FixtureDetail.tsx
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchComparisonCard } from '@/components/MatchComparisonCard';
import { useFixture } from '@/hooks/useFixture';
import { usePlayerComparisonStats } from '@/hooks/usePlayerComparisonStats';
import { useHeadToHead } from '@/hooks/useHeadToHead';

export function FixtureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fixture = useFixture(id);
  const playerAStats = usePlayerComparisonStats(fixture.data?.player_a.id, fixture.data?.season_id);
  const playerBStats = usePlayerComparisonStats(fixture.data?.player_b.id, fixture.data?.season_id);
  const headToHead = useHeadToHead(fixture.data?.player_a.id, fixture.data?.player_b.id);

  if (fixture.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (fixture.isError || !fixture.data) {
    return <p className="text-destructive">Couldn't load this fixture. Try refreshing.</p>;
  }

  if (playerAStats.isLoading || playerBStats.isLoading || headToHead.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (playerAStats.isError || playerBStats.isError || headToHead.isError || !playerAStats.data || !playerBStats.data) {
    return <p className="text-destructive">Couldn't load this fixture. Try refreshing.</p>;
  }

  return (
    <MatchComparisonCard
      date={fixture.data.scheduled_date}
      playerA={{ ...fixture.data.player_a, ...playerAStats.data }}
      playerB={{ ...fixture.data.player_b, ...playerBStats.data }}
      headToHead={headToHead.data ?? { winsA: 0, winsB: 0, played: 0 }}
      voidedMessage={fixture.data.status === 'voided' ? 'This fixture was cancelled.' : undefined}
    />
  );
}
