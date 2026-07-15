// web/src/pages/Leaderboard.tsx
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useLeaderboard } from '@/hooks/useLeaderboard';

export function LeaderboardPage() {
  const activeSeason = useActiveSeason();
  const leaderboard = useLeaderboard(activeSeason.data?.id);

  if (activeSeason.isLoading || leaderboard.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || leaderboard.isError) {
    return <p className="text-destructive">Couldn't load the leaderboard. Try refreshing.</p>;
  }

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Leaderboard</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Season Pts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaderboard.data?.map((entry) => (
            <TableRow key={entry.player_id}>
              <TableCell>{entry.rank}</TableCell>
              <TableCell>
                <Link to={`/players/${entry.player_id}`} className="hover:underline">
                  {entry.full_name}
                </Link>
              </TableCell>
              <TableCell>
                <GradeBadge grade={entry.grade} />
              </TableCell>
              <TableCell>{entry.rating}</TableCell>
              <TableCell>{entry.season_points}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
