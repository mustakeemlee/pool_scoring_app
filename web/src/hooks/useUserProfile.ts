// web/src/hooks/useUserProfile.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { PlayerClaim } from '@/lib/types';

export interface UserAccountState {
  linkedPlayerId: string | null;
  pendingClaim: PlayerClaim | null;
}

export function useUserProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userProfile(userId ?? ''),
    queryFn: async (): Promise<UserAccountState> => {
      const [profileRes, claimRes] = await Promise.all([
        supabase.from('user_profiles').select('linked_player_id').eq('id', userId as string).single(),
        supabase
          .from('player_claims')
          .select('*')
          .eq('user_id', userId as string)
          .eq('status', 'pending')
          .maybeSingle(),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (claimRes.error) throw claimRes.error;

      return {
        linkedPlayerId: (profileRes.data as { linked_player_id: string | null }).linked_player_id,
        pendingClaim: claimRes.data as PlayerClaim | null,
      };
    },
    enabled: userId !== undefined,
  });
}
