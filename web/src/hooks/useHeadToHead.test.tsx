// web/src/hooks/useHeadToHead.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOr = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ or: mockOr }) }) }),
  },
}));

import { useHeadToHead } from './useHeadToHead';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useHeadToHead', () => {
  beforeEach(() => {
    mockOr.mockReset();
  });

  it('tallies wins per player regardless of which player was player_a in each match', async () => {
    mockOr.mockResolvedValue({
      data: [{ winner_id: 'pA' }, { winner_id: 'pB' }, { winner_id: 'pA' }],
      error: null,
    });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ winsA: 2, winsB: 1, played: 3 });
  });

  it('returns played: 0 with no wins when the two players have never met', async () => {
    mockOr.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ winsA: 0, winsB: 0, played: 0 });
  });

  it('stays disabled until both player ids are provided', () => {
    const { result } = renderHook(() => useHeadToHead(undefined, 'pB'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOr).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOr.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
