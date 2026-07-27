// web/src/hooks/useFixtures.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mockOrder }) }) }),
  },
}));

import { useFixtures } from './useFixtures';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useFixtures', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns fixtures for the season, ordered by scheduled date', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'f1',
          season_id: 's1',
          scheduled_date: '2026-08-01',
          status: 'scheduled',
          completed_match_id: null,
          player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useFixtures('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        id: 'f1',
        season_id: 's1',
        scheduled_date: '2026-08-01',
        status: 'scheduled',
        completed_match_id: null,
        player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
      },
    ]);
  });

  it('stays disabled until a seasonId is provided', () => {
    const { result } = renderHook(() => useFixtures(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useFixtures('s1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
