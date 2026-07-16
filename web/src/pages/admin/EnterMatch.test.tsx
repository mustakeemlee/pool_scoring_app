// web/src/pages/admin/EnterMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

const mockUseActiveSeason = vi.fn();
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));

const mockUsePlayers = vi.fn();
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));

const mockEnterMatch = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ enterMatch: (body: unknown) => mockEnterMatch(body) }));

import { EnterMatchPage } from './EnterMatch';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EnterMatchPage />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('EnterMatchPage', () => {
  beforeEach(() => {
    mockEnterMatch.mockReset();
    mockToastSuccess.mockReset();
    mockUseActiveSeason.mockReturnValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', rating: 1600 },
        { id: 'p2', full_name: 'Jordan Testplayer', rating: 1400 },
      ],
      isLoading: false,
      isError: false,
    });
  });

  it('shows a loading skeleton while the active season or players are still loading', () => {
    mockUsePlayers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Enter Match Result')).not.toBeInTheDocument();
  });

  it('shows an inline error message when the active season or players fail to load', () => {
    mockUseActiveSeason.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText("Couldn't load the match entry form. Try refreshing.")).toBeInTheDocument();
    expect(screen.queryByText('Enter Match Result')).not.toBeInTheDocument();
  });

  it('shows the predicted-odds widget once both players are selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    expect(screen.getByText('Predicted odds')).toBeInTheDocument();
  });

  it('rejects a tied frame score client-side without calling enterMatch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '4');
    await user.type(screen.getByLabelText('Frames B'), '4');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    expect(screen.getByText('Frame scores cannot be tied.')).toBeInTheDocument();
    expect(mockEnterMatch).not.toHaveBeenCalled();
  });

  it('submits a valid match, shows a success toast, and resets the form', async () => {
    mockEnterMatch.mockResolvedValue({ match_id: 'm1' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(mockEnterMatch).toHaveBeenCalledWith(
        expect.objectContaining({ season_id: 's1', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2 }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Alex Testplayer wins 5–2'));
    await waitFor(() => expect((screen.getByLabelText('Frames A') as HTMLInputElement).value).toBe(''));

    // Regression coverage: a successful submission must invalidate all six caches that
    // depend on match results, in this order, so the leaderboard, grade distribution,
    // match history, and both players' profiles refresh without a manual reload.
    expect(invalidateSpy).toHaveBeenCalledTimes(6);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.leaderboard('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.gradeDistribution('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.matchHistory('s1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(4, { queryKey: queryKeys.playerProfile('p1', 's1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(5, { queryKey: queryKeys.playerProfile('p2', 's1') });
    expect(invalidateSpy).toHaveBeenNthCalledWith(6, { queryKey: ['players', 's1'] });
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockEnterMatch.mockRejectedValue(new Error('new row for relation "matches" violates check constraint'));
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(screen.getByText('new row for relation "matches" violates check constraint')).toBeInTheDocument(),
    );
  });
});
