import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

vi.mock('@/hooks/useSeasonSelector', () => ({
  useSeasonSelector: () => ({
    selectedSeason: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    selectedSeasonId: 's1',
    seasons: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
    isLoading: false,
    isError: false,
    selectSeason: vi.fn(),
    selectPrevious: vi.fn(),
    selectNext: vi.fn(),
    hasPrevious: false,
    hasNext: false,
  }),
}));

vi.mock('@/hooks/useLeaderboard', () => ({
  useLeaderboard: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
}));

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => mockUseIsAdmin(),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

// Dashboard now renders at the redirected-to root route ("/"), so it needs
// the same hook mocks as Dashboard.test.tsx.
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ data: { linkedPlayerId: null, pendingClaim: null }, isLoading: false, isError: false }),
}));
vi.mock('@/hooks/usePendingClaims', () => ({
  usePendingClaims: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useRecentActivity', () => ({
  useRecentActivity: () => ({
    data: { recentMatches: [], recentPlayers: [] },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/useSeasonInFlight', () => ({
  useSeasonInFlight: () => ({
    data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/usePlayerOfTheWeek', () => ({
  usePlayerOfTheWeek: () => ({ data: null, isLoading: false, isError: false }),
}));

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    // BrowserRouter drives jsdom's shared window.history, which persists
    // across tests in this file -- reset to "/" so a redirect from one test
    // doesn't leak into the next.
    window.history.pushState({}, '', '/');
  });

  it('redirects an unauthenticated visitor at the root route to the login page', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderApp();
    expect(screen.getByText('PoolIQ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log In' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leaderboard' })).not.toBeInTheDocument();
  });

  it('redirects the root route to the dashboard once logged in', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'user-1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    renderApp();
    expect(screen.getByText('PoolIQ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/dashboard');
  });

  it('renders the leaderboard page at /leaderboard once logged in', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'user-1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    window.history.pushState({}, '', '/leaderboard');
    renderApp();
    expect(screen.getByText('PoolIQ')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
  });
});
