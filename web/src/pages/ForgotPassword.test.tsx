// web/src/pages/ForgotPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockReset = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { resetPasswordForEmail: (email: string, opts: unknown) => mockReset(email, opts) } },
}));

import { ForgotPasswordPage } from './ForgotPassword';

describe('ForgotPasswordPage', () => {
  beforeEach(() => mockReset.mockReset());

  it('sends a reset email with a redirect to /reset-password', async () => {
    mockReset.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith('admin@example.com', {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    );
    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
  });

  it('shows the error message verbatim on failure', async () => {
    mockReset.mockResolvedValue({ data: null, error: { message: 'Unable to validate email address' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(screen.getByText('Unable to validate email address')).toBeInTheDocument());
  });
});
