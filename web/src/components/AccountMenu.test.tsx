import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockSignOut = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signOut: () => mockSignOut() } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { AccountMenu } from './AccountMenu';

describe('AccountMenu', () => {
  it('shows Log in / Sign up links when logged out', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });

  it('shows Dashboard/Settings/Log out but not Admin for a non-admin session', async () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the Admin link for an admin session and signs out on click', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin/enter-match');

    await user.click(screen.getByRole('button', { name: 'Log out' }));
    expect(mockSignOut).toHaveBeenCalled();
  });
});
