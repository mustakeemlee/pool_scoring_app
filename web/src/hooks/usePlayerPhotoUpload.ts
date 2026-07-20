// web/src/hooks/usePlayerPhotoUpload.ts
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PhotoUploadTarget {
  id: string;
  full_name: string;
}

export function usePlayerPhotoUpload(player: PhotoUploadTarget, seasonId: string) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.players(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(player.id, seasonId) });
  }

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast.error('Photo must be 5MB or smaller.');
      return;
    }

    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      const path = `${player.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('player-photos')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('player-photos').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('players')
        .update({ photo_url: urlData.publicUrl })
        .eq('id', player.id);
      if (updateError) throw updateError;

      toast.success(`Photo updated for ${player.full_name}`);
      invalidate();
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setIsUploading(true);
    try {
      const { error: updateError } = await supabase
        .from('players')
        .update({ photo_url: null })
        .eq('id', player.id);
      if (updateError) throw updateError;
      toast.success(`Photo removed for ${player.full_name}`);
      invalidate();
    } catch (removeError) {
      toast.error(removeError instanceof Error ? removeError.message : 'Failed to remove photo.');
    } finally {
      setIsUploading(false);
    }
  }

  return { inputRef, isUploading, handleFile, handleRemove };
}
