// web/src/hooks/useGradeDistribution.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { GradeDistributionEntry } from '@/lib/types';

export function useGradeDistribution(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gradeDistribution(seasonId ?? ''),
    queryFn: async (): Promise<GradeDistributionEntry[]> => {
      const { data, error } = await supabase
        .from('grade_distribution_view')
        .select('*')
        .eq('season_id', seasonId as string);
      if (error) throw error;
      return data as GradeDistributionEntry[];
    },
    enabled: seasonId !== undefined,
  });
}
