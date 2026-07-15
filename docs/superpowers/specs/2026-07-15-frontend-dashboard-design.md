# Pool League Dashboard — Design (Phase 3)

Status: Approved by user, 2026-07-15
Scope: React/TypeScript/Tailwind frontend — public leaderboard/stats pages plus an
admin-gated weekly workflow. Local dev only; no cloud deploy or containerization
decided yet.

Builds directly on Phase 1 (`docs/superpowers/specs/2026-07-14-rating-engine-design.md`,
`src/rating/*.ts`) and Phase 2 (`docs/superpowers/specs/2026-07-14-backend-api-design.md`,
the four Edge Functions, RLS-gated PostgREST reads, `leaderboard_view`/
`grade_distribution_view`).

## 1. Purpose

Give the league a real interface on top of Phase 1/2's engine and API: anyone can
view the leaderboard, a player's rating history, grade distribution, and match
history with no login; an admin logs in to run the weekly workflow (enter a match,
correct a mistake, close the week, start a new season).

## 2. Scope decisions locked in during brainstorming

- **Single app, role-gated routes** — not two separate apps. Public routes are open;
  `/admin/*` routes require a logged-in admin, checked client-side via a route guard.
- **Local dev server only for this phase.** `npm run dev` (Vite) against the local
  Supabase stack, same as the backend's local-only setup. No Dockerfile, no cloud
  Supabase project, no hosting decision — that's a future phase once there's a real
  reason to host this outside local dev. (Phase 1's original plan to containerize the
  frontend via `docker-compose.yml` is superseded — that file was deleted in Phase 2
  when the vendored Postgres container was retired in favor of the Supabase CLI.)
- **Tailwind + shadcn/ui** for components — Tailwind-native, accessible (Radix-based),
  copied into the repo as source rather than an opaque npm dependency.
- **Vite + React + TypeScript + React Router + TanStack Query + Recharts.** Rejected
  Next.js (buys SSR/SEO this project doesn't need yet, adds real complexity) and a
  generic admin-panel framework like Refine/React-admin (this app's admin actions
  aren't generic CRUD — `correct-match` replays ratings, `close-week` is a batch
  reconciliation — a CRUD framework's assumptions would fight the domain more than
  help).
- **Layout: top nav globally**, with an additional sidebar that appears only inside
  `/admin/*` for the admin-specific sub-navigation (Enter Match / Correct a Match /
  Close Week / Start Season). Logged-out visitors never see the sidebar or any admin
  affordance beyond an "Admin login" link.
- **No self-service signup, no E2E test suite, no cloud deploy** — all explicitly
  out of scope for this phase (see §8).

## 3. Project structure

New top-level `web/` directory, its own Vite project with its own `package.json` —
kept separate from the root's backend/testing tooling (different dependency sets,
no reason to entangle a React/Vite toolchain with the backend's vitest/Supabase CLI
setup).

```
web/
  src/
    pages/         Leaderboard, PlayerProfile, GradeDistribution, MatchHistory,
                    admin/EnterMatch, admin/CorrectMatch, admin/CloseWeek,
                    admin/StartSeason, admin/Login, admin/ResetPassword
    components/     GradeBadge, RatingChart, MatchTable, OddsWidget,
                    ConfirmDialog, AdminRouteGuard, ...
    lib/            supabaseClient.ts, edgeFunctions.ts (thin fetch wrappers for
                    the 4 write actions), queryKeys.ts
    hooks/          useLeaderboard, usePlayerProfile, useAuth, ...
  index.html, vite.config.ts, tailwind.config.ts, tsconfig.json, .env.local
```

Routing via React Router: public routes (`/`, `/players/:id`, `/grades`,
`/matches`) plus `/admin/*` wrapped in `AdminRouteGuard`. `.env.local` holds the
public `SUPABASE_URL`/`SUPABASE_ANON_KEY` for the local stack (same values
`getSupabaseStatus()` already reads for the backend's tests).

## 4. Pages & data flow

Public pages read directly from PostgREST via the Supabase JS client (`anon` key,
RLS-gated — see Phase 2 spec §4), each wrapped in a TanStack Query hook for caching:

| Page | Reads from |
|---|---|
| Leaderboard (home) | `leaderboard_view` |
| Player profile | `player_season_ratings` + `player_statistics` (current state), `rating_events` (chart history), `matches` (recent match table) — all filtered by `player_id` |
| Grade distribution | `grade_distribution_view` |
| Match history | `matches` joined to `players` via PostgREST embedded resources |

Admin actions call the four Edge Functions directly (`fetch` with
`Authorization: Bearer <session access_token>`), then invalidate the relevant
TanStack Query cache keys so the UI reflects the change immediately — submitting a
match invalidates that pairing's/leaderboard's queries, `close-week` invalidates
the whole leaderboard/rankings, `start-season` invalidates the season list.

**Odds widget:** the statistical win-probability engine (`src/rating/odds.ts`,
pure math, no DB access, per Phase 2 spec §2) is imported directly into the
**enter-match form** — as the admin selects both players, a small readout
computes client-side from their current ratings before the match is submitted.
Displayed as a **win-probability percentage** for each player (`winProbability`),
not gambling-style decimal odds — consistent with Phase 1's explicit framing that
this is a statistical feature, not a betting one. `impliedDecimalOdds` exists in
the engine but isn't surfaced in the UI for this phase.

**Correct-match page:** lists the current open week's non-voided matches (a plain
filtered read of `matches` — public per RLS, no admin-only read needed), the admin
picks one to edit. This is the one admin page not listed in the §4 table since
it's gated behind `/admin/*`, not a public read path.

## 5. Auth

Admin login is a plain email/password form (`supabase.auth.signInWithPassword`) —
no self-service signup, matching Phase 2's decision that admin accounts are
provisioned manually via Supabase Studio. Session persistence uses Supabase's own
local-storage session handling; a `useAuth` context wraps
`supabase.auth.onAuthStateChange`.

`AdminRouteGuard` checks two things: a valid session exists, *and* that user's id
has a row in `admin_users` (a self-read permitted by Task 3's RLS policy —
`select * from admin_users where id = auth.uid()`). An authenticated-but-not-admin
user is bounced to a clear "not authorized" message rather than the admin UI —
this also covers for the backend itself returning a bare 401 (not 403) for that
case (a known, accepted deviation flagged in Phase 2's whole-branch review).

**Forgot password:** a "Forgot password?" link on the login page calls
`supabase.auth.resetPasswordForEmail(email)`, which sends a reset link (captured
locally by Mailpit in local dev; a real email once/if this is ever hosted for
real). The link lands on `/admin/reset-password`, which calls
`supabase.auth.updateUser({ password })` using the temporary recovery session
Supabase establishes from the link. No custom backend work — entirely handled by
Supabase Auth's existing local stack.

## 6. Error handling & loading states

- **Reads:** TanStack Query's `isLoading`/`isError` states drive skeleton loaders
  and inline error messages ("Couldn't load leaderboard, retry") with a retry
  action — no custom per-page fetching logic.
- **Admin writes:** client-side validation mirrors known DB constraints (e.g.
  `frames_a !== frames_b`) before submitting, so obviously-invalid input never
  round-trips. Server-side failures surface as a toast showing the Edge Function's
  actual error message verbatim — these are already descriptive (e.g. `"Cannot
  correct a match whose week has already closed"`), so the frontend doesn't
  re-interpret them.
- **Successful mutations:** a success toast (e.g. `"Alex Testplayer +14.2 (1754 →
  1768)"`) plus the cache invalidation from §4.
- **Close-week/start-season confirm dialogs:** since these are batch, hard-to-undo
  actions, the confirm step states the blast radius in plain language (match
  count, player count affected) before running, and shows a results summary after
  (rank changes, new grades).

## 7. Testing

Vitest + React Testing Library for component-level tests on logic worth testing:
form validation (the frame-score constraint, required fields), the odds-widget
calculation wiring, `AdminRouteGuard`'s admit/reject logic, and data-shaping hooks
(turning `rating_events` rows into chart-ready points). No E2E suite for this
phase — disproportionate infra for a local admin tool with no CI pipeline yet.
Manual verification via the dev server, against seeded data (`npm run seed` from
the backend), covers page-level/visual/integration correctness before any task is
considered done.

## 8. Out of scope for this phase

Deferred: cloud hosting/deploy target, Docker containerization of the frontend,
an E2E test suite, self-service admin signup, doubles/team match support (already
deferred from Phase 1), and CI/CD. All of these are real future decisions, just
not blocking a working local dashboard.
