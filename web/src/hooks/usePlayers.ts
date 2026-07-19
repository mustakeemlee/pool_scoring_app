// web/src/hooks/usePlayers.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface PlayerOption {
  id: string;
  full_name: string;
  rating: number;
  photo_url?: string | null;
}

export function usePlayers(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.players(seasonId ?? ''),
    queryFn: async (): Promise<PlayerOption[]> => {
      const [playersRes, ratingsRes] = await Promise.all([
        supabase.from('players').select('id, full_name, photo_url').eq('is_active', true).order('full_name', { ascending: true }),
        supabase.from('player_season_ratings').select('player_id, rating').eq('season_id', seasonId as string),
      ]);
      if (playersRes.error) throw playersRes.error;
      if (ratingsRes.error) throw ratingsRes.error;

      const ratingByPlayerId = new Map(
        (ratingsRes.data as { player_id: string; rating: number }[]).map((r) => [r.player_id, r.rating]),
      );
      return (playersRes.data as { id: string; full_name: string; photo_url: string | null }[]).map((player) => ({
        id: player.id,
        full_name: player.full_name,
        photo_url: player.photo_url,
        rating: ratingByPlayerId.get(player.id) ?? 1500,
      }));
    },
    enabled: seasonId !== undefined,
  });
}
