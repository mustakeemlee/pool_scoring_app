// web/src/hooks/useCreateFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/lib/queryKeys';

const mockInsert = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ insert: (...args: unknown[]) => mockInsert(...args) }) },
}));

import { useCreateFixture } from './useCreateFixture';

function renderCreateFixture() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateFixture(), { wrapper });
  return { result, invalidateSpy };
}

describe('useCreateFixture', () => {
  beforeEach(() => {
    mockInsert.mockReset();
  });

  it('inserts a fixture and invalidates the fixtures cache for that season', async () => {
    mockInsert.mockResolvedValue({ error: null });
    const { result, invalidateSpy } = renderCreateFixture();

    result.current.mutate({ seasonId: 's1', scheduledDate: '2026-08-01', playerAId: 'p1', playerBId: 'p2' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInsert).toHaveBeenCalledWith({
      season_id: 's1',
      scheduled_date: '2026-08-01',
      player_a_id: 'p1',
      player_b_id: 'p2',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.fixtures('s1') });
  });

  it('surfaces an insert error', async () => {
    mockInsert.mockResolvedValue({ error: new Error('boom') });
    const { result } = renderCreateFixture();

    result.current.mutate({ seasonId: 's1', scheduledDate: '2026-08-01', playerAId: 'p1', playerBId: 'p2' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
