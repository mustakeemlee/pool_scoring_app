// web/src/pages/admin/StartSeason.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { queryKeys } from '@/lib/queryKeys';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useSeasons', () => ({
  useSeasons: () => ({
    data: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useSeasonInFlight', () => ({
  useSeasonInFlight: () => ({
    data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
    isLoading: false,
    isError: false,
  }),
}));

const mockStartSeason = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ startSeason: (body: unknown) => mockStartSeason(body) }));

import { StartSeasonPage } from './StartSeason';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <StartSeasonPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('StartSeasonPage', () => {
  beforeEach(() => {
    mockStartSeason.mockReset();
    mockToastSuccess.mockReset();
  });

  it('lists existing seasons in the carry-over picker', () => {
    renderPage();
    expect(screen.getByRole('option', { name: 'Season 2026' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None (fresh start)' })).toBeInTheDocument();
  });

  it('shows the season-in-flight overview above the form', () => {
    renderPage();
    expect(screen.getByText('No active season')).toBeInTheDocument();
  });

  it('omits previous_season_id when "None" is selected, and confirms before submitting', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    expect(mockStartSeason).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(mockStartSeason).toHaveBeenCalledWith(
        expect.objectContaining({ new_season_name: 'Season 2027', previous_season_id: undefined }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.');
  });

  it('invalidates seasons, activeSeason, and seasonInFlight caches after a successful start, with exact keys', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.'));

    // Regression coverage per the Task 14/15/16 lesson: assert the exact query keys via the real
    // queryKeys builder (not hand-typed arrays), and the exact call count/order, so this test
    // fails if an invalidation is dropped, duplicated, reordered, or its key drifts.
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.seasons() });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.activeSeason() });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.seasonInFlight() });
  });

  it('resets the form fields after a successful start', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.selectOptions(screen.getByLabelText('Carry over ratings from'), 'Season 2026');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.'));

    expect(screen.getByLabelText('New season name')).toHaveValue('');
    expect(screen.getByLabelText('Carry over ratings from')).toHaveValue('');
  });

  it('includes previous_season_id when a carry-over season is selected', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.selectOptions(screen.getByLabelText('Carry over ratings from'), 'Season 2026');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(mockStartSeason).toHaveBeenCalledWith(
        expect.objectContaining({ new_season_name: 'Season 2027', previous_season_id: 's1' }),
      ),
    );
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockStartSeason.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(screen.getByText('duplicate key value violates unique constraint')).toBeInTheDocument(),
    );
  });
});
