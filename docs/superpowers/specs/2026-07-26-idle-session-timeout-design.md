# Idle Session Timeout — Design

Status: Approved by user, 2026-07-26

## 1. Purpose

Today a Supabase session, once created, persists in `localStorage` indefinitely
(`autoRefreshToken`/`persistSession` defaults) — a user who logs in once stays
logged in across refreshes and days later, as long as the refresh token is
still valid. This spec adds a client-side idle timeout: after 5 minutes with no
user activity, the user is signed out. Critically, this must also cover a tab
left dormant overnight — the user should not be silently re-authenticated on
refresh the next day just because the underlying Supabase tokens are still
technically valid.

This applies uniformly to every authenticated route in the app (everything
behind `AuthRouteGuard`/`AdminRouteGuard` today — i.e. all pages except
`/login`, `/signup`, `/forgot-password`, `/reset-password`), for both regular
players and admins. No role gets an exception.

## 2. Scope decisions locked in during brainstorming

- **5-minute idle threshold**, based on tracked user activity (mouse move,
  mouse down, key down, scroll, touch start), not on tab visibility alone.
  Switching away from the tab isn't itself "activity" or "inactivity" — only
  real input events reset the clock.
- **Warn before signing out.** At 4.5 minutes idle, a dialog appears ("You'll
  be signed out in 30s due to inactivity — Stay signed in?"). Any further
  activity (including clicking the button) cancels the sign-out and resets the
  clock. Ignoring it signs the user out at the 5-minute mark. Chosen over a
  silent immediate sign-out so an admin mid-form (e.g. entering a match) gets a
  chance to avoid losing unsaved work.
- **Staleness must survive a full page reload**, not just an in-memory timer.
  The single source of truth is a `lastActivityAt` epoch-ms timestamp
  persisted in `localStorage`, refreshed on activity (throttled to ~once per
  2s). Two consumers read it:
  - A live check every 1s (plus an immediate check on `visibilitychange`/
    `focus`) while a session exists, for the "left the tab open and walked
    away" case.
  - A one-time check inside `AuthProvider`, immediately after
    `supabase.auth.getSession()` resolves on app boot: if a session exists but
    the stored timestamp is already stale, treat it as signed-out and call
    `supabase.auth.signOut()` *before* the rest of the app ever renders
    authenticated content. This is what makes "dormant overnight, refresh next
    day → straight to `/login`" work regardless of whether the JWT/refresh
    token are still technically valid.
  - A brand-new login (no prior `lastActivityAt` recorded yet) is never
    treated as stale.
- **`localStorage` (not `sessionStorage`) for the activity timestamp**, so
  activity in any tab of the same browser keeps all tabs alive, and a
  `storage` event listener lets other tabs react immediately rather than
  waiting for their own next 5s poll.
- **Explain the sign-out.** Both trigger paths (warning-timeout and
  stale-on-load) set a `sessionStorage` flag before calling `signOut()`.
  `LoginPage` reads and clears it on mount, showing "You were signed out due
  to inactivity. Please sign in again." Avoids the user thinking it's a bug.
- **No changes to `supabaseClient.ts` auth config.** `persistSession` /
  `autoRefreshToken` stay at their defaults — this feature is a layer on top,
  not a replacement for Supabase's own token lifecycle. A quick refresh within
  the 5-minute window must still keep the user logged in; only a *stale*
  session gets force-cleared.
- **Out of scope**: per-role timeout durations (e.g. shorter for admins);
  server-side/JWT-expiry changes; a "remember me" opt-out of the timeout.

## 3. Architecture

```
┌─────────────────────────────┐
│      useIdleLogout.ts       │   pure logic, no JSX
│  - attaches activity        │
│    listeners (throttled)    │
│  - writes lastActivityAt    │
│    to localStorage          │
│  - 1s interval + visibility/│
│    focus + storage-event    │
│    re-checks                │
│  - exposes                  │
│    { showWarning,           │
│      secondsRemaining }     │
└──────────────┬──────────────┘
               │ used by
┌──────────────▼──────────────┐
│  IdleLogoutDialog.tsx        │   renders AlertDialog warning;
│  (mounted once in App.tsx)   │   no-ops when there's no session
└───────────────────────────────┘

┌─────────────────────────────┐
│        useAuth.tsx           │   AuthProvider: after getSession()
│  (small addition)             │   resolves, checks lastActivityAt;
│                               │   if stale, signOut() before exposing
│                               │   the session to the rest of the app
└─────────────────────────────┘

┌─────────────────────────────┐
│         Login.tsx             │   (small addition) reads/clears the
│                               │   sessionStorage sign-out-reason flag
│                               │   and shows the explanatory message
└─────────────────────────────┘
```

**New files:**
- `web/src/hooks/useIdleLogout.ts` — the tracking/timer/localStorage logic.
- `web/src/components/IdleLogoutDialog.tsx` — the warning UI, using
  `@/components/ui/alert-dialog` (already used elsewhere via
  `ConfirmDialog.tsx`).

**Modified files:**
- `web/src/hooks/useAuth.tsx` — boot-time staleness check.
- `web/src/App.tsx` — mount `<IdleLogoutDialog />` once, alongside `<TopNav />`.
- `web/src/pages/Login.tsx` — read/display the sign-out-reason message.

## 4. Data flow

1. **Activity** → DOM listener fires → throttled write of
   `Date.now()` to `localStorage['pool-app:last-activity']`.
2. **Live idle check** (every 1s, or on focus/visibility/storage event) →
   read the timestamp → if `now - lastActivityAt >= 4.5min`, flip
   `showWarning = true` and start a 30s countdown; if `>= 5min`, call
   `signOutForIdle()`.
3. **`signOutForIdle()`** → `sessionStorage['pool-app:signout-reason'] =
   'idle'` → `supabase.auth.signOut()` → `onAuthStateChange` fires → `session`
   becomes `null` in `AuthProvider` → `AuthRouteGuard`/`AdminRouteGuard`
   redirect to `/login`.
4. **Boot check** → `AuthProvider` calls `getSession()` → if a session comes
   back but the stored timestamp is stale, run the same `signOutForIdle()`
   path immediately, before setting `isLoading = false` — the rest of the app
   never observes the stale session as "logged in".
5. **Login page** → on mount, checks the `sessionStorage` flag → shows the
   message → clears the flag (so it doesn't reappear on a later, unrelated
   sign-out-by-choice).

## 5. Error handling

- If `supabase.auth.signOut()` itself fails (network blip), the client-side
  `session` state was already going to be treated as invalid by the boot/idle
  check regardless — the guard components key off local `session` state, not
  a live network call, so the redirect to `/login` still happens. The failed
  `signOut()` call is not retried or surfaced as an error; per this repo's
  convention, no swallowed error handling is added beyond what's necessary —
  worst case the server-side session outlives the client's a little longer,
  which existing token-expiry/RLS already bounds.
- `localStorage`/`sessionStorage` access is wrapped in nothing special — this
  app already assumes a normal browser environment (Supabase's own client
  requires it too).

## 6. Testing

Pure client-side logic — Vitest + `vi.useFakeTimers()`, no backend/Docker
stack needed:
- Activity resets the idle clock.
- No activity for 4.5 min → warning state becomes true.
- No activity from there to 5 min → `supabase.auth.signOut()` called.
- Activity during the warning window → warning cancelled, clock reset, no
  sign-out.
- A stale `lastActivityAt` (simulated old timestamp) plus an existing session
  at mount → `signOut()` called before the app treats the session as valid.
- A fresh login with no prior `lastActivityAt` → not treated as stale.
- `Login.tsx` shows the inactivity message when the flag is set, and doesn't
  when it isn't.
