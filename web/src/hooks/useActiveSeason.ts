// web/src/hooks/useActiveSeason.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

export function useActiveSeason() {
  return useQuery({
    queryKey: queryKeys.activeSeason(),
    queryFn: async (): Promise<Season> => {
      const { data, error } = await supabase
        .from('seasons')
        .select('*')
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('No active season found.');
      return data as Season;
    },
  });
}
