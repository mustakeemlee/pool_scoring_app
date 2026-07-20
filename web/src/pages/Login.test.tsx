// web/src/pages/Login.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (args: unknown) => mockSignIn(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { LoginPage } from './Login';

describe('LoginPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockNavigate.mockReset();
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
});
