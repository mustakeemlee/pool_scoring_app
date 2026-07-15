// web/src/components/MatchTable.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { MatchRow } from '@/lib/types';

export function MatchTable({ matches }: { matches: MatchRow[] }) {
  if (matches.length === 0) {
    return <p className="text-muted-foreground text-sm">No matches yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Player A</TableHead>
          <TableHead>Player B</TableHead>
          <TableHead>Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {matches.map((match) => (
          <TableRow key={match.id} className={cn(match.is_voided && 'opacity-50')}>
            <TableCell>{match.match_date}</TableCell>
            <TableCell className={cn(match.winner_id === match.player_a_id && 'font-semibold')}>
              {match.player_a.full_name}
            </TableCell>
            <TableCell className={cn(match.winner_id === match.player_b_id && 'font-semibold')}>
              {match.player_b.full_name}
            </TableCell>
            <TableCell>
              {match.frames_a}–{match.frames_b}
              {match.is_voided && <span className="ml-2 text-xs italic">(voided)</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
