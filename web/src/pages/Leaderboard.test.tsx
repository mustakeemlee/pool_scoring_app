// web/src/pages/Leaderboard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useLeaderboard', () => ({
  useLeaderboard: () => ({
    data: [
      { player_id: 'p1', full_name: 'Alex Testplayer', season_id: 's1', rating: 1768, grade: 'A+', season_points: 142, rank: 1 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { LeaderboardPage } from './Leaderboard';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeaderboardPage', () => {
  it('renders a row per leaderboard entry with a link to the player profile', () => {
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Alex Testplayer/ });
    expect(link).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });
});
