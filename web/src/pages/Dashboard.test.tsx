// web/src/pages/Dashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseUserProfile = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockUseRecentActivity = vi.fn();
const mockUseSeasonInFlight = vi.fn();
const mockUsePlayerOfTheWeek = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));
vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));
vi.mock('@/hooks/usePlayerOfTheWeek', () => ({ usePlayerOfTheWeek: () => mockUsePlayerOfTheWeek() }));

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
    mockUseRecentActivity.mockReturnValue({
      data: { recentMatches: [], recentPlayers: [] },
      isLoading: false,
      isError: false,
    });
    mockUseSeasonInFlight.mockReturnValue({
      data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
      isLoading: false,
      isError: false,
    });
    mockUsePlayerOfTheWeek.mockReturnValue({ data: null, isLoading: false, isError: false });
  });

  it('shows the admin panel, the season-in-flight overview, and the shared activity feed for an admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [{ id: 'c1' }], isLoading: false, isError: false });
    mockUseSeasonInFlight.mockReturnValue({
      data: {
        season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
        matchesPlayed: 12,
        activePlayerCount: 8,
        daysElapsed: 30,
      },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter Match' })).toHaveAttribute('href', '/admin/enter-match');
  });

  it('shows the highlights carousel with Player of the Week on the admin dashboard', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex Testplayer' })).toHaveAttribute('href', '/players/p1');
  });

  it('shows an error message when pending claims fail to load in the admin panel', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderDashboard();
    expect(screen.getByText(/couldn't load pending claims/i)).toBeInTheDocument();
  });

  it("shows the admin's 'no active season' prompt when no season is currently running (regression: the whole Dashboard no longer hard-fails on this)", () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('No active season')).toBeInTheDocument();
  });

  it('shows the player panel with a link to the full profile for a linked, non-admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: 'p1', pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view your full profile/i })).toHaveAttribute('href', '/players/p1');
  });

  it('shows the claim CTA for an unlinked account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
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

  it('renders the shared recent-activity feed for a non-admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRecentActivity.mockReturnValue({
      data: {
        recentMatches: [],
        recentPlayers: [
          { id: 'p9', full_name: 'Sam Newcomer', photo_url: null, activity: 'signup', activity_date: '2026-07-26' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByText('Sam Newcomer')).toBeInTheDocument();
  });

  it('shows a loading skeleton while auth/admin/profile are resolving', () => {
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseUserProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePendingClaims.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { container } = renderDashboard();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it("shows an error message when the user's profile fails to load", () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/couldn't load your dashboard/i)).toBeInTheDocument();
  });
});
