// web/src/components/SeasonInFlightOverview.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseSeasonInFlight = vi.fn();
vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));

import { SeasonInFlightOverview } from './SeasonInFlightOverview';

function renderComponent() {
  return render(
    <MemoryRouter>
      <SeasonInFlightOverview />
    </MemoryRouter>,
  );
}

describe('SeasonInFlightOverview', () => {
  it('shows the season stat tiles when a season is active', () => {
    mockUseSeasonInFlight.mockReturnValue({
      data: {
        season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
        matchesPlayed: 12,
        activePlayerCount: 8,
        daysElapsed: 30,
      },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows a "Start Season" prompt when there is no active season', () => {
    mockUseSeasonInFlight.mockReturnValue({
      data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('No active season')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Season/ })).toHaveAttribute('href', '/admin/start-season');
  });

  it('shows an error message on fetch failure', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderComponent();
    expect(screen.getByText("Couldn't load season status. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
