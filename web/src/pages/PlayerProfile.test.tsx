// web/src/pages/PlayerProfile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const usePlayerProfileMock = vi.fn();
const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/usePlayerProfile', () => ({
  usePlayerProfile: (...args: unknown[]) => usePlayerProfileMock(...args),
}));

import { PlayerProfilePage } from './PlayerProfile';

const SEASON: Season = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' };

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
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    usePlayerProfileMock.mockReturnValue({
      data: {
        player: { id: 'p1', full_name: 'Alex Testplayer' },
        seasonRating: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
        statistics: { id: 'st1', player_id: 'p1', season_id: 's1', wins: 4, losses: 1, win_pct: 80, current_streak: 3, longest_streak: 3, frames_won: 20, frames_lost: 8, avg_opponent_rating: 1500, form_5: 80, form_10: 80, form_score: 82 },
        ratingEvents: [],
        matches: [],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('W3')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });

  it('shows an empty-state instead of crashing when the player has no rating row yet', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    usePlayerProfileMock.mockReturnValue({
      data: {
        player: { id: 'p2', full_name: 'Fresh Player' },
        seasonRating: null,
        statistics: null,
        ratingEvents: [],
        matches: [],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Fresh Player')).toBeInTheDocument();
    expect(screen.getByText(/no rating yet this season/i)).toBeInTheDocument();
  });

  it('renders using the most recent season when none is active, instead of erroring', () => {
    const completedSeason = { ...SEASON, status: 'completed' as const };
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(completedSeason, [completedSeason]));
    usePlayerProfileMock.mockReturnValue({
      data: {
        player: { id: 'p1', full_name: 'Alex Testplayer' },
        seasonRating: null,
        statistics: null,
        ratingEvents: [],
        matches: [],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this player. Try refreshing.")).not.toBeInTheDocument();
  });
});
