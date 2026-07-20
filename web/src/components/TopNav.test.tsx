// web/src/components/TopNav.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopNav } from './TopNav';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

describe('TopNav', () => {
  it('renders links to every public page plus the logged-out account links', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    render(
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/grades');
    expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/matches');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  });
});
