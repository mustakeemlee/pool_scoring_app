// web/src/hooks/usePlayerProfile.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { PlayerSeasonRating, PlayerStatistics, RatingEvent, MatchRow, PlayerSummary } from '@/lib/types';

export interface PlayerProfileData {
  player: PlayerSummary;
  seasonRating: PlayerSeasonRating | null;
  statistics: PlayerStatistics | null;
  ratingEvents: RatingEvent[];
  matches: MatchRow[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function usePlayerProfile(playerId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerProfile(playerId ?? '', seasonId ?? ''),
    queryFn: async (): Promise<PlayerProfileData> => {
      const [playerRes, ratingRes, statsRes, eventsRes, matchesRes] = await Promise.all([
        supabase.from('players').select('id, full_name, photo_url').eq('id', playerId as string).single(),
        supabase
          .from('player_season_ratings')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
        supabase
          .from('player_statistics')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
        supabase
          .from('rating_events')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string),
        supabase
          .from('matches')
          .select('*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)')
          .eq('season_id', seasonId as string)
          .eq('is_voided', false)
          .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
          .order('match_date', { ascending: false })
          .limit(20),
      ]);

      if (playerRes.error) throw playerRes.error;
      if (ratingRes.error) throw ratingRes.error;
      if (statsRes.error) throw statsRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (matchesRes.error) throw matchesRes.error;

      const player = playerRes.data as PlayerSummary;
      const matches = matchesRes.data as unknown as MatchRow[];
      const photoUrlByPath = await resolvePlayerPhotoUrls([
        player.photo_url,
        ...matches.flatMap((m) => [m.player_a.photo_url, m.player_b.photo_url]),
      ]);

      return {
        player: { ...player, photo_url: pickResolvedUrl(photoUrlByPath, player.photo_url) },
        seasonRating: ratingRes.data as PlayerSeasonRating | null,
        statistics: statsRes.data as PlayerStatistics | null,
        ratingEvents: eventsRes.data as RatingEvent[],
        matches: matches.map((match) => ({
          ...match,
          player_a: { ...match.player_a, photo_url: pickResolvedUrl(photoUrlByPath, match.player_a.photo_url) },
          player_b: { ...match.player_b, photo_url: pickResolvedUrl(photoUrlByPath, match.player_b.photo_url) },
        })),
      };
    },
    enabled: playerId !== undefined && seasonId !== undefined && UUID_RE.test(playerId),
  });
}
