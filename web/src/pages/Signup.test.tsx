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

describe('SignupPage', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    mockNavigate.mockReset();
  });

  it('signs up and navigates to the dashboard on success', async () => {
    mockSignUp.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith({ email: 'newuser@example.com', password: 'hunter22' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the error message verbatim on a failed signup', async () => {
    mockSignUp.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Email already registered' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'dupe@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => expect(screen.getByText('Email already registered')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the login page', () => {
    render(
      <MemoryRouter>
        <SignupPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
  });
});
