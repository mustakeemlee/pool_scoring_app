// web/src/hooks/useSeasons.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

export function useSeasons() {
  return useQuery({
    queryKey: queryKeys.seasons(),
    queryFn: async (): Promise<Season[]> => {
      const { data, error } = await supabase.from('seasons').select('*').order('start_date', { ascending: false });
      if (error) throw error;
      return data as Season[];
    },
  });
}
