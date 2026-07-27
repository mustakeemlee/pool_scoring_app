// web/src/pages/admin/CreateFixture.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { useCreateFixture } from '@/hooks/useCreateFixture';

export function CreateFixturePage() {
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);
  const createFixture = useCreateFixture();

  const [scheduledDate, setScheduledDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    if (!activeSeason.data) {
      setError('No active season.');
      return;
    }

    try {
      await createFixture.mutateAsync({
        seasonId: activeSeason.data.id,
        scheduledDate,
        playerAId,
        playerBId,
      });
      toast.success('Fixture scheduled.');
      setPlayerAId('');
      setPlayerBId('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to schedule fixture.');
    }
  }

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load the fixture form. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Schedule Fixture</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="scheduledDate">Scheduled date</Label>
          <Input
            id="scheduledDate"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
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
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={createFixture.isPending} className="self-start">
          {createFixture.isPending ? 'Scheduling…' : 'Schedule Fixture'}
        </Button>
      </form>
    </div>
  );
}
