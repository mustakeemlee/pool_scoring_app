// web/src/pages/admin/CorrectMatch.test.tsx
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

const openMatch = {
  id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
  frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
};

vi.mock('@/hooks/useOpenMatches', () => ({
  useOpenMatches: () => ({ data: [openMatch], isLoading: false, isError: false }),
}));

const mockCorrectMatch = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ correctMatch: (body: unknown) => mockCorrectMatch(body) }));

import { CorrectMatchPage } from './CorrectMatch';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CorrectMatchPage />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('CorrectMatchPage', () => {
  beforeEach(() => {
    mockCorrectMatch.mockReset();
    mockToastSuccess.mockReset();
  });

  it('lists open matches and pre-fills the edit form with the selected match\'s current score', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/Alex Testplayer 5–2 Jordan Testplayer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    expect((screen.getByLabelText('Frames A') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Frames B') as HTMLInputElement).value).toBe('2');
  });

  it('rejects a tied frame score client-side without calling correctMatch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.clear(screen.getByLabelText('Frames B'));
    await user.type(screen.getByLabelText('Frames B'), '5');
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    expect(screen.getByText('Frame scores cannot be tied.')).toBeInTheDocument();
    expect(mockCorrectMatch).not.toHaveBeenCalled();
  });

  it('submits a valid correction, shows a success toast, invalidates the dependent caches, and returns to the list', async () => {
    mockCorrectMatch.mockResolvedValue({ corrected_match_id: 'm2' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.clear(screen.getByLabelText('Frames B'));
    await user.type(screen.getByLabelText('Frames B'), '3');
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() =>
      expect(mockCorrectMatch).toHaveBeenCalledWith({ match_id: 'm1', frames_a: 5, frames_b: 3 }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Match corrected.');
    await waitFor(() => expect(screen.queryByLabelText('Frames A')).not.toBeInTheDocument());

    // Regression coverage: a successful correction must invalidate every cache that depends on
    // match results, in this order, so the open-matches list, leaderboard, grade distribution,
    // match history, and both players' profiles refresh without a manual reload. Asserting exact
    // call count plus each call's position (not just membership) means this test fails if an
    // invalidation is dropped, duplicated, or reordered.
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.openMatches('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.leaderboard('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.gradeDistribution('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(4, { queryKey: queryKeys.matchHistory('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(5, { queryKey: queryKeys.playerProfile('p1', 's1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(6, { queryKey: queryKeys.playerProfile('p2', 's1') });
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockCorrectMatch.mockRejectedValue(new Error('Cannot correct a match whose week has already closed'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() =>
      expect(screen.getByText('Cannot correct a match whose week has already closed')).toBeInTheDocument(),
    );
  });
});
