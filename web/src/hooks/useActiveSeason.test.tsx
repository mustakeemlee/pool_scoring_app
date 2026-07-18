// web/src/hooks/useActiveSeason.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMaybeSingle = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        }),
      }),
    }),
  },
}));

import { useActiveSeason } from './useActiveSeason';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useActiveSeason', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it('returns the season with status=active', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      error: null,
    });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('s1');
    expect(result.current.data?.status).toBe('active');
  });

  it('surfaces a query error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'no active season' } });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('throws a clear error when zero rows match (no active season)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('No active season found.');
  });
});
