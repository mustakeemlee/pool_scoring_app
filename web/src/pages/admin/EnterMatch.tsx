// web/src/pages/admin/EnterMatch.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { OddsWidget } from '@/components/OddsWidget';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { enterMatch } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function EnterMatchPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);

  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [framesA, setFramesA] = useState('');
  const [framesB, setFramesB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const playerA = players.data?.find((p) => p.id === playerAId);
  const playerB = players.data?.find((p) => p.id === playerBId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!playerAId || !playerBId) {
      setError('Select both players.');
      return;
    }
    if (playerAId === playerBId) {
      setError('Player A and Player B must be different.');
      return;
    }

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
    if (!activeSeason.data) {
      setError('No active season.');
      return;
    }

    setIsSubmitting(true);
    try {
      await enterMatch({
        season_id: activeSeason.data.id,
        match_date: matchDate,
        player_a_id: playerAId,
        player_b_id: playerBId,
        frames_a: parsedFramesA,
        frames_b: parsedFramesB,
      });

      const winnerName = parsedFramesA > parsedFramesB ? playerA?.full_name : playerB?.full_name;
      const winnerFrames = Math.max(parsedFramesA, parsedFramesB);
      const loserFrames = Math.min(parsedFramesA, parsedFramesB);
      toast.success(`${winnerName} wins ${winnerFrames}–${loserFrames}`);

      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerAId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerBId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.players(activeSeason.data.id) });

      setPlayerAId('');
      setPlayerBId('');
      setFramesA('');
      setFramesB('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to record match.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load the match entry form. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Enter Match Result</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="matchDate">Match date</Label>
          <Input
            id="matchDate"
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="playerA">Player A</Label>
          <select
            id="playerA"
            value={playerAId}
            onChange={(e) => setPlayerAId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player A</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="playerB">Player B</Label>
          <select
            id="playerB"
            value={playerBId}
            onChange={(e) => setPlayerBId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player B</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        {playerA && playerB && (
          <OddsWidget
            playerARating={playerA.rating}
            playerBRating={playerB.rating}
            playerAName={playerA.full_name}
            playerBName={playerB.full_name}
          />
        )}

        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="framesA">Frames A</Label>
            <Input
              id="framesA"
              type="number"
              min={0}
              value={framesA}
              onChange={(e) => setFramesA(e.target.value)}
              required
            />
          </div>
          <span className="pb-2">–</span>
          <div>
            <Label htmlFor="framesB">Frames B</Label>
            <Input
              id="framesB"
              type="number"
              min={0}
              value={framesB}
              onChange={(e) => setFramesB(e.target.value)}
              required
            />
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Submitting…' : 'Submit Match'}
        </Button>
      </form>
    </div>
  );
}
