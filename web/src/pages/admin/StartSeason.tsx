// web/src/pages/admin/StartSeason.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonInFlightOverview } from '@/components/SeasonInFlightOverview';
import { useSeasons } from '@/hooks/useSeasons';
import { startSeason } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function StartSeasonPage() {
  const queryClient = useQueryClient();
  const seasons = useSeasons();

  const [newSeasonName, setNewSeasonName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [previousSeasonId, setPreviousSeasonId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    if (!newSeasonName.trim()) {
      setError('Season name is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await startSeason({
        new_season_name: newSeasonName,
        start_date: startDate,
        previous_season_id: previousSeasonId || undefined,
      });
      toast.success(`Season "${newSeasonName}" created.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.seasons() });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeSeason() });
      queryClient.invalidateQueries({ queryKey: queryKeys.seasonInFlight() });
      setNewSeasonName('');
      setPreviousSeasonId('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start season.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (seasons.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (seasons.isError) {
    return <p className="text-destructive">Couldn't load seasons. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start Season</h1>
      <SeasonInFlightOverview />
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="newSeasonName">New season name</Label>
          <Input
            id="newSeasonName"
            value={newSeasonName}
            onChange={(e) => setNewSeasonName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="previousSeason">Carry over ratings from</Label>
          <select
            id="previousSeason"
            value={previousSeasonId}
            onChange={(e) => setPreviousSeasonId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">None (fresh start)</option>
            {seasons.data?.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <ConfirmDialog
          trigger={
            <Button type="button" disabled={isSubmitting || !newSeasonName.trim()}>
              Start Season
            </Button>
          }
          title={`Start season "${newSeasonName}"?`}
          description={
            previousSeasonId
              ? 'This creates a new season and carries over ratings from the selected season using the soft-reset formula. This cannot be undone.'
              : 'This creates a new season with no ratings carried over. This cannot be undone.'
          }
          confirmLabel="Confirm Start Season"
          onConfirm={handleConfirm}
          isConfirming={isSubmitting}
        />
      </div>
    </div>
  );
}
