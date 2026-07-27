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

import { usePlayerRoster } from './usePlayerRoster';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerRoster', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns the active player roster, ordered by name, without fetching ratings', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePlayerRoster(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
      { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
    ]);
    expect(mockOrder).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => usePlayerRoster(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
