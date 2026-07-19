// web/src/hooks/usePlayerProfile.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const playerResult = { data: { id: 'p1', full_name: 'Alex Testplayer' }, error: null };
const ratingResult = {
  data: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
  error: null,
};
const statsResult = { data: null, error: null };
const eventsResult = { data: [], error: null };
const matchesResult = { data: [], error: null };

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve(playerResult) }) }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(ratingResult) }) }) }) };
      }
      if (table === 'player_statistics') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(statsResult) }) }) }) };
      }
      if (table === 'rating_events') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve(eventsResult) }) }) };
      }
      if (table === 'matches') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  order: () => ({
                    limit: () => Promise.resolve(matchesResult),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { usePlayerProfile } from './usePlayerProfile';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines player, rating, statistics, events, and matches into one result', async () => {
    const { result } = renderHook(() => usePlayerProfile('11111111-1111-1111-1111-111111111111', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.player.full_name).toBe('Alex Testplayer');
    expect(result.current.data?.seasonRating?.grade).toBe('A+');
    expect(result.current.data?.statistics).toBeNull();
    expect(result.current.data?.ratingEvents).toEqual([]);
    expect(result.current.data?.matches).toEqual([]);
  });

  it('does not run when playerId or seasonId is undefined', () => {
    const { result } = renderHook(() => usePlayerProfile(undefined, 's1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not run when playerId is not a valid UUID', () => {
    const { result } = renderHook(() => usePlayerProfile('p1', 's1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
