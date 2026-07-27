// web/src/components/RecentActivityFeed.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseRecentActivity = vi.fn();
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));

import { RecentActivityFeed } from './RecentActivityFeed';

function renderComponent() {
  return render(
    <MemoryRouter>
      <RecentActivityFeed />
    </MemoryRouter>,
  );
}

describe('RecentActivityFeed', () => {
  it('renders recent matches and recently active players', () => {
    mockUseRecentActivity.mockReturnValue({
      data: {
        recentMatches: [
          {
            id: 'm1',
            season_id: 's1',
            match_date: '2026-07-25',
            player_a_id: 'p1',
            player_b_id: 'p2',
            frames_a: 4,
            frames_b: 2,
            winner_id: 'p1',
            is_voided: false,
            is_period_closed: false,
            player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
            player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
          },
        ],
        recentPlayers: [
          {
            id: 'p3',
            full_name: 'Brand New Player',
            photo_url: null,
            activity: 'signup',
            activity_date: '2026-07-26',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Brand New Player')).toBeInTheDocument();
    expect(screen.getByText('New player')).toBeInTheDocument();
  });

  it('shows empty-state messages when there is no activity at all', () => {
    mockUseRecentActivity.mockReturnValue({
      data: { recentMatches: [], recentPlayers: [] },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('No matches yet.')).toBeInTheDocument();
    expect(screen.getByText('No player activity yet.')).toBeInTheDocument();
  });

  it('shows an error message on fetch failure', () => {
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderComponent();
    expect(screen.getByText("Couldn't load recent activity. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', () => {
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
