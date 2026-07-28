// web/src/hooks/useHeadToHead.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface HeadToHeadTally {
  winsA: number;
  winsB: number;
  played: number;
}

export function useHeadToHead(playerAId: string | undefined, playerBId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.headToHead(playerAId ?? '', playerBId ?? ''),
    queryFn: async (): Promise<HeadToHeadTally> => {
      const { data, error } = await supabase
        .from('matches')
        .select('winner_id')
        .eq('is_voided', false)
        .or(
          `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`,
        );
      if (error) throw error;

      const rows = data as { winner_id: string }[];
      return {
        winsA: rows.filter((row) => row.winner_id === playerAId).length,
        winsB: rows.filter((row) => row.winner_id === playerBId).length,
        played: rows.length,
      };
    },
    enabled: playerAId !== undefined && playerBId !== undefined,
  });
}
