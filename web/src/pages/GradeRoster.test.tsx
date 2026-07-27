// web/src/pages/GradeRoster.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
const mockUseGradeRoster = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/useGradeRoster', () => ({
  useGradeRoster: (seasonId: string | undefined, grade: string | undefined) => mockUseGradeRoster(seasonId, grade),
}));

import { GradeRosterPage } from './GradeRoster';

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

function renderPage(initialPath = '/grades/A+') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/grades/:grade" element={<GradeRosterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GradeRosterPage', () => {
  it('renders every player in the requested grade, linking to their profile', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({
      data: [
        {
          player_id: 'p1',
          full_name: 'Alex Testplayer',
          photo_url: null,
          rating: 1900,
          season_points: 20,
          matches_played: 10,
        },
      ],
      isLoading: false,
      isError: false,
    });

    renderPage();
    expect(screen.getByRole('heading', { name: 'Grade A+' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('1900')).toBeInTheDocument();
  });

  it('passes the season id and the route grade through to useGradeRoster', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderPage('/grades/B+');
    expect(mockUseGradeRoster).toHaveBeenCalledWith('s1', 'B+');
  });

  it('shows an empty state for a grade with no players', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('No players in this grade yet.')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });

  it('shows an error message when the roster fails to load', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderPage();
    expect(screen.getByText("Couldn't load grade roster. Try refreshing.")).toBeInTheDocument();
  });
});
