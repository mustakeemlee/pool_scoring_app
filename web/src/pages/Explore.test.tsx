// web/src/pages/Explore.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({ data: { id: 's1' }, isLoading: false, isError: false }),
}));

vi.mock('@/hooks/usePlayers', () => ({
  usePlayers: () => ({
    data: [
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null, rating: 1500 },
      { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null, rating: 1500 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useSeasons', () => ({
  useSeasons: () => ({
    data: [
      { id: 's1', name: 'Test season', start_date: '2026-07-24', end_date: null, status: 'active' },
      { id: 's0', name: 'Seed Season', start_date: '2025-12-31', end_date: null, status: 'completed' },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useAllMatches', () => ({
  useAllMatches: () => ({
    data: [
      {
        id: 'm1',
        season_id: 's1',
        match_date: '2026-07-24',
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
    isLoading: false,
    isError: false,
  }),
}));

import { ExplorePage } from './Explore';

function renderPage() {
  return render(
    <MemoryRouter>
      <ExplorePage />
    </MemoryRouter>,
  );
}

describe('ExplorePage', () => {
  it('prompts to search before anything is typed', () => {
    renderPage();
    expect(screen.getByText('Start typing to search players, matches, and seasons.')).toBeInTheDocument();
  });

  it('filters players, seasons, and matches by the typed query', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'Alex');

    const playersSection = screen.getByText('Players (1)').closest('section') as HTMLElement;
    expect(within(playersSection).getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute(
      'href',
      '/players/p1',
    );
    expect(within(playersSection).queryByText('Jordan Testplayer')).not.toBeInTheDocument();

    expect(screen.getByText('No matching seasons.')).toBeInTheDocument();

    // The match itself involves both players -- Jordan legitimately appears
    // here as Alex's opponent even though only "Alex" was searched.
    const matchesSection = screen.getByText('Matches (1)').closest('section') as HTMLElement;
    expect(within(matchesSection).getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(within(matchesSection).getByText('4–2')).toBeInTheDocument();
  });

  it('links only the active season to the leaderboard, leaving others informational', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'season');

    expect(screen.getByRole('link', { name: /Test season/ })).toHaveAttribute('href', '/');
    expect(screen.getByText('Seed Season')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Seed Season/ })).not.toBeInTheDocument();
  });
});
