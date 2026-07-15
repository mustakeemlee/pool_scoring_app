// web/src/pages/PlayerProfile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/usePlayerProfile', () => ({
  usePlayerProfile: () => ({
    data: {
      player: { id: 'p1', full_name: 'Alex Testplayer' },
      seasonRating: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
      statistics: { id: 'st1', player_id: 'p1', season_id: 's1', wins: 4, losses: 1, win_pct: 80, current_streak: 3, longest_streak: 3, frames_won: 20, frames_lost: 8, avg_opponent_rating: 1500, form_5: 80, form_10: 80, form_score: 82 },
      ratingEvents: [],
      matches: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

import { PlayerProfilePage } from './PlayerProfile';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/players/p1']}>
        <Routes>
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PlayerProfilePage', () => {
  it('renders the player name, grade, and stat cards', () => {
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('W3')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });
});
