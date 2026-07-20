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

import { usePendingClaims } from './usePendingClaims';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePendingClaims', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('maps joined player names onto each pending claim', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'c1', user_id: 'u1', created_at: '2026-07-20', player_id: 'p1', players: { full_name: 'Alex' } },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePendingClaims(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'c1', user_id: 'u1', created_at: '2026-07-20', player_id: 'p1', player_name: 'Alex' },
    ]);
  });
});
