// web/src/hooks/useLeaderboard.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { LeaderboardEntry } from '@/lib/types';

export function useLeaderboard(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.leaderboard(seasonId ?? ''),
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await supabase
        .from('leaderboard_view')
        .select('*')
        .eq('season_id', seasonId as string)
        .order('rank', { ascending: true });
      if (error) throw error;
      const entries = data as LeaderboardEntry[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(entries.map((e) => e.photo_url));
      return entries.map((entry) => ({ ...entry, photo_url: pickResolvedUrl(photoUrlByPath, entry.photo_url) }));
    },
    enabled: seasonId !== undefined,
  });
}
