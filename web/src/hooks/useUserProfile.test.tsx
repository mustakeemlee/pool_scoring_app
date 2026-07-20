import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockProfileSingle = vi.fn();
const mockClaimMaybeSingle = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'user_profiles') {
        return { select: () => ({ eq: () => ({ single: mockProfileSingle }) }) };
      }
      if (table === 'player_claims') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockClaimMaybeSingle }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { useUserProfile } from './useUserProfile';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useUserProfile', () => {
  beforeEach(() => {
    mockProfileSingle.mockReset();
    mockClaimMaybeSingle.mockReset();
  });

  it('returns the linked player id and any pending claim', async () => {
    mockProfileSingle.mockResolvedValue({ data: { linked_player_id: 'p1' }, error: null });
    mockClaimMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useUserProfile('u1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ linkedPlayerId: 'p1', pendingClaim: null });
  });

  it('does not run when userId is undefined', () => {
    const { result } = renderHook(() => useUserProfile(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
