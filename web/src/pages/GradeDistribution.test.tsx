import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useGradeDistribution', () => ({
  useGradeDistribution: () => ({
    data: [
      { season_id: 's1', grade: 'A+', player_count: 2 },
      { season_id: 's1', grade: 'B', player_count: 5 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { GradeDistributionPage } from './GradeDistribution';

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
      <GradeDistributionPage />
    </QueryClientProvider>,
  );
}

describe('GradeDistributionPage', () => {
  it('renders a row for every grade band, including zero-count ones, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
