# Idle Session Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign a user out after 5 minutes of inactivity, and treat any session that was already stale by that measure as signed-out the moment the app loads — even after an overnight-dormant tab is refreshed — regardless of whether the underlying Supabase JWT/refresh token is still technically valid.

**Architecture:** A `lastActivityAt` timestamp lives in `localStorage` (shared across tabs), refreshed on real user input and read by (a) a live 1s poll + focus/visibility/storage listeners while a session exists, and (b) a one-time check inside `AuthProvider` right after `supabase.auth.getSession()` resolves, before the app ever renders authenticated content. Both paths funnel through the same staleness check, so there's no ordering race between the initial session fetch and Supabase's own `onAuthStateChange` events. A warning dialog appears 30s before the actual sign-out; a `sessionStorage` flag carries the "why" across the redirect so `/login` can explain itself.

**Tech Stack:** React 18 + TypeScript, Vitest + `@testing-library/react` (fake timers for time-based tests), existing shadcn/ui `AlertDialog`, Supabase JS v2 (`supabase.auth`).

## Global Constraints

- Idle timeout: exactly 5 minutes (`IDLE_TIMEOUT_MS = 5 * 60 * 1000`) of no tracked activity.
- Warning lead time: 30 seconds before sign-out (`WARNING_LEAD_MS = 30 * 1000`).
- Tracked activity events: `mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`. Tab visibility alone is not activity.
- Applies uniformly to every authenticated route (everything behind `AuthRouteGuard`/`AdminRouteGuard`) and to every role (player and admin alike) — no per-role exception.
- `localStorage` key: `pool-app:last-activity`. `sessionStorage` key (reason flag): `pool-app:signout-reason`.
- No changes to `web/src/lib/supabaseClient.ts` — `persistSession`/`autoRefreshToken` stay at their defaults. A quick refresh within the 5-minute window must still keep the user logged in; only a genuinely stale session gets force-cleared.
- Errors from `supabase.auth.signOut()` itself are not retried or surfaced — the client already treats the session as gone regardless of whether the network call succeeds.

---

### Task 1: Idle-session storage helpers

**Files:**
- Create: `web/src/lib/idleSession.ts`
- Test: `web/src/lib/idleSession.test.ts`

**Interfaces:**
- Consumes: nothing (pure `localStorage`/`sessionStorage` helpers).
- Produces (used by every later task):
  - `IDLE_TIMEOUT_MS: number`
  - `WARNING_LEAD_MS: number`
  - `ACTIVITY_STORAGE_KEY: string`
  - `markActivityNow(): void`
  - `getLastActivity(): number | null`
  - `msSinceLastActivity(now?: number): number | null`
  - `isActivityStale(now?: number): boolean`
  - `setIdleSignoutReason(): void`
  - `consumeIdleSignoutReason(): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/idleSession.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IDLE_TIMEOUT_MS,
  WARNING_LEAD_MS,
  ACTIVITY_STORAGE_KEY,
  markActivityNow,
  getLastActivity,
  msSinceLastActivity,
  isActivityStale,
  setIdleSignoutReason,
  consumeIdleSignoutReason,
} from './idleSession';

describe('idleSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes a 5 minute idle timeout and a 30 second warning lead', () => {
    expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(WARNING_LEAD_MS).toBe(30 * 1000);
  });

  it('returns null when nothing has been recorded yet', () => {
    expect(getLastActivity()).toBeNull();
    expect(msSinceLastActivity()).toBeNull();
  });

  it('markActivityNow records the current time under ACTIVITY_STORAGE_KEY', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe('1000000');
    expect(getLastActivity()).toBe(1_000_000);
  });

  it('msSinceLastActivity computes elapsed time from a supplied "now"', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(msSinceLastActivity(1_000_000 + 4_000)).toBe(4_000);
  });

  it('isActivityStale is false when nothing has been recorded (brand-new login)', () => {
    expect(isActivityStale()).toBe(false);
  });

  it('isActivityStale flips from false to true exactly at the timeout', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(isActivityStale(1_000_000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
    expect(isActivityStale(1_000_000 + IDLE_TIMEOUT_MS)).toBe(true);
  });

  it('consumeIdleSignoutReason returns false repeatedly when nothing was set', () => {
    expect(consumeIdleSignoutReason()).toBe(false);
    expect(consumeIdleSignoutReason()).toBe(false);
  });

  it('consumeIdleSignoutReason returns true exactly once after setIdleSignoutReason', () => {
    setIdleSignoutReason();
    expect(consumeIdleSignoutReason()).toBe(true);
    expect(consumeIdleSignoutReason()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/lib/idleSession.test.ts`
Expected: FAIL — `Cannot find module './idleSession'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

```ts
// web/src/lib/idleSession.ts
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const WARNING_LEAD_MS = 30 * 1000;

export const ACTIVITY_STORAGE_KEY = 'pool-app:last-activity';
const SIGNOUT_REASON_KEY = 'pool-app:signout-reason';

export function markActivityNow(): void {
  localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
}

export function getLastActivity(): number | null {
  const value = localStorage.getItem(ACTIVITY_STORAGE_KEY);
  return value === null ? null : Number(value);
}

export function msSinceLastActivity(now: number = Date.now()): number | null {
  const last = getLastActivity();
  return last === null ? null : now - last;
}

export function isActivityStale(now: number = Date.now()): boolean {
  const elapsed = msSinceLastActivity(now);
  return elapsed !== null && elapsed >= IDLE_TIMEOUT_MS;
}

export function setIdleSignoutReason(): void {
  sessionStorage.setItem(SIGNOUT_REASON_KEY, 'idle');
}

export function consumeIdleSignoutReason(): boolean {
  const value = sessionStorage.getItem(SIGNOUT_REASON_KEY);
  if (value !== null) {
    sessionStorage.removeItem(SIGNOUT_REASON_KEY);
  }
  return value === 'idle';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/idleSession.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/idleSession.ts web/src/lib/idleSession.test.ts
git commit -m "feat: add idle-session storage helpers"
```

---

### Task 2: AuthProvider boot-time and event-driven staleness check

**Files:**
- Modify: `web/src/hooks/useAuth.tsx`
- Modify: `web/src/hooks/useAuth.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `isActivityStale()`, `getLastActivity()`, `markActivityNow()`, `setIdleSignoutReason()`.
- Produces: no change to `AuthContextValue` shape (`{ session, isLoading }`) — existing consumers (`AuthRouteGuard`, `AdminRouteGuard`, etc.) are unaffected.

This task fixes a subtle correctness trap: Supabase's `onAuthStateChange` fires a `TOKEN_REFRESHED` event on its own timer (independent of user activity) while a tab is open. If that event were allowed to call `markActivityNow()`, an idle user's session would never time out for as long as auto-refresh keeps firing. The fix is to only ever mark a *fresh* baseline on an explicit `SIGNED_IN` event, or the first time a valid session is seen with no baseline recorded at all (covers upgrading a browser that was already logged in before this feature shipped) — never on `TOKEN_REFRESHED`/`USER_UPDATED`/etc. Staleness itself is re-derived from persisted state on every call, from both the boot path and every subsequent auth event, so there's no window where a stale session can slip through via event ordering.

- [ ] **Step 1: Write the failing tests**

```tsx
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
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/hooks/useAuth.test.tsx`
Expected: the 3 pre-existing tests PASS; the 4 new tests FAIL (staleness/baseline logic doesn't exist yet in `useAuth.tsx`).

- [ ] **Step 3: Update `useAuth.tsx`**

```tsx
// web/src/hooks/useAuth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { getLastActivity, isActivityStale, markActivityNow, setIdleSignoutReason } from '@/lib/idleSession';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    function acceptSession(newSession: Session | null, isSignIn: boolean) {
      if (newSession && isActivityStale()) {
        setIdleSignoutReason();
        void supabase.auth.signOut();
        setSession(null);
        return;
      }
      if (newSession && (isSignIn || getLastActivity() === null)) {
        markActivityNow();
      }
      setSession(newSession);
    }

    supabase.auth.getSession().then(({ data }) => {
      acceptSession(data.session, false);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      acceptSession(newSession, event === 'SIGNED_IN');
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useAuth.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useAuth.tsx web/src/hooks/useAuth.test.tsx
git commit -m "feat: sign out stale sessions on boot and auth events"
```

---

### Task 3: Login page inactivity notice

**Files:**
- Modify: `web/src/pages/Login.tsx`
- Modify: `web/src/pages/Login.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `consumeIdleSignoutReason()`, `setIdleSignoutReason()` (test-only, to arrange the flag).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/Login.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setIdleSignoutReason } from '@/lib/idleSession';

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (args: unknown) => mockSignIn(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { LoginPage } from './Login';

describe('LoginPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockNavigate.mockReset();
    sessionStorage.clear();
  });

  it('signs in and navigates to the admin home on success', async () => {
    mockSignIn.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'hunter2' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the error message verbatim on a failed login', async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the forgot-password page', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('shows an inactivity notice when redirected here by the idle timeout', () => {
    setIdleSignoutReason();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('You were signed out due to inactivity. Please sign in again.'),
    ).toBeInTheDocument();
  });

  it('does not show an inactivity notice on a normal visit', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/signed out due to inactivity/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: the 3 pre-existing tests PASS; the 2 new tests FAIL (no notice is rendered yet).

- [ ] **Step 3: Update `Login.tsx`**

```tsx
// web/src/pages/Login.tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabaseClient';
import { consumeIdleSignoutReason } from '@/lib/idleSession';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showIdleNotice] = useState(() => consumeIdleSignoutReason());

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate('/dashboard');
  }

  return (
    <div className="card-surface mx-auto mt-8 max-w-sm p-8">
      <Logo size={40} className="mb-6" />
      <h1 className="mb-6 text-2xl font-extrabold">Log In</h1>
      {showIdleNotice && (
        <p className="mb-4 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
          You were signed out due to inactivity. Please sign in again.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
        <Link to="/forgot-password" className="text-muted-foreground text-sm hover:underline">
          Forgot password?
        </Link>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Login.tsx web/src/pages/Login.test.tsx
git commit -m "feat: show an inactivity notice on the login page"
```

---

### Task 4: `useIdleLogout` tracking hook

**Files:**
- Create: `web/src/hooks/useIdleLogout.ts`
- Test: `web/src/hooks/useIdleLogout.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `@/hooks/useAuth` (`{ session }`); `supabase.auth.signOut()` from `@/lib/supabaseClient`; from Task 1: `IDLE_TIMEOUT_MS`, `WARNING_LEAD_MS`, `ACTIVITY_STORAGE_KEY`, `markActivityNow()`, `msSinceLastActivity()`, `setIdleSignoutReason()`.
- Produces (used by Task 5): `useIdleLogout(): { showWarning: boolean; secondsRemaining: number; stayActive: () => void }`.

- [ ] **Step 1: Write the failing test**

```tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useIdleLogout.test.tsx`
Expected: FAIL — `Cannot find module './useIdleLogout'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/hooks/useIdleLogout.ts
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import {
  ACTIVITY_STORAGE_KEY,
  IDLE_TIMEOUT_MS,
  WARNING_LEAD_MS,
  markActivityNow,
  msSinceLastActivity,
  setIdleSignoutReason,
} from '@/lib/idleSession';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const ACTIVITY_WRITE_THROTTLE_MS = 2_000;
const CHECK_INTERVAL_MS = 1_000;

interface IdleLogoutState {
  showWarning: boolean;
  secondsRemaining: number;
  stayActive: () => void;
}

export function useIdleLogout(): IdleLogoutState {
  const { session } = useAuth();
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!session) {
      setElapsedMs(null);
      return;
    }

    let lastWriteAt = 0;

    function recordActivity() {
      const now = Date.now();
      if (now - lastWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteAt = now;
      markActivityNow();
      setElapsedMs(0);
    }

    function checkIdle() {
      const elapsed = msSinceLastActivity();
      if (elapsed === null) return;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        setIdleSignoutReason();
        void supabase.auth.signOut();
        return;
      }
      setElapsedMs(elapsed);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === ACTIVITY_STORAGE_KEY) {
        checkIdle();
      }
    }

    checkIdle();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, recordActivity));
    const interval = setInterval(checkIdle, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkIdle);
    document.addEventListener('visibilitychange', checkIdle);
    window.addEventListener('storage', handleStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
      clearInterval(interval);
      window.removeEventListener('focus', checkIdle);
      document.removeEventListener('visibilitychange', checkIdle);
      window.removeEventListener('storage', handleStorage);
    };
  }, [session]);

  const showWarning = elapsedMs !== null && elapsedMs >= IDLE_TIMEOUT_MS - WARNING_LEAD_MS;
  const secondsRemaining =
    elapsedMs !== null ? Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - elapsedMs) / 1000)) : 0;

  function stayActive() {
    markActivityNow();
    setElapsedMs(0);
  }

  return { showWarning, secondsRemaining, stayActive };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useIdleLogout.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useIdleLogout.ts web/src/hooks/useIdleLogout.test.tsx
git commit -m "feat: add useIdleLogout activity-tracking hook"
```

---

### Task 5: Warning dialog, mounted app-wide

**Files:**
- Create: `web/src/components/IdleLogoutDialog.tsx`
- Test: `web/src/components/IdleLogoutDialog.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes (from Task 4): `useIdleLogout(): { showWarning, secondsRemaining, stayActive }`.
- Consumes: `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction` from `@/components/ui/alert-dialog` (all already exported there).
- Produces: `IdleLogoutDialog` component, mounted once in `App.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/IdleLogoutDialog.test.tsx
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/IdleLogoutDialog.test.tsx`
Expected: FAIL — `Cannot find module './IdleLogoutDialog'`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/IdleLogoutDialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useIdleLogout } from '@/hooks/useIdleLogout';

export function IdleLogoutDialog() {
  const { showWarning, secondsRemaining, stayActive } = useIdleLogout();

  return (
    <AlertDialog open={showWarning} onOpenChange={(open) => !open && stayActive()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You&apos;ll be signed out soon</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve been inactive for a while — you&apos;ll be signed out in {secondsRemaining}s due
            to inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={stayActive}>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Then mount it once, app-wide, alongside `<TopNav />`:

```tsx
// web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { IdleLogoutDialog } from '@/components/IdleLogoutDialog';
import { AdminRouteGuard } from '@/components/AdminRouteGuard';
import { AuthRouteGuard } from '@/components/AuthRouteGuard';
import { AdminLayout } from '@/components/AdminLayout';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { ExplorePage } from '@/pages/Explore';
import { NotFoundPage } from '@/pages/NotFound';
import { DashboardPage } from '@/pages/Dashboard';
import { SettingsPage } from '@/pages/Settings';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { EnterMatchPage } from '@/pages/admin/EnterMatch';
import { CorrectMatchPage } from '@/pages/admin/CorrectMatch';
import { CloseWeekPage } from '@/pages/admin/CloseWeek';
import { StartSeasonPage } from '@/pages/admin/StartSeason';
import { ManagePlayersPage } from '@/pages/admin/ManagePlayers';
import { Analytics } from '@vercel/analytics/react';

export function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <TopNav />
      <IdleLogoutDialog />
      <main className="container py-8">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<AuthRouteGuard />}>
            <Route path="/" element={<LeaderboardPage />} />
            <Route path="/players/:playerId" element={<PlayerProfilePage />} />
            <Route path="/grades" element={<GradeDistributionPage />} />
            <Route path="/matches" element={<MatchHistoryPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route element={<AdminRouteGuard />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin/enter-match" element={<EnterMatchPage />} />
              <Route path="/admin/correct-match" element={<CorrectMatchPage />} />
              <Route path="/admin/close-week" element={<CloseWeekPage />} />
              <Route path="/admin/start-season" element={<StartSeasonPage />} />
              <Route path="/admin/players" element={<ManagePlayersPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/IdleLogoutDialog.test.tsx`
Expected: PASS (2 tests).

Then run the whole frontend suite to confirm nothing regressed (in particular `App.test.tsx`, which mounts the full `App` tree and now also mounts `IdleLogoutDialog`):

Run: `npx vitest run`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/IdleLogoutDialog.tsx web/src/components/IdleLogoutDialog.test.tsx web/src/App.tsx
git commit -m "feat: show an idle-timeout warning dialog app-wide"
```

---

## Self-Review Notes

- **Spec coverage:** 5-min timeout + activity events (Task 4), warn-then-sign-out at 4.5min/5min (Task 4/5), stale-session-survives-reload (Task 2), localStorage cross-tab sharing + storage-event reactivity (Task 4), sign-out reason message (Task 3), no `supabaseClient.ts` changes (never touched by any task) — all covered.
- **Extra correctness fix locked in during planning:** `TOKEN_REFRESHED`-driven baseline resets (Task 2) — not in the original spec's prose but necessary to satisfy the spec's own intent ("only a stale session gets force-cleared"; a naively-implemented version would never time out an idle tab because Supabase's own token-refresh timer would keep resetting the clock). Covered by dedicated regression tests in Task 2.
- **Type/name consistency checked:** `useIdleLogout()`'s return shape (`showWarning`, `secondsRemaining`, `stayActive`) matches exactly between Task 4's implementation/tests and Task 5's `IdleLogoutDialog` usage/tests. `idleSession.ts`'s exports are named identically everywhere they're imported (Tasks 2, 3, 4).
