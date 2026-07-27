// web/src/hooks/useSeasonInFlight.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockSeasonMaybeSingle = vi.fn();
const mockMatchesEq = vi.fn();
const mockRatingsEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'seasons') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: mockSeasonMaybeSingle }) }) }),
          }),
        };
      }
      if (table === 'matches') {
        return { select: () => ({ eq: mockMatchesEq }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: mockRatingsEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { useSeasonInFlight } from './useSeasonInFlight';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSeasonInFlight', () => {
  beforeEach(() => {
    mockSeasonMaybeSingle.mockReset();
    mockMatchesEq.mockReset();
    mockRatingsEq.mockReset();
  });

  it('returns the active season with its match count, active player count, and days elapsed', async () => {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 10);
    const startDateStr = startDate.toISOString().slice(0, 10);

    mockSeasonMaybeSingle.mockResolvedValue({
      data: { id: 's1', name: 'Season 2026', start_date: startDateStr, end_date: null, status: 'active' },
      error: null,
    });
    mockMatchesEq.mockResolvedValue({ count: 12, error: null });
    mockRatingsEq.mockResolvedValue({ count: 8, error: null });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.season).toMatchObject({ id: 's1', name: 'Season 2026', status: 'active' });
    expect(result.current.data?.matchesPlayed).toBe(12);
    expect(result.current.data?.activePlayerCount).toBe(8);
    // Computed the same way the implementation does. Both run within the same
    // test process at effectively the same instant, so this isn't
    // meaningfully time-flaky (it would only mismatch if the process
    // happened to cross a UTC day boundary between these two lines).
    const expectedDays = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(result.current.data?.daysElapsed).toBe(expectedDays);
  });

  it('returns season: null (not an error) when no season is currently active', async () => {
    mockSeasonMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 });
    expect(result.current.isError).toBe(false);
    expect(mockMatchesEq).not.toHaveBeenCalled();
    expect(mockRatingsEq).not.toHaveBeenCalled();
  });

  it('surfaces a real fetch failure as an error', async () => {
    mockSeasonMaybeSingle.mockResolvedValue({ data: null, error: new Error('network down') });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
