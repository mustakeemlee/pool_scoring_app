// web/src/hooks/useGradeRoster.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { Grade } from '@/lib/types';

export interface GradeRosterEntry {
  player_id: string;
  full_name: string;
  photo_url: string | null;
  rating: number;
  season_points: number;
  matches_played: number;
}

export function useGradeRoster(seasonId: string | undefined, grade: Grade | undefined) {
  return useQuery({
    queryKey: queryKeys.gradeRoster(seasonId ?? '', grade ?? ''),
    queryFn: async (): Promise<GradeRosterEntry[]> => {
      const { data, error } = await supabase
        .from('player_season_ratings')
        .select('player_id, rating, season_points, matches_played, player:player_id(full_name, photo_url)')
        .eq('season_id', seasonId as string)
        .eq('grade', grade as string)
        .order('rating', { ascending: false });
      if (error) throw error;

      const rows = data as unknown as {
        player_id: string;
        rating: number;
        season_points: number;
        matches_played: number;
        player: { full_name: string; photo_url: string | null };
      }[];

      const photoUrlByPath = await resolvePlayerPhotoUrls(rows.map((r) => r.player.photo_url));
      return rows.map((row) => ({
        player_id: row.player_id,
        full_name: row.player.full_name,
        photo_url: pickResolvedUrl(photoUrlByPath, row.player.photo_url),
        rating: row.rating,
        season_points: row.season_points,
        matches_played: row.matches_played,
      }));
    },
    enabled: seasonId !== undefined && grade !== undefined,
  });
}
