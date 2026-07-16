// web/src/pages/admin/CloseWeek.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useOpenMatches', () => ({
  useOpenMatches: () => ({
    data: [
      { id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: false, player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } },
    ],
    isLoading: false,
    isError: false,
  }),
}));

const mockCloseWeek = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ closeWeek: (body: unknown) => mockCloseWeek(body) }));

import { CloseWeekPage } from './CloseWeek';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CloseWeekPage />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('CloseWeekPage', () => {
  beforeEach(() => {
    mockCloseWeek.mockReset();
    mockToastSuccess.mockReset();
  });

  it('shows the blast radius (match/player count) before confirming', () => {
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument(); // match count
    expect(screen.getByText('2')).toBeInTheDocument(); // player count
  });

  it('calls closeWeek only after the confirm dialog is accepted', async () => {
    mockCloseWeek.mockResolvedValue({ closed_matches: 1, players_reconciled: 2 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Close Week' }));
    expect(mockCloseWeek).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));

    await waitFor(() =>
      expect(mockCloseWeek).toHaveBeenCalledWith({ season_id: 's1', week_ending: expect.any(String) }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Closed 1 matches for 2 players.');
  });

  it('invalidates every cache that depends on match/rating results after a successful close, with exact keys', async () => {
    mockCloseWeek.mockResolvedValue({ closed_matches: 1, players_reconciled: 2 });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Close Week' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Closed 1 matches for 2 players.'));

    // Regression coverage per the Task 14/15 lesson: assert the exact query keys via the real
    // queryKeys builder (not hand-typed arrays), and the exact call count/order, so this test
    // fails if an invalidation is dropped, duplicated, reordered, or its key drifts.
    expect(invalidateSpy).toHaveBeenCalledTimes(4);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.openMatches('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.leaderboard('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.gradeDistribution('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(4, { queryKey: queryKeys.matchHistory('s1') });
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockCloseWeek.mockRejectedValue(new Error('Failed to load open matches: connection refused'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Close Week' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));

    await waitFor(() =>
      expect(screen.getByText('Failed to load open matches: connection refused')).toBeInTheDocument(),
    );
  });
});
