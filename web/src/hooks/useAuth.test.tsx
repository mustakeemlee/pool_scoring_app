// web/src/hooks/useAuth.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

import { AuthProvider, useAuth } from './useAuth';

function Probe() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <p>loading</p>;
  return <p>{session ? `signed in as ${session.user.email}` : 'signed out'}</p>;
}

describe('useAuth', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockOnAuthStateChange.mockReset();
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it('resolves the initial session from supabase.auth.getSession', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { email: 'admin@example.com' } } } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('signed in as admin@example.com')).toBeInTheDocument());
  });

  it('reflects a null session as signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
  });

  it('throws when useAuth is called outside AuthProvider', () => {
    function Bare() {
      useAuth();
      return null;
    }
    expect(() => render(<Bare />)).toThrow('useAuth must be used within an AuthProvider');
  });
});
