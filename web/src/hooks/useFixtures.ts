// web/src/hooks/useFixtures.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export type FixtureStatus = 'scheduled' | 'completed' | 'voided';

export interface Fixture {
  id: string;
  season_id: string;
  scheduled_date: string;
  status: FixtureStatus;
  completed_match_id: string | null;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
}

export function useFixtures(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fixtures(seasonId ?? ''),
    queryFn: async (): Promise<Fixture[]> => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(
          '*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
        )
        .eq('season_id', seasonId as string)
        .order('scheduled_date', { ascending: true });
      if (error) throw error;

      const rows = data as unknown as Fixture[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(
        rows.flatMap((row) => [row.player_a.photo_url, row.player_b.photo_url]),
      );
      return rows.map((row) => ({
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
      }));
    },
    enabled: seasonId !== undefined,
  });
}
