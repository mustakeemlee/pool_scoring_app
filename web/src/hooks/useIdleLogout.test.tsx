// web/src/hooks/useIdleLogout.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const mockUseAuth = vi.fn();
const mockSignOut = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signOut: () => mockSignOut() } },
}));

import { useIdleLogout } from './useIdleLogout';
import { IDLE_TIMEOUT_MS, WARNING_LEAD_MS, ACTIVITY_STORAGE_KEY } from '@/lib/idleSession';

function Probe() {
  const { showWarning, secondsRemaining, stayActive } = useIdleLogout();
  return (
    <div>
      <p>warning: {String(showWarning)}</p>
      <p>seconds: {secondsRemaining}</p>
      <button onClick={stayActive}>stay</button>
    </div>
  );
}

describe('useIdleLogout', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    mockSignOut.mockReset().mockResolvedValue({ error: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null });
    render(<Probe />);

    act(() => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1_000);
    });

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('shows a warning after the warning threshold and signs out at the full timeout', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } });
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));

    render(<Probe />);

    act(() => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - WARNING_LEAD_MS);
    });
    expect(screen.getByText('warning: true')).toBeInTheDocument();
    expect(mockSignOut).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(WARNING_LEAD_MS);
    });
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('resets the timer when a tracked activity event fires', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } });
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));

    render(<Probe />);

    act(() => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - WARNING_LEAD_MS);
    });
    expect(screen.getByText('warning: true')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    expect(screen.getByText('warning: false')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - WARNING_LEAD_MS - 1_000);
    });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('stayActive dismisses the warning immediately', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } } });
    localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));

    render(<Probe />);

    act(() => {
      vi.advanceTimersByTime(IDLE_TIMEOUT_MS - WARNING_LEAD_MS);
    });
    expect(screen.getByText('warning: true')).toBeInTheDocument();

    act(() => {
      screen.getByText('stay').click();
    });
    expect(screen.getByText('warning: false')).toBeInTheDocument();
  });
});
