// web/src/hooks/usePlayerOfTheWeek.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockFrom = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

interface QueryResult {
  data: unknown;
  error: unknown;
}

function makeBuilder(result: QueryResult) {
  const builder: {
    eq: () => typeof builder;
    order: () => typeof builder;
    then: (resolve: (value: QueryResult) => void) => void;
  } = {
    eq: () => builder,
    order: () => builder,
    then: (resolve) => resolve(result),
  };
  return builder;
}

import { usePlayerOfTheWeek } from './usePlayerOfTheWeek';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerOfTheWeek', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('picks the player with the largest positive rating gain between the two most recent weeks', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { week_ending: '2026-07-22' },
              { week_ending: '2026-07-22' },
              { week_ending: '2026-07-15' },
              { week_ending: '2026-07-15' },
            ],
            error: null,
          }),
      })
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { player_id: 'p1', rating: 1900, player: { full_name: 'Alex Testplayer', photo_url: null } },
              { player_id: 'p2', rating: 1780, player: { full_name: 'Jordan Testplayer', photo_url: null } },
            ],
            error: null,
          }),
      })
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { player_id: 'p1', rating: 1830 },
              { player_id: 'p2', rating: 1770 },
            ],
            error: null,
          }),
      });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      player_id: 'p1',
      full_name: 'Alex Testplayer',
      photo_url: null,
      ratingGain: 70,
    });
  });

  it('returns null (not an error) when fewer than two distinct weeks exist yet', async () => {
    mockFrom.mockReturnValueOnce({
      select: () => makeBuilder({ data: [{ week_ending: '2026-07-22' }], error: null }),
    });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a seasonId is provided', () => {
    const { result } = renderHook(() => usePlayerOfTheWeek(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockFrom.mockReturnValueOnce({
      select: () => makeBuilder({ data: null, error: new Error('boom') }),
    });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
