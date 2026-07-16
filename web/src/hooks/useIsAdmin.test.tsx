// web/src/hooks/useIsAdmin.test.tsx
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
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  },
}));

import { useIsAdmin } from './useIsAdmin';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useIsAdmin', () => {
  beforeEach(() => mockMaybeSingle.mockReset());

  it('resolves true when an admin_users row exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'u1' }, error: null });
    const { result } = renderHook(() => useIsAdmin('u1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });

  it('resolves false when no admin_users row exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useIsAdmin('u2'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it('does not run when userId is undefined', () => {
    const { result } = renderHook(() => useIsAdmin(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
