// web/src/hooks/useGradeRoster.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: mockOrder }) }) }) }),
  },
}));

import { useGradeRoster } from './useGradeRoster';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useGradeRoster', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns players in the requested grade, already sorted by rating by the query', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          player_id: 'p1',
          rating: 1900,
          season_points: 20,
          matches_played: 10,
          player: { full_name: 'Alex Testplayer', photo_url: null },
        },
        {
          player_id: 'p2',
          rating: 1850,
          season_points: 18,
          matches_played: 9,
          player: { full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useGradeRoster('s1', 'A+'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        player_id: 'p1',
        full_name: 'Alex Testplayer',
        photo_url: null,
        rating: 1900,
        season_points: 20,
        matches_played: 10,
      },
      {
        player_id: 'p2',
        full_name: 'Jordan Testplayer',
        photo_url: null,
        rating: 1850,
        season_points: 18,
        matches_played: 9,
      },
    ]);
  });

  it('stays disabled until both seasonId and grade are provided', () => {
    const { result } = renderHook(() => useGradeRoster(undefined, undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useGradeRoster('s1', 'A+'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
