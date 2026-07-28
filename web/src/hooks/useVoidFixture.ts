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
      // Scoped to status='scheduled' so a void racing a concurrent completion
      // (or triggered from a stale UI after another admin already completed
      // it) can't silently overwrite a fixture that's no longer scheduled.
      // update() alone doesn't error on a zero-row match, so select() is
      // needed to detect and report that case.
      const { data, error } = await supabase
        .from('fixtures')
        .update({ status: 'voided' })
        .eq('id', fixtureId)
        .eq('status', 'scheduled')
        .select();
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('This fixture has already been completed or voided.');
      }
    },
    onSuccess: (_data, { seasonId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.fixtures(seasonId) });
    },
  });
}
