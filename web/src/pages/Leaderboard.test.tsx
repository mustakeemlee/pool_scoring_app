import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

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
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeaderboardPage', () => {
  it('renders a row per leaderboard entry with a link to the player profile, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Alex Testplayer/ });
    expect(link).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
