// web/src/hooks/useSeasonInFlight.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface SeasonInFlight {
  season: Season | null;
  matchesPlayed: number;
  activePlayerCount: number;
  daysElapsed: number;
}

export function useSeasonInFlight() {
  return useQuery({
    queryKey: queryKeys.seasonInFlight(),
    queryFn: async (): Promise<SeasonInFlight> => {
      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .select('*')
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (seasonError) throw seasonError;

      const season = seasonData as Season | null;
      if (!season) {
        return { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 };
      }

      const [matchesRes, ratingsRes] = await Promise.all([
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', season.id),
        supabase
          .from('player_season_ratings')
          .select('player_id', { count: 'exact', head: true })
          .eq('season_id', season.id),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (ratingsRes.error) throw ratingsRes.error;

      const daysElapsed = Math.max(
        0,
        Math.floor((Date.now() - new Date(season.start_date).getTime()) / MS_PER_DAY),
      );

      return {
        season,
        matchesPlayed: matchesRes.count ?? 0,
        activePlayerCount: ratingsRes.count ?? 0,
        daysElapsed,
      };
    },
  });
}
