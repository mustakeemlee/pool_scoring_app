import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setIdleSignoutReason } from '@/lib/idleSession';

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (args: unknown) => mockSignIn(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

import { LoginPage } from './Login';

describe('LoginPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockNavigate.mockReset();
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    sessionStorage.clear();
  });

  it('signs in and navigates to the admin home on success', async () => {
    mockSignIn.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'hunter2' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the error message verbatim on a failed login', async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the forgot-password page', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows an inactivity notice when redirected here by the idle timeout', () => {
    setIdleSignoutReason();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('You were signed out due to inactivity. Please sign in again.'),
    ).toBeInTheDocument();
  });

  it('does not show an inactivity notice on a normal visit', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/signed out due to inactivity/)).not.toBeInTheDocument();
  });

  it('redirects an already-authenticated visitor to /dashboard instead of showing the form', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<p>Dashboard placeholder</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('shows the login form while auth state is still loading, not a premature redirect', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: true });

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
  });
});
