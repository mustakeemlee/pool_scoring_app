// web/src/hooks/useCreateFixture.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface CreateFixtureArgs {
  seasonId: string;
  scheduledDate: string;
  playerAId: string;
  playerBId: string;
}

export function useCreateFixture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ seasonId, scheduledDate, playerAId, playerBId }: CreateFixtureArgs) => {
      const { error } = await supabase.from('fixtures').insert({
        season_id: seasonId,
        scheduled_date: scheduledDate,
        player_a_id: playerAId,
        player_b_id: playerBId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { seasonId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(seasonId) });
    },
  });
}
