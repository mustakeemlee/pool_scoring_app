import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchTable } from './MatchTable';
import type { MatchRow } from '@/lib/types';

const matches: MatchRow[] = [
  {
    id: 'm1',
    season_id: 's1',
    match_date: '2026-01-22',
    player_a_id: 'p1',
    player_b_id: 'p2',
    frames_a: 5,
    frames_b: 2,
    winner_id: 'p1',
    is_voided: false,
    is_period_closed: true,
    player_a: { id: 'p1', full_name: 'Alex Testplayer' },
    player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
  },
  {
    id: 'm2',
    season_id: 's1',
    match_date: '2026-01-15',
    player_a_id: 'p3',
    player_b_id: 'p4',
    frames_a: 3,
    frames_b: 5,
    winner_id: 'p4',
    is_voided: true,
    is_period_closed: false,
    player_a: { id: 'p3', full_name: 'Sam Testplayer' },
    player_b: { id: 'p4', full_name: 'Casey Testplayer' },
  },
];

describe('MatchTable', () => {
  it('renders one row per match with date, players, and score', () => {
    render(<MatchTable matches={matches} />, { wrapper: MemoryRouter });
    expect(screen.getByText('2026-01-22')).toBeInTheDocument();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
  });

  it('marks voided matches so they are visually distinguishable', () => {
    render(<MatchTable matches={matches} />, { wrapper: MemoryRouter });
    const voidedRow = screen.getByText('Sam Testplayer').closest('tr');
    expect(voidedRow).not.toBeNull();
    expect(voidedRow).toHaveTextContent('voided');
    expect(voidedRow?.className).toContain('opacity-50');
  });

  it("links the score to that match's detail page", () => {
    render(<MatchTable matches={matches} />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: '5–2' })).toHaveAttribute('href', '/matches/m1');
  });

  it('renders an empty state when there are no matches', () => {
    render(<MatchTable matches={[]} />, { wrapper: MemoryRouter });
    expect(screen.getByText('No matches yet.')).toBeInTheDocument();
  });
});
