// web/src/pages/FixtureDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseFixture = vi.fn();
const mockUsePlayerComparisonStats = vi.fn();
const mockUseHeadToHead = vi.fn();

vi.mock('@/hooks/useFixture', () => ({ useFixture: (id: string | undefined) => mockUseFixture(id) }));
vi.mock('@/hooks/usePlayerComparisonStats', () => ({
  usePlayerComparisonStats: (playerId: string | undefined, seasonId: string | undefined) =>
    mockUsePlayerComparisonStats(playerId, seasonId),
}));
vi.mock('@/hooks/useHeadToHead', () => ({
  useHeadToHead: (a: string | undefined, b: string | undefined) => mockUseHeadToHead(a, b),
}));

import { FixtureDetailPage } from './FixtureDetail';

const FIXTURE = {
  id: 'f1',
  season_id: 's1',
  scheduled_date: '2026-08-01',
  status: 'scheduled' as const,
  completed_match_id: null,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
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
      <MemoryRouter initialEntries={['/fixtures/f1']}>
        <Routes>
          <Route path="/fixtures/:id" element={<FixtureDetailPage />} />
          <Route path="/matches/:id" element={<p>Match detail placeholder</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FixtureDetailPage', () => {
  it("renders the comparison card once the fixture and both players' stats have loaded", () => {
    mockUseFixture.mockReturnValue({ data: FIXTURE, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('1700')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the fixture is loading', () => {
    mockUseFixture.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message when the fixture fails to load', () => {
    mockUseFixture.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this fixture. Try refreshing.")).toBeInTheDocument();
  });

  it('shows an error message when no fixture matches the id', () => {
    mockUseFixture.mockReturnValue({ data: null, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this fixture. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a voided message when the fixture was cancelled', () => {
    mockUseFixture.mockReturnValue({ data: { ...FIXTURE, status: 'voided' }, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('This fixture was cancelled.')).toBeInTheDocument();
  });

  it('redirects to the match detail page instead of rendering when the fixture is already completed', () => {
    mockUseFixture.mockReturnValue({
      data: { ...FIXTURE, status: 'completed', completed_match_id: 'm9' },
      isLoading: false,
      isError: false,
    });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('Match detail placeholder')).toBeInTheDocument();
    expect(screen.queryByText('Alex Testplayer')).not.toBeInTheDocument();
  });
});
