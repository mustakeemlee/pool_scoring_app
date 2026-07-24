import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseUserProfile = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockUseActiveSeason = vi.fn();
const mockUseLeaderboard = vi.fn();
const mockUseMatchHistory = vi.fn();
const mockUsePlayerProfile = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
vi.mock('@/hooks/useLeaderboard', () => ({ useLeaderboard: () => mockUseLeaderboard() }));
vi.mock('@/hooks/useMatchHistory', () => ({ useMatchHistory: () => mockUseMatchHistory() }));
vi.mock('@/hooks/usePlayerProfile', () => ({ usePlayerProfile: () => mockUsePlayerProfile() }));

import { DashboardPage } from './Dashboard';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseActiveSeason.mockReturnValue({ data: { id: 's1', name: 'Season 2026', status: 'active' }, isLoading: false, isError: false });
    mockUseLeaderboard.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('shows the admin panel for an admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: null, pendingClaim: null }, isLoading: false, isError: false });
    mockUsePendingClaims.mockReturnValue({ data: [{ id: 'c1' }], isLoading: false, isError: false });
    mockUseMatchHistory.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows the player panel for a linked, non-admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: 'p1', pendingClaim: null }, isLoading: false, isError: false });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUsePlayerProfile.mockReturnValue({
      data: {
        player: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        seasonRating: { grade: 'A', rating: 1800, season_points: 12 },
        statistics: null,
        ratingEvents: [],
        matches: [],
      },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Alex Testplayer' })).toBeInTheDocument();
  });

  it('shows the claim CTA for an unlinked account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({ data: { linkedPlayerId: null, pendingClaim: null }, isLoading: false, isError: false });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute('href', '/settings');
  });

  it('shows a pending-review message for an unlinked account with an outstanding claim', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });
});
