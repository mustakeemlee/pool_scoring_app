// web/src/hooks/useVoidFixture.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface VoidFixtureArgs {
  fixtureId: string;
  seasonId: string;
}

export function useVoidFixture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fixtureId }: VoidFixtureArgs) => {
      const { error } = await supabase.from('fixtures').update({ status: 'voided' }).eq('id', fixtureId);
      if (error) throw error;
    },
    onSuccess: (_data, { seasonId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(seasonId) });
    },
  });
}
