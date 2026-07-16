// web/src/pages/admin/CorrectMatch.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useOpenMatches } from '@/hooks/useOpenMatches';
import { correctMatch } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';
import type { MatchRow } from '@/lib/types';

export function CorrectMatchPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const openMatches = useOpenMatches(activeSeason.data?.id);

  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [framesA, setFramesA] = useState('');
  const [framesB, setFramesB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function selectMatch(match: MatchRow) {
    setSelectedMatch(match);
    setFramesA(String(match.frames_a));
    setFramesB(String(match.frames_b));
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedMatch) return;
    setError(null);

    const parsedFramesA = Number(framesA);
    const parsedFramesB = Number(framesB);
    if (Number.isNaN(parsedFramesA) || Number.isNaN(parsedFramesB)) {
      setError('Frames must be numbers.');
      return;
    }
    if (parsedFramesA === parsedFramesB) {
      setError('Frame scores cannot be tied.');
      return;
    }

    setIsSubmitting(true);
    try {
      await correctMatch({ match_id: selectedMatch.id, frames_a: parsedFramesA, frames_b: parsedFramesB });
      toast.success('Match corrected.');

      if (activeSeason.data) {
        const seasonId = activeSeason.data.id;
        queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(selectedMatch.player_a_id, seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(selectedMatch.player_b_id, seasonId) });
      }

      setSelectedMatch(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to correct match.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (activeSeason.isLoading || openMatches.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || openMatches.isError) {
    return <p className="text-destructive">Couldn't load open matches. Try refreshing.</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Correct a Match</h1>
      {!selectedMatch ? (
        <div className="flex flex-col gap-2">
          {(openMatches.data ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">No open matches this week.</p>
          )}
          {openMatches.data?.map((match) => (
            <div key={match.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                {match.match_date}: {match.player_a.full_name} {match.frames_a}–{match.frames_b}{' '}
                {match.player_b.full_name}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => selectMatch(match)}>
                Correct
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
          <p className="text-sm">
            {selectedMatch.player_a.full_name} vs {selectedMatch.player_b.full_name} — {selectedMatch.match_date}
          </p>
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="correctFramesA">Frames A</Label>
              <Input
                id="correctFramesA"
                type="number"
                min={0}
                value={framesA}
                onChange={(e) => setFramesA(e.target.value)}
                required
              />
            </div>
            <span className="pb-2">–</span>
            <div>
              <Label htmlFor="correctFramesB">Frames B</Label>
              <Input
                id="correctFramesB"
                type="number"
                min={0}
                value={framesB}
                onChange={(e) => setFramesB(e.target.value)}
                required
              />
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Correction'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSelectedMatch(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
