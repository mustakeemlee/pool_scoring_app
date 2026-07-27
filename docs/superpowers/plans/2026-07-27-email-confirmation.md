# Email Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require new signups to confirm their email address before they can use the app, without changing the password-reset flow (which already works correctly).

**Architecture:** Flip `enable_confirmations` on in `supabase/config.toml` (the local/self-hosted dev stack's auth config) and give `Signup.tsx` a "check your email" success state for whenever `signUp()` comes back with no session — the one behavioral signal that confirmation is now required. `ForgotPassword.tsx`/`ResetPassword.tsx` are untouched; they already call the real Supabase reset-password APIs and are independent of this setting.

**Tech Stack:** React 18 + TypeScript, Supabase JS client (`supabase-js` v2 `auth.signUp`), Vitest + `@testing-library/react`.

## Global Constraints

- `enable_confirmations` flips from `false` to `true` in `supabase/config.toml`'s `[auth.email]` section.
- `Signup.tsx` shows a "check your email" state whenever `signUp()`'s response has no `session` (what happens once confirmations are required), instead of today's unconditional `navigate('/dashboard')`. It must still navigate to `/dashboard` in the rare case a session IS returned.
- `signUp()` gains an `options: { emailRedirectTo }` field pointing at `/login` — this is the exact new call shape the existing success-path test's `toHaveBeenCalledWith` assertion must be updated to expect.
- `ForgotPassword.tsx`/`ResetPassword.tsx` are explicitly out of scope — do not modify them. They already call `supabase.auth.resetPasswordForEmail()` and `supabase.auth.updateUser({ password })` respectively, independent of the confirmation setting.
- Confirmed by reading `src/api/testSupport.ts`: every backend integration test creates its auth users via the Supabase admin API (`email_confirm: true` set explicitly), never through the real public `signUp()` flow — so this change cannot break any existing `src/api`/`src/db` test.
- Existing accounts (seed admin, demo players, the test-player account) are already `email_confirm: true` and unaffected by this setting.

---

### Task 1: Flip `enable_confirmations`, add the "check your email" state to `Signup.tsx`

**Files:**
- Modify: `supabase/config.toml`
- Modify: `web/src/pages/Signup.tsx`
- Modify: `web/src/pages/Signup.test.tsx`

**Interfaces:**
- Consumes: `supabase.auth.signUp()` (`web/src/lib/supabaseClient.ts`, unchanged).
- Produces: no new exports — `SignupPage`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/Signup.test.tsx`:

```tsx
// web/src/pages/Signup.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockSignUp = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signUp: (args: unknown) => mockSignUp(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { SignupPage } from './Signup';

function renderPage() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    mockNavigate.mockReset();
  });

  it('shows a "check your email" message when signUp returns no session (email confirmation required)', async () => {
    mockSignUp.mockResolvedValue({ data: { user: {}, session: null }, error: null });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() =>
      expect(mockSignUp).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        password: 'hunter22',
        options: { emailRedirectTo: `${window.location.origin}/login` },
      }),
    );
    expect(await screen.findByText(/check your email to confirm your account/i)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to the dashboard if signUp returns an active session', async () => {
    mockSignUp.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'newuser@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows the error message verbatim on a failed signup', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Email already registered' },
    });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText('Email'), 'dupe@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter22');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => expect(screen.getByText('Email already registered')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the login page', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/Signup.test.tsx`
Expected: FAIL — only the `'shows a "check your email" message...'` test fails. The current `Signup.tsx` unconditionally navigates to `/dashboard` on any non-error response (it never looks at `session`), so with this test's mock (`session: null`) it wrongly calls `navigate` and never renders the "check your email" text; the `signUp` call-args assertion also fails since the current code never passes `options`. The other three tests already pass against the current code — `'navigates to the dashboard...'`'s mock happens to include a session, and the current code's unconditional navigate satisfies it by coincidence; the error-message and login-link tests are unrelated to this change. That's expected: only the behavior this task actually changes needs a red test first.

- [ ] **Step 3: Flip `enable_confirmations` in `supabase/config.toml`**

Edit `supabase/config.toml` — in the `[auth.email]` section, change:

```toml
# If enabled, users need to confirm their email address before signing in.
enable_confirmations = false
```

to:

```toml
# If enabled, users need to confirm their email address before signing in.
enable_confirmations = true
```

- [ ] **Step 4: Update `Signup.tsx`**

Replace the full contents of `web/src/pages/Signup.tsx`:

```tsx
// web/src/pages/Signup.tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabaseClient';

export function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` },
    });
    setIsSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    if (!data.session) {
      setConfirmationSent(true);
      return;
    }
    navigate('/dashboard');
  }

  if (confirmationSent) {
    return (
      <div className="card-surface mx-auto mt-8 max-w-sm p-8">
        <Logo size={40} className="mb-6" />
        <h1 className="mb-6 text-2xl font-extrabold">Sign Up</h1>
        <p className="text-sm">Check your email to confirm your account before logging in.</p>
      </div>
    );
  }

  return (
    <div className="card-surface mx-auto mt-8 max-w-sm p-8">
      <Logo size={40} className="mb-6" />
      <h1 className="mb-6 text-2xl font-extrabold">Sign Up</h1>
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
            minLength={6}
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing up…' : 'Sign up'}
        </Button>
        <Link to="/login" className="text-muted-foreground text-sm hover:underline">
          Already have an account? Log in
        </Link>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/Signup.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/config.toml web/src/pages/Signup.tsx web/src/pages/Signup.test.tsx
git commit -m "feat: require email confirmation on signup"
```

- [ ] **Step 7: Run the full frontend suite and the TypeScript build check**

Run: `cd web && npm test`
Expected: All test files pass (this branch modifies exactly one test file — `Signup.test.tsx`, now 4 tests instead of 3 — no other test should regress).

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0.

If either command reports a failure, fix it directly before considering this task complete.

- [ ] **Step 8: Commit any fixes from Step 7, if needed**

Only run this if Step 7 required changes:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from email confirmation final check"
```

---

## Post-Merge Step (controller-executed directly, NOT a subagent task)

`supabase/config.toml`'s `enable_confirmations` only takes effect for the **local/self-hosted dev stack** once this branch is merged and that stack is restarted. The **live Supabase Cloud project** (`ictqbqtkvptbjecxvnax`, per this repo's memory) has its own, separate copy of this setting that this file does not control by default — it needs `supabase config push` run against that linked project to sync.

This is a live-production-auth-settings change, not a code change, so it is **not** dispatched to an implementer subagent. Do it directly, with the user's explicit go-ahead, after this branch is merged:

1. Confirm a `SUPABASE_ACCESS_TOKEN` is available in the shell (`supabase login`, or the env var set). If not, ask the user for a fresh Personal Access Token (Supabase dashboard → Account Settings → Access Tokens) — the token used earlier this session for cloud work was never persisted, per this repo's own memory notes.
2. Run `supabase config push --project-ref ictqbqtkvptbjecxvnax` from the repo root, on `master`, after the merge.
3. Verify by checking the Cloud project's Auth settings (Dashboard → Authentication → Providers → Email → "Confirm email") show enabled, or by attempting a real signup with a disposable email and confirming no session comes back until the confirmation link is clicked.
4. This step also depends on the Cloud project having working email delivery for confirmation/reset emails (Supabase Cloud's built-in sending, already relied on for the existing password-reset flow) — if delivery turns out to be unreliable in practice, that's a follow-up (custom SMTP), not blocking for this plan.
