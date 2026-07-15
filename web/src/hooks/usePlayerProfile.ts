// web/src/hooks/usePlayerProfile.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { PlayerSeasonRating, PlayerStatistics, RatingEvent, MatchRow, PlayerSummary } from '@/lib/types';

export interface PlayerProfileData {
  player: PlayerSummary;
  seasonRating: PlayerSeasonRating;
  statistics: PlayerStatistics | null;
  ratingEvents: RatingEvent[];
  matches: MatchRow[];
}

export function usePlayerProfile(playerId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerProfile(playerId ?? '', seasonId ?? ''),
    queryFn: async (): Promise<PlayerProfileData> => {
      const [playerRes, ratingRes, statsRes, eventsRes, matchesRes] = await Promise.all([
        supabase.from('players').select('id, full_name').eq('id', playerId as string).single(),
        supabase
          .from('player_season_ratings')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .single(),
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
          .select('*, player_a:player_a_id(id, full_name), player_b:player_b_id(id, full_name)')
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

      return {
        player: playerRes.data as PlayerSummary,
        seasonRating: ratingRes.data as PlayerSeasonRating,
        statistics: statsRes.data as PlayerStatistics | null,
        ratingEvents: eventsRes.data as RatingEvent[],
        matches: matchesRes.data as unknown as MatchRow[],
      };
    },
    enabled: playerId !== undefined && seasonId !== undefined,
  });
}
