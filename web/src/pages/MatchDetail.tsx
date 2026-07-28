// web/src/pages/MatchDetail.tsx
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchComparisonCard } from '@/components/MatchComparisonCard';
import { useMatch } from '@/hooks/useMatch';
import { usePlayerComparisonStats } from '@/hooks/usePlayerComparisonStats';
import { useHeadToHead } from '@/hooks/useHeadToHead';

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const match = useMatch(id);
  const playerAStats = usePlayerComparisonStats(match.data?.player_a.id, match.data?.season_id);
  const playerBStats = usePlayerComparisonStats(match.data?.player_b.id, match.data?.season_id);
  const headToHead = useHeadToHead(match.data?.player_a.id, match.data?.player_b.id);

  if (match.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (match.isError || !match.data) {
    return <p className="text-destructive">Couldn't load this match. Try refreshing.</p>;
  }

  if (playerAStats.isLoading || playerBStats.isLoading || headToHead.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (playerAStats.isError || playerBStats.isError || headToHead.isError || !playerAStats.data || !playerBStats.data) {
    return <p className="text-destructive">Couldn't load this match. Try refreshing.</p>;
  }

  return (
    <MatchComparisonCard
      date={match.data.match_date}
      playerA={{ ...match.data.player_a, ...playerAStats.data }}
      playerB={{ ...match.data.player_b, ...playerBStats.data }}
      headToHead={headToHead.data ?? { winsA: 0, winsB: 0, played: 0 }}
      result={{
        frames_a: match.data.frames_a,
        frames_b: match.data.frames_b,
        rating_delta_a: match.data.rating_delta_a,
        rating_delta_b: match.data.rating_delta_b,
      }}
      voidedMessage={
        match.data.is_voided ? 'This match was voided — these stats may not reflect the current record.' : undefined
      }
    />
  );
}
