// web/src/hooks/useGradeDistribution.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockEq = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: mockEq,
      }),
    }),
  },
}));

import { useGradeDistribution } from './useGradeDistribution';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useGradeDistribution', () => {
  beforeEach(() => mockEq.mockReset());

  it('returns the raw distribution rows for the season', async () => {
    mockEq.mockResolvedValue({ data: [{ season_id: 's1', grade: 'A+', player_count: 2 }], error: null });

    const { result } = renderHook(() => useGradeDistribution('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ season_id: 's1', grade: 'A+', player_count: 2 }]);
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useGradeDistribution(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
