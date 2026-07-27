// web/src/hooks/useRecentActivity.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { MatchRow } from '@/lib/types';

// Both the recent-matches list and the raw "recently joined" candidate pool
// are capped at this size, then merged and re-capped to the same size --
// see the merge step below.
const FEED_LIMIT = 5;

export interface RecentActivityPlayer {
  id: string;
  full_name: string;
  photo_url?: string | null;
  activity: 'match' | 'signup';
  activity_date: string;
}

export interface RecentActivity {
  recentMatches: MatchRow[];
  recentPlayers: RecentActivityPlayer[];
}

export function useRecentActivity() {
  return useQuery({
    queryKey: queryKeys.recentActivity(),
    queryFn: async (): Promise<RecentActivity> => {
      const [matchesRes, playersRes] = await Promise.all([
        supabase
          .from('matches')
          .select('*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)')
          .order('match_date', { ascending: false })
          .limit(FEED_LIMIT),
        supabase
          .from('players')
          .select('id, full_name, photo_url, joined_date')
          .eq('is_active', true)
          .order('joined_date', { ascending: false })
          .limit(FEED_LIMIT),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;

      const rawMatches = matchesRes.data as unknown as MatchRow[];
      const rawPlayers = playersRes.data as {
        id: string;
        full_name: string;
        photo_url: string | null;
        joined_date: string;
      }[];

      const photoUrlByPath = await resolvePlayerPhotoUrls([
        ...rawMatches.flatMap((m) => [m.player_a.photo_url, m.player_b.photo_url]),
        ...rawPlayers.map((p) => p.photo_url),
      ]);

      const recentMatches = rawMatches.map((match) => ({
        ...match,
        player_a: { ...match.player_a, photo_url: pickResolvedUrl(photoUrlByPath, match.player_a.photo_url) },
        player_b: { ...match.player_b, photo_url: pickResolvedUrl(photoUrlByPath, match.player_b.photo_url) },
      }));

      // Merge two activity signals into one list: playing in a recent match,
      // or being a recent signup. Each player keeps whichever activity is
      // more recent; ties keep the match-derived entry.
      const candidatesById = new Map<string, RecentActivityPlayer>();
      for (const match of recentMatches) {
        for (const player of [match.player_a, match.player_b]) {
          const existing = candidatesById.get(player.id);
          if (!existing || match.match_date > existing.activity_date) {
            candidatesById.set(player.id, {
              id: player.id,
              full_name: player.full_name,
              photo_url: player.photo_url,
              activity: 'match',
              activity_date: match.match_date,
            });
          }
        }
      }
      for (const player of rawPlayers) {
        const existing = candidatesById.get(player.id);
        if (!existing || player.joined_date > existing.activity_date) {
          candidatesById.set(player.id, {
            id: player.id,
            full_name: player.full_name,
            photo_url: pickResolvedUrl(photoUrlByPath, player.photo_url),
            activity: 'signup',
            activity_date: player.joined_date,
          });
        }
      }

      const recentPlayers = [...candidatesById.values()]
        .sort((a, b) => (a.activity_date < b.activity_date ? 1 : a.activity_date > b.activity_date ? -1 : 0))
        .slice(0, FEED_LIMIT);

      return { recentMatches, recentPlayers };
    },
  });
}
