import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseUserProfile = vi.fn();
const mockUsePlayers = vi.fn();
const mockUseActiveSeason = vi.fn();
const mockSubmitClaimMutate = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
vi.mock('@/hooks/useActiveSeason', () => ({ useActiveSeason: () => mockUseActiveSeason() }));
vi.mock('@/hooks/useSubmitPlayerClaim', () => ({
  useSubmitPlayerClaim: () => ({ mutate: mockSubmitClaimMutate, isPending: false }),
}));
vi.mock('@/hooks/usePlayerPhotoUpload', () => ({
  usePlayerPhotoUpload: () => ({ inputRef: { current: null }, isUploading: false, handleFile: vi.fn(), handleRemove: vi.fn() }),
}));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: (args: unknown) => mockUpdateUser(args) } },
}));

import { SettingsPage } from './Settings';

function renderSettings() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockSubmitClaimMutate.mockReset();
    mockUpdateUser.mockReset();
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1', email: 'u1@example.com' } }, isLoading: false });
    mockUseActiveSeason.mockReturnValue({ data: { id: 's1', name: 'Season 2026' }, isLoading: false, isError: false });
  });

  it('shows the claim picker for an unlinked, non-admin account', async () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderSettings();
    expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
  });

  it('shows a pending-review status instead of the picker when a claim is outstanding', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderSettings();
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });

  it('shows the linked player name read-only and the photo manager for a linked account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: 'p1', pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderSettings();
    expect(screen.getByText(/linked to: alex testplayer/i)).toBeInTheDocument();
  });

  it('updates the password on submit', async () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUpdateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();

    renderSettings();
    await user.type(screen.getByLabelText('New password'), 'newpassword1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpassword1' }));
  });
});
