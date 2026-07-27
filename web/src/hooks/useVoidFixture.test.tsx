// web/src/hooks/useVoidFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/lib/queryKeys';

const mockEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ update: () => ({ eq: (...args: unknown[]) => mockEq(...args) }) }) },
}));

import { useVoidFixture } from './useVoidFixture';

function renderVoidFixture() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useVoidFixture(), { wrapper });
  return { result, invalidateSpy };
}

describe('useVoidFixture', () => {
  beforeEach(() => {
    mockEq.mockReset();
  });

  it('voids a fixture and invalidates the fixtures cache for that season', async () => {
    mockEq.mockResolvedValue({ error: null });
    const { result, invalidateSpy } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockEq).toHaveBeenCalledWith('id', 'f1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.fixtures('s1') });
  });

  it('surfaces an update error', async () => {
    mockEq.mockResolvedValue({ error: new Error('boom') });
    const { result } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
