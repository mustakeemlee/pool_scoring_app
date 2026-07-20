// web/src/hooks/usePendingClaims.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface PendingClaimWithPlayer {
  id: string;
  user_id: string;
  player_id: string;
  player_name: string;
  created_at: string;
}

interface PendingClaimRow {
  id: string;
  user_id: string;
  created_at: string;
  player_id: string;
  players: { full_name: string } | null;
}

export function usePendingClaims() {
  return useQuery({
    queryKey: queryKeys.pendingClaims(),
    queryFn: async (): Promise<PendingClaimWithPlayer[]> => {
      const { data, error } = await supabase
        .from('player_claims')
        .select('id, user_id, created_at, player_id, players(full_name)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
      if (error) throw error;

      return (data as unknown as PendingClaimRow[]).map((row) => ({
        id: row.id,
        user_id: row.user_id,
        player_id: row.player_id,
        created_at: row.created_at,
        player_name: row.players?.full_name ?? 'Unknown player',
      }));
    },
  });
}
