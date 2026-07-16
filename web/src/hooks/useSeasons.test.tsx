// web/src/hooks/useSeasons.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ order: mockOrder }) }) },
}));

import { useSeasons } from './useSeasons';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSeasons', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns every season, newest first', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
      error: null,
    });
    const { result } = renderHook(() => useSeasons(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockOrder).toHaveBeenCalledWith('start_date', { ascending: false });
  });
});
