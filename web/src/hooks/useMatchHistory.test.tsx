// web/src/hooks/useMatchHistory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: mockOrder,
        }),
      }),
    }),
  },
}));

import { useMatchHistory } from './useMatchHistory';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMatchHistory', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns every match for the season, newest first', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 'm1', match_date: '2026-01-22', player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } }],
      error: null,
    });

    const { result } = renderHook(() => useMatchHistory('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockOrder).toHaveBeenCalledWith('match_date', { ascending: false });
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useMatchHistory(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
