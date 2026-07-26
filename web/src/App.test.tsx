import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
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

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
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
    renderApp();
    expect(screen.getByText('Pool League')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log In' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leaderboard' })).not.toBeInTheDocument();
  });

  it('renders the leaderboard page at the root route once logged in', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'user-1' } }, isLoading: false });
    renderApp();
    expect(screen.getByText('Pool League')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
  });
});
