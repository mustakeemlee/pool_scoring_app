import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
const mockUsePlayers = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockReviewPlayerClaim = vi.fn();

vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/lib/edgeFunctions', () => ({ reviewPlayerClaim: (args: unknown) => mockReviewPlayerClaim(args) }));

import { ManagePlayersPage } from './ManagePlayers';

const ACTIVE_SEASON: Season = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' };

function seasonSelectorReturn(season: Season | null, seasons: Season[]) {
  return {
    selectedSeason: season,
    selectedSeasonId: season?.id,
    seasons,
    isLoading: false,
    isError: false,
    selectSeason: vi.fn(),
    selectPrevious: vi.fn(),
    selectNext: vi.fn(),
    hasPrevious: false,
    hasNext: false,
  };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ManagePlayersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ManagePlayersPage pending claims', () => {
  beforeEach(() => {
    mockReviewPlayerClaim.mockReset();
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(ACTIVE_SEASON, [ACTIVE_SEASON]));
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('lists pending claims and approves one on confirm', async () => {
    mockUsePendingClaims.mockReturnValue({
      data: [{ id: 'c1', user_id: 'u1', player_id: 'p1', player_name: 'Alex Testplayer', created_at: '2026-07-20' }],
      isLoading: false,
      isError: false,
    });
    mockReviewPlayerClaim.mockResolvedValue({ claim_id: 'c1', status: 'approved' });
    const user = userEvent.setup();

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Approve' }));

    await waitFor(() =>
      expect(mockReviewPlayerClaim).toHaveBeenCalledWith({ claim_id: 'c1', decision: 'approve' }),
    );
  });

  it('shows nothing when there are no pending claims', () => {
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderPage();
    expect(screen.queryByText(/pending claims/i)).not.toBeInTheDocument();
  });

  it('still renders the roster when there is no active season, using the most recent season', () => {
    const completedSeason = { ...ACTIVE_SEASON, status: 'completed' as const };
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(completedSeason, [completedSeason]));
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load players. Try refreshing.")).not.toBeInTheDocument();
  });
});
