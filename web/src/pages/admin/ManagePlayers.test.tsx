import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseActiveSeason = vi.fn();
const mockUsePlayers = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockReviewPlayerClaim = vi.fn();

vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/lib/edgeFunctions', () => ({ reviewPlayerClaim: (args: unknown) => mockReviewPlayerClaim(args) }));

import { ManagePlayersPage } from './ManagePlayers';

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
    mockUseActiveSeason.mockReturnValue({ data: { id: 's1' }, isLoading: false, isError: false });
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
});
