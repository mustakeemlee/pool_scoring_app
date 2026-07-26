import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseIdleLogout = vi.fn();
vi.mock('@/hooks/useIdleLogout', () => ({ useIdleLogout: () => mockUseIdleLogout() }));

import { IdleLogoutDialog } from './IdleLogoutDialog';

describe('IdleLogoutDialog', () => {
  it('renders nothing visible when there is no warning', () => {
    mockUseIdleLogout.mockReturnValue({ showWarning: false, secondsRemaining: 0, stayActive: vi.fn() });
    render(<IdleLogoutDialog />);
    expect(screen.queryByText(/signed out/)).not.toBeInTheDocument();
  });

  it('shows the countdown and calls stayActive when the button is clicked', async () => {
    const stayActive = vi.fn();
    mockUseIdleLogout.mockReturnValue({ showWarning: true, secondsRemaining: 12, stayActive });
    const user = userEvent.setup();

    render(<IdleLogoutDialog />);
    expect(screen.getByText(/signed out in 12s due to inactivity/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(stayActive).toHaveBeenCalled();
  });
});
