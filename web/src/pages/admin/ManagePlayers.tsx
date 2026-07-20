// web/src/pages/admin/ManagePlayers.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers, type PlayerOption } from '@/hooks/usePlayers';
import { usePlayerPhotoUpload } from '@/hooks/usePlayerPhotoUpload';

function PlayerPhotoRow({ player, seasonId }: { player: PlayerOption; seasonId: string }) {
  const { inputRef, isUploading, handleFile, handleRemove } = usePlayerPhotoUpload(player, seasonId);

  return (
    <li className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
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

export function ManagePlayersPage() {
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-extrabold">Players</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Upload player photos — they'll appear on the leaderboard, match history, and player profiles.
      </p>
      <ul className="card-surface overflow-hidden">
        {players.data?.map((player) => (
          <PlayerPhotoRow key={player.id} player={player} seasonId={activeSeason.data?.id ?? ''} />
        ))}
      </ul>
    </div>
  );
}
