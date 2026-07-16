// web/src/pages/admin/ResetPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockUpdateUser = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: (args: unknown) => mockUpdateUser(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ResetPasswordPage } from './ResetPassword';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockUpdateUser.mockReset();
    mockNavigate.mockReset();
  });

  it('rejects mismatched password confirmation without calling the API', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'different123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('updates the password and navigates to login on success', async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpass123' }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/login');
  });

  it('shows the error message verbatim on failure', async () => {
    mockUpdateUser.mockResolvedValue({ data: null, error: { message: 'Auth session missing' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(screen.getByText('Auth session missing')).toBeInTheDocument());
  });
});
