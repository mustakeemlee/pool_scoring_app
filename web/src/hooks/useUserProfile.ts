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
        // .maybeSingle() (not .single()): accounts created before the
        // on_auth_user_created trigger existed (20260720000000_player_accounts.sql)
        // have no user_profiles row until the backfill migration runs, and even
        // after backfilling this is a strictly safer read -- a missing row means
        // "not linked", not an error.
        supabase.from('user_profiles').select('linked_player_id').eq('id', userId as string).maybeSingle(),
        // Not .maybeSingle(): the design spec explicitly allows a user to have
        // more than one pending claim (extra ones are "cosmetic clutter, not a
        // security issue"), and .maybeSingle() errors on more than one row.
        // Take the oldest pending claim instead.
        supabase
          .from('player_claims')
          .select('*')
          .eq('user_id', userId as string)
          .eq('status', 'pending')
          .order('created_at', { ascending: true }),
      ]);
      if (profileRes.error) throw profileRes.error;
      if (claimRes.error) throw claimRes.error;

      return {
        linkedPlayerId: (profileRes.data as { linked_player_id: string | null } | null)?.linked_player_id ?? null,
        pendingClaim: (claimRes.data?.[0] as PlayerClaim | undefined) ?? null,
      };
    },
    enabled: userId !== undefined,
  });
}
