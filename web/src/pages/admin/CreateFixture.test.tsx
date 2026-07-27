// web/src/pages/admin/CreateFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseActiveSeason = vi.fn();
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));

const mockUsePlayers = vi.fn();
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));

const mockMutateAsync = vi.fn();
vi.mock('@/hooks/useCreateFixture', () => ({
  useCreateFixture: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

import { CreateFixturePage } from './CreateFixture';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CreateFixturePage />
    </QueryClientProvider>,
  );
}

describe('CreateFixturePage', () => {
  beforeEach(() => {
    mockMutateAsync.mockReset();
    mockToastSuccess.mockReset();
    mockUseActiveSeason.mockReturnValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', rating: 1600 },
        { id: 'p2', full_name: 'Jordan Testplayer', rating: 1400 },
      ],
      isLoading: false,
      isError: false,
    });
  });

  it('schedules a fixture, shows a success toast, and resets the player selects', async () => {
    mockMutateAsync.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ seasonId: 's1', playerAId: 'p1', playerBId: 'p2' }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Fixture scheduled.');
    await waitFor(() => expect(screen.getByLabelText('Player A')).toHaveValue(''));
  });

  it('rejects selecting the same player for both slots without calling the mutation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Alex Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    expect(screen.getByText('Player A and Player B must be different.')).toBeInTheDocument();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows the mutation error message verbatim on failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('insert or update on table "fixtures" violates foreign key'));
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.click(screen.getByRole('button', { name: 'Schedule Fixture' }));

    await waitFor(() =>
      expect(screen.getByText('insert or update on table "fixtures" violates foreign key')).toBeInTheDocument(),
    );
  });

  it('shows a loading skeleton while the active season or players are still loading', () => {
    mockUsePlayers.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Schedule Fixture')).not.toBeInTheDocument();
  });

  it('shows an inline error message when the active season or players fail to load', () => {
    mockUseActiveSeason.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText("Couldn't load the fixture form. Try refreshing.")).toBeInTheDocument();
  });
});
