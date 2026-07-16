// web/src/hooks/useOpenMatches.test.tsx
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
          eq: () => ({
            eq: () => ({
              order: mockOrder,
            }),
          }),
        }),
      }),
    }),
  },
}));

import { useOpenMatches } from './useOpenMatches';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useOpenMatches', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns open, non-voided matches for the season', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 'm1', match_date: '2026-01-22', player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } }],
      error: null,
    });
    const { result } = renderHook(() => useOpenMatches('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('does not run when seasonId is undefined', () => {
    const { result } = renderHook(() => useOpenMatches(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
