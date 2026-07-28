import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchComparisonCard, type ComparisonPlayer } from './MatchComparisonCard';

const playerA: ComparisonPlayer = {
  id: 'p1',
  full_name: 'Alex Testplayer',
  photo_url: null,
  rating: 1700,
  grade: 'A',
  wins: 5,
  losses: 2,
  win_pct: 71.43,
  form_5: 80,
  form_10: 70,
};

const playerB: ComparisonPlayer = {
  id: 'p2',
  full_name: 'Jordan Testplayer',
  photo_url: null,
  rating: 1550,
  grade: 'B+',
  wins: 3,
  losses: 4,
  win_pct: 42.86,
  form_5: 40,
  form_10: 50,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof MatchComparisonCard>> = {}) {
  return render(
    <MemoryRouter>
      <MatchComparisonCard
        date="2026-03-01"
        playerA={playerA}
        playerB={playerB}
        headToHead={{ winsA: 3, winsB: 1, played: 4 }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('MatchComparisonCard', () => {
  it("renders both players' names, ratings, and grades", () => {
    renderCard();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('1700')).toBeInTheDocument();
    expect(screen.getByText('1550')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B+')).toBeInTheDocument();
  });

  it('links each player name to their profile', () => {
    renderCard();
    expect(screen.getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByRole('link', { name: /Jordan Testplayer/ })).toHaveAttribute('href', '/players/p2');
  });

  it('shows the head-to-head win counts', () => {
    renderCard();
    expect(screen.getByText('3 wins')).toBeInTheDocument();
    expect(screen.getByText('1 wins')).toBeInTheDocument();
  });

  it('shows "No previous meetings" when the two players have never played', () => {
    renderCard({ headToHead: { winsA: 0, winsB: 0, played: 0 } });
    expect(screen.getByText('No previous meetings')).toBeInTheDocument();
  });

  it('does not render a score or rating-change section when no result is given', () => {
    renderCard();
    expect(screen.queryByText('Rating Change')).not.toBeInTheDocument();
  });

  it("renders the score and each player's rating change when result data is given", () => {
    renderCard({ result: { frames_a: 5, frames_b: 2, rating_delta_a: 12.5, rating_delta_b: -12.5 } });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('+12.5')).toBeInTheDocument();
    expect(screen.getByText('-12.5')).toBeInTheDocument();
    expect(screen.getByText('Rating change from this match')).toBeInTheDocument();
  });

  it('shows a voided-message banner when given one', () => {
    renderCard({ voidedMessage: 'This match was voided.' });
    expect(screen.getByText('This match was voided.')).toBeInTheDocument();
  });

  it('shows a dash for stats the player has none of yet', () => {
    renderCard({
      playerA: { ...playerA, rating: null, grade: null, wins: null, losses: null, win_pct: null, form_5: null, form_10: null },
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
