// web/src/components/MatchTable.tsx
import { Link } from 'react-router-dom';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { cn } from '@/lib/utils';
import type { MatchRow, PlayerSummary } from '@/lib/types';

function PlayerCell({ player, won }: { player: PlayerSummary; won: boolean }) {
  return (
    <Link to={`/players/${player.id}`} className="group inline-flex min-w-0 items-center gap-2.5">
      <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
      <span className={cn('truncate group-hover:text-primary', won ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
        {player.full_name}
      </span>
      {won && (
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
          W
        </span>
      )}
    </Link>
  );
}

export function MatchTable({ matches }: { matches: MatchRow[] }) {
  if (matches.length === 0) {
    return <p className="text-muted-foreground text-sm">No matches yet.</p>;
  }

  return (
    <div className="card-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b border-border text-left text-xs font-semibold uppercase tracking-wider">
            <th className="px-4 py-2.5">Date</th>
            <th className="px-4 py-2.5">Player A</th>
            <th className="px-4 py-2.5">Player B</th>
            <th className="px-4 py-2.5">Score</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((match) => (
            <tr
              key={match.id}
              className={cn(
                'border-b border-border transition-colors last:border-0 hover:bg-foreground/5',
                match.is_voided && 'opacity-50',
              )}
            >
              <td className="text-muted-foreground px-4 py-3">{match.match_date}</td>
              <td className="px-4 py-3">
                <PlayerCell player={match.player_a} won={match.winner_id === match.player_a_id} />
              </td>
              <td className="px-4 py-3">
                <PlayerCell player={match.player_b} won={match.winner_id === match.player_b_id} />
              </td>
              <td className="px-4 py-3 font-bold tabular-nums">
                <Link to={`/matches/${match.id}`} className="hover:text-primary hover:underline">
                  {match.frames_a}–{match.frames_b}
                </Link>
                {match.is_voided && <span className="ml-2 text-xs font-normal italic">(voided)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
