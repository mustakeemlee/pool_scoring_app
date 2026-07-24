import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockProfileMaybeSingle = vi.fn();
const mockClaimOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'user_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: mockProfileMaybeSingle }) }) };
      }
      if (table === 'player_claims') {
        return { select: () => ({ eq: () => ({ eq: () => ({ order: mockClaimOrder }) }) }) };
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
    mockProfileMaybeSingle.mockReset();
    mockClaimOrder.mockReset();
  });

  it('returns the linked player id and any pending claim', async () => {
    mockProfileMaybeSingle.mockResolvedValue({ data: { linked_player_id: 'p1' }, error: null });
    mockClaimOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useUserProfile('u1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ linkedPlayerId: 'p1', pendingClaim: null });
  });

  it('does not run when userId is undefined', () => {
    const { result } = renderHook(() => useUserProfile(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('treats a missing user_profiles row as unlinked instead of erroring', async () => {
    // Pre-existing accounts created before the on_auth_user_created trigger
    // existed have no user_profiles row until the backfill migration runs.
    mockProfileMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockClaimOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useUserProfile('u1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ linkedPlayerId: null, pendingClaim: null });
  });

  it('returns the oldest pending claim when a user has more than one', async () => {
    mockProfileMaybeSingle.mockResolvedValue({ data: { linked_player_id: null }, error: null });
    mockClaimOrder.mockResolvedValue({
      data: [
        { id: 'claim-older', created_at: '2026-01-01T00:00:00Z' },
        { id: 'claim-newer', created_at: '2026-02-01T00:00:00Z' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useUserProfile('u1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pendingClaim).toEqual({ id: 'claim-older', created_at: '2026-01-01T00:00:00Z' });
  });
});
