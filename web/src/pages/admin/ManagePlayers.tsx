// web/src/pages/admin/ManagePlayers.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { usePlayers, type PlayerOption } from '@/hooks/usePlayers';
import { usePlayerPhotoUpload } from '@/hooks/usePlayerPhotoUpload';
import { usePendingClaims } from '@/hooks/usePendingClaims';
import { reviewPlayerClaim } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

function PlayerPhotoRow({ player, seasonId }: { player: PlayerOption; seasonId: string }) {
  const { inputRef, isUploading, handleFile, handleRemove } = usePlayerPhotoUpload(player, seasonId);

  return (
    <li className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
      <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{player.full_name}</p>
        <p className="text-muted-foreground text-xs">Rating {Math.round(player.rating)}</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={isUploading}
        onClick={() => inputRef.current?.click()}
        className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition-transform hover:scale-105 disabled:opacity-50"
      >
        {isUploading ? 'Working…' : player.photo_url ? 'Replace photo' : 'Upload photo'}
      </button>
      {player.photo_url && (
        <button
          type="button"
          disabled={isUploading}
          onClick={() => void handleRemove()}
          className="text-muted-foreground hover:text-destructive text-xs font-medium transition-colors disabled:opacity-50"
        >
          Remove
        </button>
      )}
    </li>
  );
}

function PendingClaimsSection() {
  const queryClient = useQueryClient();
  const pendingClaims = usePendingClaims();
  const [isReviewing, setIsReviewing] = useState(false);

  async function handleReview(claimId: string, decision: 'approve' | 'reject') {
    setIsReviewing(true);
    try {
      await reviewPlayerClaim({ claim_id: claimId, decision });
      toast.success(decision === 'approve' ? 'Claim approved.' : 'Claim rejected.');
      queryClient.invalidateQueries({ queryKey: queryKeys.pendingClaims() });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to review claim.');
    } finally {
      setIsReviewing(false);
    }
  }

  if (!pendingClaims.data || pendingClaims.data.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="mb-3 text-lg font-bold">Pending claims</h2>
      <ul className="card-surface overflow-hidden">
        {pendingClaims.data.map((claim) => (
          <li key={claim.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
            <p className="flex-1 font-semibold">{claim.player_name}</p>
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  disabled={isReviewing}
                  className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  Approve
                </button>
              }
              title={`Approve this claim for ${claim.player_name}?`}
              description="This links the account to this player and rejects any other pending claim on the same player."
              confirmLabel="Confirm Approve"
              onConfirm={() => void handleReview(claim.id, 'approve')}
              isConfirming={isReviewing}
            />
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  disabled={isReviewing}
                  className="text-muted-foreground hover:text-destructive text-xs font-medium disabled:opacity-50"
                >
                  Reject
                </button>
              }
              title={`Reject this claim for ${claim.player_name}?`}
              description="The account stays unlinked and can submit a new claim later."
              confirmLabel="Confirm Reject"
              onConfirm={() => void handleReview(claim.id, 'reject')}
              isConfirming={isReviewing}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ManagePlayersPage() {
  const seasonSelector = useSeasonSelector();
  const players = usePlayers(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (players.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (players.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  return (
    <div className="max-w-2xl">
      <PendingClaimsSection />
      <h1 className="mb-1 text-2xl font-extrabold">Players</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Upload player photos — they'll appear on the leaderboard, match history, and player profiles.
      </p>
      <ul className="card-surface overflow-hidden">
        {players.data?.map((player) => (
          <PlayerPhotoRow key={player.id} player={player} seasonId={seasonSelector.selectedSeasonId ?? ''} />
        ))}
      </ul>
    </div>
  );
}
