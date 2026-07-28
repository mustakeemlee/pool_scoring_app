// web/src/hooks/useVoidFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/lib/queryKeys';

const mockEq = vi.fn();
const mockSelect = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: (...args: unknown[]) => {
          mockEq(...args);
          return {
            eq: (...args2: unknown[]) => {
              mockEq(...args2);
              return { select: mockSelect };
            },
          };
        },
      }),
    }),
  },
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
    mockSelect.mockReset();
  });

  it('voids a scheduled fixture and invalidates the fixtures cache for that season', async () => {
    mockSelect.mockResolvedValue({ data: [{ id: 'f1', status: 'voided' }], error: null });
    const { result, invalidateSpy } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockEq).toHaveBeenNthCalledWith(1, 'id', 'f1');
    expect(mockEq).toHaveBeenNthCalledWith(2, 'status', 'scheduled');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.fixtures('s1') });
  });

  it('surfaces an update error', async () => {
    mockSelect.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('rejects voiding a fixture that is no longer scheduled (already completed or voided)', async () => {
    mockSelect.mockResolvedValue({ data: [], error: null });
    const { result } = renderVoidFixture();

    result.current.mutate({ fixtureId: 'f1', seasonId: 's1' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('This fixture has already been completed or voided.');
  });
});
