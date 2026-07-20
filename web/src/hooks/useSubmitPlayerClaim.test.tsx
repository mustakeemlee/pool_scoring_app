import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockInsert = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ insert: mockInsert }) },
}));

import { useSubmitPlayerClaim } from './useSubmitPlayerClaim';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSubmitPlayerClaim', () => {
  beforeEach(() => {
    mockInsert.mockReset();
  });

  it('inserts a pending claim row for the given user and player', async () => {
    mockInsert.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useSubmitPlayerClaim(), { wrapper });

    result.current.mutate({ userId: 'u1', playerId: 'p1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInsert).toHaveBeenCalledWith({ user_id: 'u1', player_id: 'p1' });
  });
});
