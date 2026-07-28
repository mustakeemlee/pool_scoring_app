// web/src/hooks/useMatch.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface MatchDetail {
  id: string;
  season_id: string;
  match_date: string;
  frames_a: number;
  frames_b: number;
  winner_id: string;
  is_voided: boolean;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
  rating_delta_a: number | null;
  rating_delta_b: number | null;
}

export function useMatch(matchId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.matchDetail(matchId ?? ''),
    queryFn: async (): Promise<MatchDetail | null> => {
      const [matchRes, eventsRes] = await Promise.all([
        supabase
          .from('matches')
          .select(
            'id, season_id, match_date, frames_a, frames_b, winner_id, is_voided, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
          )
          .eq('id', matchId as string)
          .maybeSingle(),
        supabase
          .from('rating_events')
          .select('player_id, delta')
          .eq('match_id', matchId as string)
          .eq('event_type', 'instant'),
      ]);
      if (matchRes.error) throw matchRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (!matchRes.data) return null;

      const row = matchRes.data as unknown as Omit<MatchDetail, 'rating_delta_a' | 'rating_delta_b'>;
      const events = eventsRes.data as { player_id: string; delta: number }[];
      const deltaFor = (playerId: string) => events.find((event) => event.player_id === playerId)?.delta ?? null;

      const photoUrlByPath = await resolvePlayerPhotoUrls([row.player_a.photo_url, row.player_b.photo_url]);
      return {
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
        rating_delta_a: deltaFor(row.player_a.id),
        rating_delta_b: deltaFor(row.player_b.id),
      };
    },
    enabled: matchId !== undefined,
  });
}
