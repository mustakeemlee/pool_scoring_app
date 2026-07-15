// web/src/hooks/useLeaderboard.test.tsx
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

import { useLeaderboard } from './useLeaderboard';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useLeaderboard', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns ranked entries for the given season', async () => {
    mockOrder.mockResolvedValue({
      data: [{ player_id: 'p1', full_name: 'Alex', season_id: 's1', rating: 1768, grade: 'A+', season_points: 142, rank: 1 }],
      error: null,
    });

    const { result } = renderHook(() => useLeaderboard('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].rank).toBe(1);
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useLeaderboard(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });
});
