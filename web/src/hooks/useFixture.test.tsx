// web/src/hooks/useFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  },
}));

import { useFixture } from './useFixture';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const ROW = {
  id: 'f1',
  season_id: 's1',
  scheduled_date: '2026-08-01',
  status: 'scheduled',
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
};

describe('useFixture', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it('returns the fixture with both players resolved', async () => {
    mockMaybeSingle.mockResolvedValue({ data: ROW, error: null });

    const { result } = renderHook(() => useFixture('f1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ROW);
  });

  it('returns null when no fixture matches the given id', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useFixture('missing'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a fixtureId is provided', () => {
    const { result } = renderHook(() => useFixture(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useFixture('f1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
