import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ session: null, isLoading: false }),
}));

vi.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => ({ data: undefined, isLoading: false, isError: false }),
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
  it('renders the top nav and the leaderboard page at the root route', () => {
    renderApp();
    expect(screen.getByText('🎱 Pool League')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Leaderboard' })).toBeInTheDocument();
  });
});
