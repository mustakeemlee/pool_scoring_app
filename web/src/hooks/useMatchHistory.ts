// web/src/hooks/useMatchHistory.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { MatchRow } from '@/lib/types';

export function useMatchHistory(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.matchHistory(seasonId ?? ''),
    queryFn: async (): Promise<MatchRow[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)')
        .eq('season_id', seasonId as string)
        .order('match_date', { ascending: false });
      if (error) throw error;
      return data as unknown as MatchRow[];
    },
    enabled: seasonId !== undefined,
  });
}
