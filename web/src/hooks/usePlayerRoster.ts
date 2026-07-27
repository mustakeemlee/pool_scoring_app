import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface PlayerRosterEntry {
  id: string;
  full_name: string;
  photo_url?: string | null;
}

export function usePlayerRoster() {
  return useQuery({
    queryKey: queryKeys.playerRoster(),
    queryFn: async (): Promise<PlayerRosterEntry[]> => {
      const { data, error } = await supabase
        .from('players')
        .select('id, full_name, photo_url')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;

      const rawPlayers = data as { id: string; full_name: string; photo_url: string | null }[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(rawPlayers.map((p) => p.photo_url));
      return rawPlayers.map((player) => ({
        id: player.id,
        full_name: player.full_name,
        photo_url: pickResolvedUrl(photoUrlByPath, player.photo_url),
      }));
    },
  });
}
