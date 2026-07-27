// web/src/hooks/useRecentActivity.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMatchesLimit = vi.fn();
const mockPlayersLimit = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'matches') {
        return { select: () => ({ order: () => ({ limit: mockMatchesLimit }) }) };
      }
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: mockPlayersLimit }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { useRecentActivity } from './useRecentActivity';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useRecentActivity', () => {
  beforeEach(() => {
    mockMatchesLimit.mockReset();
    mockPlayersLimit.mockReset();
  });

  it('returns the most recent matches and merges recently-active players by whichever activity is most recent', async () => {
    mockMatchesLimit.mockResolvedValue({
      data: [
        {
          id: 'm1',
          season_id: 's1',
          match_date: '2026-07-25',
          player_a_id: 'p1',
          player_b_id: 'p2',
          frames_a: 4,
          frames_b: 2,
          winner_id: 'p1',
          is_voided: false,
          is_period_closed: false,
          player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });
    mockPlayersLimit.mockResolvedValue({
      data: [
        { id: 'p3', full_name: 'Brand New Player', photo_url: null, joined_date: '2026-07-26' },
        { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null, joined_date: '2026-01-01' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMatchesLimit).toHaveBeenCalledWith(5);
    expect(mockPlayersLimit).toHaveBeenCalledWith(5);

    expect(result.current.data?.recentMatches).toHaveLength(1);
    expect(result.current.data?.recentMatches[0].id).toBe('m1');

    const players = result.current.data?.recentPlayers ?? [];
    // p3 is the newest signup (2026-07-26); p1 only appears via the match
    // (2026-07-25); p2 appears in both, but their match date (07-25) is more
    // recent than their join date (01-01), so their entry stays 'match'.
    expect(players.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
    expect(players.find((p) => p.id === 'p3')).toMatchObject({ activity: 'signup', activity_date: '2026-07-26' });
    expect(players.find((p) => p.id === 'p1')).toMatchObject({ activity: 'match', activity_date: '2026-07-25' });
    expect(players.find((p) => p.id === 'p2')).toMatchObject({ activity: 'match', activity_date: '2026-07-25' });
  });

  it('surfaces a matches-fetch failure as an error', async () => {
    mockMatchesLimit.mockResolvedValue({ data: null, error: new Error('boom') });
    mockPlayersLimit.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('surfaces a players-fetch failure as an error', async () => {
    mockMatchesLimit.mockResolvedValue({ data: [], error: null });
    mockPlayersLimit.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
