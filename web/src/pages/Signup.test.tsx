// web/src/pages/Signup.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockSignUp = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signUp: (args: unknown) => mockSignUp(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { SignupPage } from './Signup';

function renderPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    mockNavigate.mockReset();
  });

  it('shows a "check your email" message when signUp returns no session (email confirmation required)', async () => {
    mockSignUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'hunter22',
        options: { emailRedirectTo: `${window.location.origin}/login` },
      }),
    );
    expect(await screen.findByText(/check your email to confirm your account/i)).toBeInTheDocument();
    // Echoes the address it was sent to, and offers a way back to /login,
    // rather than leaving the admin at a dead end.
    expect(screen.getByText(/newuser@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the dashboard if signUp returns an active session', async () => {
    mockSignUp.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows the error message verbatim on a failed signup', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email already registered' },
    });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'dupe@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => expect(screen.getByText('Email already registered')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the login page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
  });
});
