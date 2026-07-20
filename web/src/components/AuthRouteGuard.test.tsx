import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

import { AuthRouteGuard } from './AuthRouteGuard';

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<AuthRouteGuard />}>
          <Route path="/dashboard" element={<p>dashboard page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AuthRouteGuard', () => {
  it('redirects to /login when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the nested route for any signed-in session', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    renderGuarded();
    expect(screen.getByText('dashboard page')).toBeInTheDocument();
  });
});
