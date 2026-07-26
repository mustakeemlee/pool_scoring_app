// web/src/pages/Settings.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useSubmitPlayerClaim } from '@/hooks/useSubmitPlayerClaim';
import { usePlayerPhotoUpload } from '@/hooks/usePlayerPhotoUpload';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { usePlayers } from '@/hooks/usePlayers';
import { supabase } from '@/lib/supabaseClient';

function AccountSection() {
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSavingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setPassword('');
    toast.success('Password updated.');
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email });
    setIsSavingEmail(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Check your new email address for a confirmation link.');
  }

  return (
    <div className="card-surface mb-6 p-6">
      <h2 className="mb-4 text-lg font-bold">Account</h2>
      <form onSubmit={handlePasswordSubmit} className="mb-6 flex flex-col gap-3">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <Button type="submit" disabled={isSavingPassword} className="self-start">
          {isSavingPassword ? 'Saving…' : 'Update password'}
        </Button>
      </form>
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
        <Label htmlFor="email">Change email</Label>
        <Input
          id="email"
          type="email"
          placeholder={session?.user.email ?? ''}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={isSavingEmail} className="self-start">
          {isSavingEmail ? 'Saving…' : 'Update email'}
        </Button>
      </form>
    </div>
  );
}

function AdminDisplayNameSection({ userId }: { userId: string }) {
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    const { error } = await supabase.from('admin_users').update({ display_name: displayName }).eq('id', userId);
    setIsSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Display name updated.');
  }

  return (
    <div className="card-surface mb-6 p-6">
      <h2 className="mb-4 text-lg font-bold">Admin profile</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Label htmlFor="displayName">Display name</Label>
        <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Button type="submit" disabled={isSaving} className="self-start">
          {isSaving ? 'Saving…' : 'Update display name'}
        </Button>
      </form>
    </div>
  );
}

function LinkedPlayerSection({ playerId, seasonId }: { playerId: string; seasonId: string }) {
  const players = usePlayers(seasonId);
  const player = players.data?.find((p) => p.id === playerId);
  const { inputRef, isUploading, handleFile, handleRemove } = usePlayerPhotoUpload(
    { id: playerId, full_name: player?.full_name ?? '' },
    seasonId,
  );

  if (!player) return null;

  return (
    <div className="card-surface mb-6 p-6">
      <h2 className="mb-4 text-lg font-bold">Player profile</h2>
      <p className="mb-4 text-sm font-medium">Linked to: {player.full_name}</p>
      <div className="flex items-center gap-4">
        <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="lg" />
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
        <Button type="button" disabled={isUploading} onClick={() => inputRef.current?.click()}>
          {isUploading ? 'Working…' : player.photo_url ? 'Replace photo' : 'Upload photo'}
        </Button>
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
      </div>
    </div>
  );
}

function ClaimSection({ userId, seasonId }: { userId: string; seasonId: string }) {
  const players = usePlayers(seasonId);
  const submitClaim = useSubmitPlayerClaim();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');

  function handleSubmit() {
    if (!selectedPlayerId) return;
    submitClaim.mutate(
      { userId, playerId: selectedPlayerId },
      {
        onSuccess: () => toast.success('Claim submitted — an admin will review it.'),
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to submit claim.'),
      },
    );
  }

  return (
    <div className="card-surface mb-6 p-6">
      <h2 className="mb-2 text-lg font-bold">Claim your player profile</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Pick your name from the league roster. An admin will review and approve the link.
      </p>
      <div className="flex gap-3">
        <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Select your name…" />
          </SelectTrigger>
          <SelectContent>
            {players.data?.map((player) => (
              <SelectItem key={player.id} value={player.id}>
                {player.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" disabled={!selectedPlayerId || submitClaim.isPending} onClick={handleSubmit}>
          {submitClaim.isPending ? 'Submitting…' : 'Submit claim'}
        </Button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);
  const seasonSelector = useSeasonSelector();

  if (isAdmin.isLoading || userProfile.isLoading || seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError || seasonSelector.isError || !userId) {
    return <p className="text-destructive">Couldn't load your account. Try refreshing.</p>;
  }

  const seasonId = seasonSelector.selectedSeasonId ?? '';

  return (
    <div className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-extrabold">Settings</h1>
      <AccountSection />
      {isAdmin.data === true && <AdminDisplayNameSection userId={userId} />}
      {userProfile.data?.linkedPlayerId ? (
        <LinkedPlayerSection playerId={userProfile.data.linkedPlayerId} seasonId={seasonId} />
      ) : userProfile.data?.pendingClaim ? (
        <div className="card-surface mb-6 p-6">
          <h2 className="mb-2 text-lg font-bold">Player profile</h2>
          <p className="text-muted-foreground text-sm">Your claim is pending review by an admin.</p>
        </div>
      ) : (
        <ClaimSection userId={userId} seasonId={seasonId} />
      )}
    </div>
  );
}
