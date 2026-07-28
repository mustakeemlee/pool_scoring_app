// web/src/hooks/useMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMatchMaybeSingle = vi.fn();
const mockEventsMatchIdEq = vi.fn();
const mockEventsEventTypeEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'matches') {
        return { select: () => ({ eq: () => ({ maybeSingle: mockMatchMaybeSingle }) }) };
      }
      if (table === 'rating_events') {
        return {
          select: () => ({
            eq: (...args: unknown[]) => {
              mockEventsMatchIdEq(...args);
              return { eq: (...args2: unknown[]) => mockEventsEventTypeEq(...args2) };
            },
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { useMatch } from './useMatch';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const MATCH_ROW = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-03-01',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
};

describe('useMatch', () => {
  beforeEach(() => {
    mockMatchMaybeSingle.mockReset();
    mockEventsMatchIdEq.mockReset();
    mockEventsEventTypeEq.mockReset();
  });

  it("combines the match with each player's instant rating delta from that match", async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: MATCH_ROW, error: null });
    mockEventsEventTypeEq.mockResolvedValue({
      data: [
        { player_id: 'p1', delta: 12.5 },
        { player_id: 'p2', delta: -12.5 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ...MATCH_ROW, rating_delta_a: 12.5, rating_delta_b: -12.5 });
    // Verifies the actual filter logic, not just the delta-matching over
    // already-shaped mock rows: scoped to this match and to instant nudges
    // only (never a weekly-reconciliation event, which can't be attributed
    // to one match).
    expect(mockEventsMatchIdEq).toHaveBeenCalledWith('match_id', 'm1');
    expect(mockEventsEventTypeEq).toHaveBeenCalledWith('event_type', 'instant');
  });

  it('returns null rating deltas when no instant rating_events exist for this match', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: MATCH_ROW, error: null });
    mockEventsEventTypeEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rating_delta_a).toBeNull();
    expect(result.current.data?.rating_delta_b).toBeNull();
  });

  it('returns null when no match matches the given id', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockEventsEventTypeEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('missing'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a matchId is provided', () => {
    const { result } = renderHook(() => useMatch(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockMatchMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error from the match query', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    mockEventsEventTypeEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
