// web/src/pages/admin/CloseWeek.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useOpenMatches } from '@/hooks/useOpenMatches';
import { closeWeek, type CloseWeekResponse } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function CloseWeekPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const openMatches = useOpenMatches(activeSeason.data?.id);

  const [weekEnding, setWeekEnding] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [result, setResult] = useState<CloseWeekResponse | null>(null);

  const matchesInWeek = (openMatches.data ?? []).filter((match) => match.match_date <= weekEnding);
  const playerCount = new Set(matchesInWeek.flatMap((match) => [match.player_a_id, match.player_b_id])).size;

  async function handleConfirm() {
    if (!activeSeason.data) return;
    setError(null);
    setIsClosing(true);
    try {
      const response = await closeWeek({ season_id: activeSeason.data.id, week_ending: weekEnding });
      setResult(response);
      toast.success(`Closed ${response.closed_matches} matches for ${response.players_reconciled} players.`);

      const seasonId = activeSeason.data.id;
      queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.players(seasonId) });
      queryClient.invalidateQueries({ queryKey: ['playerProfile'] });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to close the week.');
    } finally {
      setIsClosing(false);
    }
  }

  if (activeSeason.isLoading || openMatches.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || openMatches.isError) {
    return <p className="text-destructive">Couldn't load open matches. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Close Week</h1>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="weekEnding">Week ending</Label>
          <Input id="weekEnding" type="date" value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)} />
        </div>
        <p className="text-sm">This will close every open match on or before this date.</p>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <ConfirmDialog
          trigger={
            <Button type="button" disabled={matchesInWeek.length === 0 || isClosing}>
              Close Week
            </Button>
          }
          title={`Close the week ending ${weekEnding}?`}
          description={`This locks ${matchesInWeek.length} match(es) and runs Glicko-2 reconciliation for ${playerCount} player(s). This cannot be undone.`}
          confirmLabel="Confirm Close Week"
          onConfirm={handleConfirm}
          isConfirming={isClosing}
        />
        {result && (
          <p className="text-sm">
            Closed {result.closed_matches} matches, reconciled {result.players_reconciled} players.
          </p>
        )}
      </div>
    </div>
  );
}
