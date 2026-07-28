import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { GradeBadge } from '@/components/GradeBadge';
import { cn } from '@/lib/utils';
import type { ComparisonStats } from '@/hooks/usePlayerComparisonStats';

export interface ComparisonPlayer extends ComparisonStats {
  id: string;
  full_name: string;
  photo_url: string | null;
}

export interface ComparisonResult {
  frames_a: number;
  frames_b: number;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
}

export interface HeadToHeadTally {
  winsA: number;
  winsB: number;
  played: number;
}

export interface MatchComparisonCardProps {
  date: string;
  playerA: ComparisonPlayer;
  playerB: ComparisonPlayer;
  headToHead: HeadToHeadTally;
  result?: ComparisonResult;
  voidedMessage?: string;
}

function dash(value: number | null): string {
  return value === null ? '—' : String(value);
}

function record(player: ComparisonPlayer): string {
  if (player.wins === null || player.losses === null) return '—';
  return `${player.wins}-${player.losses} (${dash(player.win_pct)}%)`;
}

function signedDelta(delta: number | null): string {
  if (delta === null) return '—';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

function StatRow({ label, valueA, valueB }: { label: string; valueA: ReactNode; valueB: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
      <span className="w-28 text-left font-bold tabular-nums">{valueA}</span>
      <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</span>
      <span className="w-28 text-right font-bold tabular-nums">{valueB}</span>
    </div>
  );
}

export function MatchComparisonCard({ date, playerA, playerB, headToHead, result, voidedMessage }: MatchComparisonCardProps) {
  const pctA = headToHead.played === 0 ? 50 : (headToHead.winsA / headToHead.played) * 100;

  return (
    <div className="card-surface overflow-hidden">
      {voidedMessage && (
        <p className="bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">
          {voidedMessage}
        </p>
      )}

      <div className="flex items-center justify-between gap-4 px-4 py-5">
        <Link to={`/players/${playerA.id}`} className="flex flex-col items-center gap-2 text-center hover:text-primary">
          <PlayerAvatar name={playerA.full_name} photoUrl={playerA.photo_url} size="lg" />
          <span className="font-bold">{playerA.full_name}</span>
          {playerA.grade && <GradeBadge grade={playerA.grade} />}
        </Link>
        <span className="text-muted-foreground text-sm font-semibold">{date}</span>
        <Link to={`/players/${playerB.id}`} className="flex flex-col items-center gap-2 text-center hover:text-primary">
          <PlayerAvatar name={playerB.full_name} photoUrl={playerB.photo_url} size="lg" />
          <span className="font-bold">{playerB.full_name}</span>
          {playerB.grade && <GradeBadge grade={playerB.grade} />}
        </Link>
      </div>

      {result && (
        <>
          <StatRow label="Score" valueA={result.frames_a} valueB={result.frames_b} />
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'font-bold tabular-nums',
                  result.rating_delta_a !== null && result.rating_delta_a > 0 && 'text-primary',
                  result.rating_delta_a !== null && result.rating_delta_a < 0 && 'text-destructive',
                )}
              >
                {signedDelta(result.rating_delta_a)}
              </span>
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Rating Change
              </span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  result.rating_delta_b !== null && result.rating_delta_b > 0 && 'text-primary',
                  result.rating_delta_b !== null && result.rating_delta_b < 0 && 'text-destructive',
                )}
              >
                {signedDelta(result.rating_delta_b)}
              </span>
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">Rating change from this match</p>
          </div>
        </>
      )}

      <StatRow label="Rating" valueA={dash(playerA.rating)} valueB={dash(playerB.rating)} />
      <StatRow label="Record" valueA={record(playerA)} valueB={record(playerB)} />
      <StatRow label="Form (Last 5)" valueA={dash(playerA.form_5)} valueB={dash(playerB.form_5)} />
      <StatRow label="Form (Last 10)" valueA={dash(playerA.form_10)} valueB={dash(playerB.form_10)} />

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{headToHead.winsA} wins</span>
          <span>Head-to-Head</span>
          <span>{headToHead.winsB} wins</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${pctA}%` }} />
          <div className="bg-destructive/60" style={{ width: `${100 - pctA}%` }} />
        </div>
        {headToHead.played === 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">No previous meetings</p>
        )}
      </div>
    </div>
  );
}
