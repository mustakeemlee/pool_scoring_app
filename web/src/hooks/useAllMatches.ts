// web/src/hooks/useAllMatches.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { MatchRow } from '@/lib/types';

// Explore's match search spans every season, not just the active one --
// capped rather than unbounded since it's fetched in full and filtered
// client-side (fine at this app's scale; see useAllMatches.test.tsx).
const MAX_MATCHES = 200;

export function useAllMatches() {
  return useQuery({
    queryKey: queryKeys.allMatches(),
    queryFn: async (): Promise<MatchRow[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)')
        .order('match_date', { ascending: false })
        .limit(MAX_MATCHES);
      if (error) throw error;
      const matches = data as unknown as MatchRow[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(
        matches.flatMap((m) => [m.player_a.photo_url, m.player_b.photo_url]),
      );
      return matches.map((match) => ({
        ...match,
        player_a: { ...match.player_a, photo_url: pickResolvedUrl(photoUrlByPath, match.player_a.photo_url) },
        player_b: { ...match.player_b, photo_url: pickResolvedUrl(photoUrlByPath, match.player_b.photo_url) },
      }));
    },
  });
}
