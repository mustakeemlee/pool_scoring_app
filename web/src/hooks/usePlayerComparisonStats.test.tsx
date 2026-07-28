// web/src/hooks/usePlayerComparisonStats.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRatingMaybeSingle = vi.fn();
const mockStatsMaybeSingle = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockRatingMaybeSingle }) }) }) };
      }
      if (table === 'player_statistics') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockStatsMaybeSingle }) }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { usePlayerComparisonStats } from './usePlayerComparisonStats';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerComparisonStats', () => {
  beforeEach(() => {
    mockRatingMaybeSingle.mockReset();
    mockStatsMaybeSingle.mockReset();
  });

  it('combines the current rating/grade with season statistics', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: { rating: 1700, grade: 'A' }, error: null });
    mockStatsMaybeSingle.mockResolvedValue({
      data: { wins: 5, losses: 2, win_pct: 71.43, form_5: 80, form_10: 70 },
      error: null,
    });

    const { result } = renderHook(() => usePlayerComparisonStats('p1', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      rating: 1700,
      grade: 'A',
      wins: 5,
      losses: 2,
      win_pct: 71.43,
      form_5: 80,
      form_10: 70,
    });
  });

  it('returns all-null fields when the player has no rating or statistics row yet this season', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePlayerComparisonStats('p2', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      rating: null,
      grade: null,
      wins: null,
      losses: null,
      win_pct: null,
      form_5: null,
      form_10: null,
    });
  });

  it('stays disabled until both playerId and seasonId are provided', () => {
    const { result } = renderHook(() => usePlayerComparisonStats(undefined, 's1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRatingMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePlayerComparisonStats('p1', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
