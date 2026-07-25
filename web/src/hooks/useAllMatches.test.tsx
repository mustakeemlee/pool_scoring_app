// web/src/hooks/useAllMatches.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockLimit = vi.fn();
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ order: mockOrder }) }) },
}));

import { useAllMatches } from './useAllMatches';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAllMatches', () => {
  beforeEach(() => {
    mockOrder.mockClear();
    mockLimit.mockReset();
  });

  it('returns matches across every season, newest first, capped at 200', async () => {
    mockLimit.mockResolvedValue({
      data: [
        { id: 'm1', match_date: '2026-01-22', player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAllMatches(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockOrder).toHaveBeenCalledWith('match_date', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(200);
  });
});
