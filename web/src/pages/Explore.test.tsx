import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePlayerRoster', () => ({
  usePlayerRoster: () => ({
    data: [
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
      { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
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
      {
        id: 'm0',
        season_id: 's0',
        match_date: '2025-12-31',
        player_a_id: 'p1',
        player_b_id: 'p2',
        frames_a: 3,
        frames_b: 1,
        winner_id: 'p1',
        is_voided: false,
        is_period_closed: true,
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

    // Both fixture matches involve Alex, across two different seasons --
    // Jordan legitimately appears as Alex's opponent in both.
    expect(screen.getByText('Matches (2)')).toBeInTheDocument();
    expect(screen.getByText('4–2')).toBeInTheDocument();
    expect(screen.getByText('3–1')).toBeInTheDocument();
  });

  it('links only the active season to the leaderboard, leaving others informational', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'season');

    expect(screen.getByRole('link', { name: /Test season/ })).toHaveAttribute('href', '/');
    const seasonsSection = screen.getByText(/Seasons/).closest('section') as HTMLElement;
    expect(within(seasonsSection).getByText('Seed Season')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Seed Season/ })).not.toBeInTheDocument();
  });

  it('narrows the Matches section to the selected season, leaving Players and Seasons unaffected', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'Alex');
    expect(screen.getByText('Matches (2)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter matches by season'), 's0');

    expect(screen.getByText('Matches (1)')).toBeInTheDocument();
    expect(screen.getByText('3–1')).toBeInTheDocument();
    expect(screen.queryByText('4–2')).not.toBeInTheDocument();
    expect(screen.getByText('Players (1)')).toBeInTheDocument();
  });
});
