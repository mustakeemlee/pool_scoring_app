// web/src/hooks/usePlayers.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockPlayersOrder = vi.fn();
const mockRatingsEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ order: mockPlayersOrder }) }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: mockRatingsEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { usePlayers } from './usePlayers';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayers', () => {
  beforeEach(() => {
    mockPlayersOrder.mockReset();
    mockRatingsEq.mockReset();
  });

  it('merges players with their current-season rating, defaulting missing ones to 1500', async () => {
    mockPlayersOrder.mockResolvedValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer' },
        { id: 'p2', full_name: 'Brand New Player' },
      ],
      error: null,
    });
    mockRatingsEq.mockResolvedValue({ data: [{ player_id: 'p1', rating: 1768 }], error: null });

    const { result } = renderHook(() => usePlayers('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null, rating: 1768 },
      { id: 'p2', full_name: 'Brand New Player', photo_url: null, rating: 1500 },
    ]);
  });

  it('does not run when seasonId is undefined', () => {
    const { result } = renderHook(() => usePlayers(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
