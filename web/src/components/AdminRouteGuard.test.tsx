// web/src/components/AdminRouteGuard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

import { AdminRouteGuard } from './AdminRouteGuard';

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/admin/enter-match']}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route element={<AdminRouteGuard />}>
          <Route path="/admin/enter-match" element={<p>enter match page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRouteGuard', () => {
  it('redirects to /admin/login when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows a not-authorized message for a signed-in non-admin', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
  });

  it('renders the nested route for a signed-in admin', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText('enter match page')).toBeInTheDocument();
  });
});
