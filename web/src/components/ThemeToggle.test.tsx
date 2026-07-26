import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseTheme = vi.fn();
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => mockUseTheme() }));

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  it('shows a button labeled to switch to light mode when currently dark', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('shows a button labeled to switch to dark mode when currently light', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('calls toggleTheme when clicked', async () => {
    const toggleTheme = vi.fn();
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme });
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(toggleTheme).toHaveBeenCalled();
  });
});
