// web/src/hooks/useFixture.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { FixtureStatus } from './useFixtures';

export interface FixtureDetail {
  id: string;
  season_id: string;
  scheduled_date: string;
  status: FixtureStatus;
  completed_match_id: string | null;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
}

export function useFixture(fixtureId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fixtureDetail(fixtureId ?? ''),
    queryFn: async (): Promise<FixtureDetail | null> => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(
          'id, season_id, scheduled_date, status, completed_match_id, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
        )
        .eq('id', fixtureId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const row = data as unknown as FixtureDetail;
      const photoUrlByPath = await resolvePlayerPhotoUrls([row.player_a.photo_url, row.player_b.photo_url]);
      return {
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
      };
    },
    enabled: fixtureId !== undefined,
  });
}
