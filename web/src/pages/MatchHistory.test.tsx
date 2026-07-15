// web/src/pages/MatchHistory.test.tsx
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

vi.mock('@/hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({
    data: [
      {
        id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
        frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: true,
        player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { MatchHistoryPage } from './MatchHistory';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MatchHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchHistoryPage', () => {
  it('renders the match table with league-wide results', () => {
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
  });
});
