// web/src/pages/MatchHistory.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({
    data: [
      {
        id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
        frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: true,
        player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

const mockUseFixtures = vi.fn();
vi.mock('@/hooks/useFixtures', () => ({ useFixtures: () => mockUseFixtures() }));

const mockVoidMutateAsync = vi.fn();
vi.mock('@/hooks/useVoidFixture', () => ({
  useVoidFixture: () => ({ mutateAsync: mockVoidMutateAsync, isPending: false }),
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) }, } ));

import { MatchHistoryPage } from './MatchHistory';

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
      <MemoryRouter>
        <MatchHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchHistoryPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockVoidMutateAsync.mockReset();
    mockToastSuccess.mockReset();
  });

  it('renders the match table with league-wide results by default, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });

  it('switches to the Fixtures list, showing scheduled players and an Overdue flag for a past-due fixture', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2020-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByText('Sam Newcomer')).toBeInTheDocument();
    expect(screen.getByText('Riley Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  it('does not flag a future-dated scheduled fixture as overdue', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f2', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('shows admin actions (Enter Result, Void) for a scheduled fixture only when the viewer is an admin', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: 'Enter Result' })).toHaveAttribute(
      'href',
      '/admin/enter-match?fixtureId=f1',
    );
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('lets an admin void a fixture', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    mockVoidMutateAsync.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));
    await user.click(screen.getByRole('button', { name: 'Void' }));

    await waitFor(() => expect(mockVoidMutateAsync).toHaveBeenCalledWith({ fixtureId: 'f1', seasonId: 's1' }));
    expect(mockToastSuccess).toHaveBeenCalledWith('Fixture voided.');
  });

  it('shows a "no fixtures scheduled yet" message for an empty Fixtures list', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));
    expect(screen.getByText('No fixtures scheduled yet.')).toBeInTheDocument();
  });

  it('links a scheduled fixture row to its fixture detail page', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: /Sam Newcomer/ })).toHaveAttribute('href', '/fixtures/f1');
  });

  it('links a completed fixture row to its resulting match, not the fixture page', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2026-01-01', status: 'completed', completed_match_id: 'm9',
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: /Sam Newcomer/ })).toHaveAttribute('href', '/matches/m9');
  });
});
