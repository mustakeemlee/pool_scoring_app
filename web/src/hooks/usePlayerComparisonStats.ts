// web/src/hooks/usePlayerComparisonStats.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Grade } from '@/lib/types';

export interface ComparisonStats {
  rating: number | null;
  grade: Grade | null;
  wins: number | null;
  losses: number | null;
  win_pct: number | null;
  form_5: number | null;
  form_10: number | null;
}

export function usePlayerComparisonStats(playerId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerComparisonStats(playerId ?? '', seasonId ?? ''),
    queryFn: async (): Promise<ComparisonStats> => {
      const [ratingRes, statsRes] = await Promise.all([
        supabase
          .from('player_season_ratings')
          .select('rating, grade')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
        supabase
          .from('player_statistics')
          .select('wins, losses, win_pct, form_5, form_10')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
      ]);
      if (ratingRes.error) throw ratingRes.error;
      if (statsRes.error) throw statsRes.error;

      const rating = ratingRes.data as { rating: number; grade: Grade } | null;
      const stats = statsRes.data as {
        wins: number;
        losses: number;
        win_pct: number;
        form_5: number | null;
        form_10: number | null;
      } | null;

      return {
        rating: rating?.rating ?? null,
        grade: rating?.grade ?? null,
        wins: stats?.wins ?? null,
        losses: stats?.losses ?? null,
        win_pct: stats?.win_pct ?? null,
        form_5: stats?.form_5 ?? null,
        form_10: stats?.form_10 ?? null,
      };
    },
    enabled: playerId !== undefined && seasonId !== undefined,
  });
}
