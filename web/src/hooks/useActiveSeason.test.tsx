// web/src/hooks/useActiveSeason.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockSingle = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
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
    mockSingle.mockReset();
  });

  it('returns the season with status=active', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      error: null,
    });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('s1');
    expect(result.current.data?.status).toBe('active');
  });

  it('surfaces a query error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'no active season' } });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
