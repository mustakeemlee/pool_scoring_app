// web/src/hooks/useSubmitPlayerClaim.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export function useSubmitPlayerClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, playerId }: { userId: string; playerId: string }) => {
      const { error } = await supabase.from('player_claims').insert({ user_id: userId, player_id: playerId });
      if (error) throw error;
    },
    onSuccess: (_data, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userProfile(userId) });
    },
  });
}
