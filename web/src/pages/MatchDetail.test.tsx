// web/src/pages/MatchDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseMatch = vi.fn();
const mockUsePlayerComparisonStats = vi.fn();
const mockUseHeadToHead = vi.fn();

vi.mock('@/hooks/useMatch', () => ({ useMatch: (id: string | undefined) => mockUseMatch(id) }));
vi.mock('@/hooks/usePlayerComparisonStats', () => ({
  usePlayerComparisonStats: (playerId: string | undefined, seasonId: string | undefined) =>
    mockUsePlayerComparisonStats(playerId, seasonId),
}));
vi.mock('@/hooks/useHeadToHead', () => ({
  useHeadToHead: (a: string | undefined, b: string | undefined) => mockUseHeadToHead(a, b),
}));

import { MatchDetailPage } from './MatchDetail';

const MATCH = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-03-01',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
  rating_delta_a: 12.5,
  rating_delta_b: -12.5,
};
const STATS_A = { rating: 1700, grade: 'A' as const, wins: 5, losses: 2, win_pct: 71.43, form_5: 80, form_10: 70 };
const STATS_B = { rating: 1550, grade: 'B+' as const, wins: 3, losses: 4, win_pct: 42.86, form_5: 40, form_10: 50 };

function statsFor(playerId: string | undefined) {
  return playerId === 'p1'
    ? { data: STATS_A, isLoading: false, isError: false }
    : { data: STATS_B, isLoading: false, isError: false };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/matches/m1']}>
        <Routes>
          <Route path="/matches/:id" element={<MatchDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchDetailPage', () => {
  it("renders the comparison card with the score and each player's rating change", () => {
    mockUseMatch.mockReturnValue({ data: MATCH, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('+12.5')).toBeInTheDocument();
    expect(screen.getByText('-12.5')).toBeInTheDocument();
    expect(screen.getByText('Rating change from this match')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the match is loading', () => {
    mockUseMatch.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message when the match fails to load', () => {
    mockUseMatch.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this match. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a distinct not-found message when no match matches the id', () => {
    mockUseMatch.mockReturnValue({ data: null, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("This match doesn't exist.")).toBeInTheDocument();
  });

  it('shows a voided-match warning when the match was voided', () => {
    mockUseMatch.mockReturnValue({ data: { ...MATCH, is_voided: true }, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(
      screen.getByText('This match was voided — these stats may not reflect the current record.'),
    ).toBeInTheDocument();
  });
});
