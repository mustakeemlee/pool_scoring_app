// web/src/hooks/usePlayerOfTheWeek.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface PlayerOfTheWeek {
  player_id: string;
  full_name: string;
  photo_url: string | null;
  ratingGain: number;
}

export function usePlayerOfTheWeek(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerOfTheWeek(seasonId ?? ''),
    queryFn: async (): Promise<PlayerOfTheWeek | null> => {
      const { data: weekRows, error: weekError } = await supabase
        .from('weekly_rankings')
        .select('week_ending')
        .eq('season_id', seasonId as string)
        .order('week_ending', { ascending: false });
      if (weekError) throw weekError;

      const distinctWeeks = [...new Set((weekRows as { week_ending: string }[]).map((row) => row.week_ending))];
      if (distinctWeeks.length < 2) return null;

      const [latestWeek, previousWeek] = distinctWeeks;

      const [latestRes, previousRes] = await Promise.all([
        supabase
          .from('weekly_rankings')
          .select('player_id, rating, player:player_id(full_name, photo_url)')
          .eq('season_id', seasonId as string)
          .eq('week_ending', latestWeek),
        supabase
          .from('weekly_rankings')
          .select('player_id, rating')
          .eq('season_id', seasonId as string)
          .eq('week_ending', previousWeek),
      ]);
      if (latestRes.error) throw latestRes.error;
      if (previousRes.error) throw previousRes.error;

      const latestRows = latestRes.data as unknown as {
        player_id: string;
        rating: number;
        player: { full_name: string; photo_url: string | null };
      }[];
      const previousRows = previousRes.data as unknown as { player_id: string; rating: number }[];

      const previousRatingByPlayer = new Map(previousRows.map((row) => [row.player_id, row.rating]));

      let best: PlayerOfTheWeek | null = null;
      for (const row of latestRows) {
        const previousRating = previousRatingByPlayer.get(row.player_id);
        if (previousRating === undefined) continue;
        const gain = row.rating - previousRating;
        if (gain > 0 && (!best || gain > best.ratingGain)) {
          best = {
            player_id: row.player_id,
            full_name: row.player.full_name,
            photo_url: row.player.photo_url,
            ratingGain: gain,
          };
        }
      }

      if (!best) return null;

      const photoUrlByPath = await resolvePlayerPhotoUrls([best.photo_url]);
      return { ...best, photo_url: pickResolvedUrl(photoUrlByPath, best.photo_url) };
    },
    enabled: seasonId !== undefined,
  });
}
