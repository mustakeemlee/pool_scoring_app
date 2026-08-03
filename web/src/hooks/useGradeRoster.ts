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
      // Queries leaderboard_view (not player_season_ratings directly) so a
      // player's grade here always agrees with grade_distribution_view's
      // counts on the Grades page -- both apply the same "0 matches played
      // this season -> grade 'D'" coalesce over the same players x seasons
      // cross join. player_season_ratings alone has no row at all for a
      // player who hasn't played yet this season, so filtering it by grade
      // directly silently dropped every player the distribution counted
      // under 'D' for that reason.
      const { data, error } = await supabase
        .from('leaderboard_view')
        .select('player_id, full_name, photo_url, rating, season_points, matches_played')
        .eq('season_id', seasonId as string)
        .eq('grade', grade as string)
        .order('rating', { ascending: false });
      if (error) throw error;

      const rows = data as unknown as {
        player_id: string;
        full_name: string;
        photo_url: string | null;
        rating: number;
        season_points: number;
        matches_played: number;
      }[];

      const photoUrlByPath = await resolvePlayerPhotoUrls(rows.map((r) => r.photo_url));
      return rows.map((row) => ({
        player_id: row.player_id,
        full_name: row.full_name,
        photo_url: pickResolvedUrl(photoUrlByPath, row.photo_url),
        rating: row.rating,
        season_points: row.season_points,
        matches_played: row.matches_played,
      }));
    },
    enabled: seasonId !== undefined && grade !== undefined,
  });
}
