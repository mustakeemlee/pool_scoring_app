// web/src/components/HighlightsCarousel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockUseSeasonInFlight = vi.fn();
const mockUsePlayerOfTheWeek = vi.fn();
const mockUseRecentActivity = vi.fn();

vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));
vi.mock('@/hooks/usePlayerOfTheWeek', () => ({ usePlayerOfTheWeek: () => mockUsePlayerOfTheWeek() }));
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));

import { HighlightsCarousel } from './HighlightsCarousel';

function renderComponent() {
  return render(
    <MemoryRouter>
      <HighlightsCarousel />
    </MemoryRouter>,
  );
}

const NO_SEASON = {
  data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
  isLoading: false,
  isError: false,
};
const ACTIVE_SEASON = {
  data: {
    season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const },
    matchesPlayed: 0,
    activePlayerCount: 0,
    daysElapsed: 1,
  },
  isLoading: false,
  isError: false,
};
const NO_ACTIVITY = { data: { recentMatches: [], recentPlayers: [] }, isLoading: false, isError: false };
const NO_POTW = { data: null, isLoading: false, isError: false };

describe('HighlightsCarousel', () => {
  it('shows the Player of the Week slide first, linking to their profile', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex Testplayer' })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('+42 rating this week')).toBeInTheDocument();
  });

  it('shows the season-live slide when there is an active season and no Player of the Week', () => {
    mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Season Season 2026 is live')).toBeInTheDocument();
  });

  it('falls back to the welcome slide when there is nothing to show', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Welcome to PoolIQ')).toBeInTheDocument();
  });

  it('lets clicking a dot indicator jump directly to that slide', async () => {
    mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);
    const user = userEvent.setup();

    renderComponent();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show slide 2' }));
    expect(screen.getByText('Season Season 2026 is live')).toBeInTheDocument();
  });

  it('marks the active dot indicator with aria-current for assistive tech', () => {
    mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByRole('button', { name: 'Show slide 1' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Show slide 2' })).not.toHaveAttribute('aria-current');
  });

  it('lets clicking the pause control stop automatic rotation, and clicking again resumes it', () => {
    vi.useFakeTimers();
    try {
      mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
      mockUsePlayerOfTheWeek.mockReturnValue({
        data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
        isLoading: false,
        isError: false,
      });
      mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

      renderComponent();
      expect(screen.getByText('Player of the Week')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Pause automatic slide rotation' }));
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(screen.getByText('Player of the Week')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Resume automatic slide rotation' }));
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(screen.getByText('Season Season 2026 is live')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a loading skeleton while any composed hook is still loading', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerOfTheWeek.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message if any composed hook fails', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderComponent();
    expect(screen.getByText("Couldn't load dashboard highlights. Try refreshing.")).toBeInTheDocument();
  });
});
