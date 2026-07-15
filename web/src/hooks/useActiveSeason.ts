// web/src/hooks/useActiveSeason.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

export function useActiveSeason() {
  return useQuery({
    queryKey: queryKeys.activeSeason(),
    queryFn: async (): Promise<Season> => {
      const { data, error } = await supabase.from('seasons').select('*').eq('status', 'active').single();
      if (error) throw error;
      return data as Season;
    },
  });
}
