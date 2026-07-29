// web/src/hooks/useAuth.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ACTIVITY_STORAGE_KEY, IDLE_TIMEOUT_MS, getLastActivity } from '@/lib/idleSession';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
      signOut: () => mockSignOut(),
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
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    localStorage.clear();
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

  it('signs out and exposes a null session when the stored activity timestamp is already stale', async () => {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now() - IDLE_TIMEOUT_MS - 1_000));
    mockGetSession.mockResolvedValue({ data: { session: { user: { email: 'admin@example.com' } } } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('does not sign out a session with no prior recorded activity (brand-new login)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { email: 'admin@example.com' } } } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('signed in as admin@example.com')).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('marks a fresh activity baseline on a SIGNED_IN auth event, even if one already existed', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());

    const oldTimestamp = Date.now() - 60_000;
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(oldTimestamp));
    const callback = mockOnAuthStateChange.mock.calls[0][0];
    callback('SIGNED_IN', { user: { email: 'admin@example.com' } });

    await waitFor(() => expect(getLastActivity()).toBeGreaterThan(oldTimestamp));
  });

  it('accepts a fresh sign-in even when a stale activity timestamp is still on record', async () => {
    // Reproduces the post-idle-logout relogin loop: the user was auto signed
    // out for inactivity (leaving a stale timestamp behind), then re-enters
    // credentials on /login without ever touching an authenticated page in
    // between, so nothing has refreshed ACTIVITY_STORAGE_KEY.
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());

    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now() - IDLE_TIMEOUT_MS - 1_000));
    const callback = mockOnAuthStateChange.mock.calls[0][0];
    callback('SIGNED_IN', { user: { email: 'admin@example.com' } });

    await waitFor(() => expect(screen.getByText('signed in as admin@example.com')).toBeInTheDocument());
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does not reset the activity timestamp on a token-refresh auth event', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());

    const recentTimestamp = Date.now() - 60_000;
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(recentTimestamp));
    const callback = mockOnAuthStateChange.mock.calls[0][0];
    callback('TOKEN_REFRESHED', { user: { email: 'admin@example.com' } });

    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe(String(recentTimestamp));
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
