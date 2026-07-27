# Engagement Features (Grade Drill-Down, Fixtures, Match Comparison, Dashboard Content, Email Confirmation) — Design

Status: Approved by user, 2026-07-27

## 1. Purpose

Five separate feature requests, brainstormed together at the user's explicit
request rather than sequenced one at a time:

1. **Grade drill-down**: clicking a grade on the Grade Distribution page opens
   a roster of every player in that grade, each linking to their profile.
2. **Fixtures/Results**: the Matches nav item gains two sub-tabs — a real
   schedule of upcoming, not-yet-played matches ("Fixtures"), and the existing
   played-match history reframed as "Results".
3. **Match comparison view**: clicking a fixture or a result opens an
   EPL-Match-Centre-style side-by-side comparison of the two players — photos,
   names, rating/grade, season record, head-to-head history, recent form, and
   (for results only) the rating delta each player got from that match.
4. **Dashboard content**: a rotating hero carousel replaces the current plain
   top-of-page text, cycling through an auto-computed "Player of the Week" and
   auto-derived recent-activity headlines — no admin authoring involved.
5. **Email confirmation**: new signups must confirm their email before they
   can use the app; the already-built password-reset flow is unaffected.

Four of these five need **no new database tables** — only the Fixtures
feature does. That's a deliberate outcome of how the brainstorming questions
were answered (real scheduling for Fixtures; everything else reads existing
data), not an assumption made going in.

## 2. Scope decisions locked in during brainstorming

### 2.1 Grade drill-down

- Only the **Grade Distribution page**'s chart is clickable — grade badges
  elsewhere (Leaderboard rows, Player Profile, Dashboard activity feed) stay
  exactly as they are today, non-interactive. Making every badge everywhere
  clickable was explicitly rejected as unnecessary scope.
- Clicking a grade navigates to a **dedicated route**, `/grades/:grade` (e.g.
  `/grades/A+`), rather than a modal — bookmarkable, has its own loading/error
  states like every other page in this app.
- The roster page reads the **currently-selected season** via the existing
  `useSeasonSelector()` hook (the same one `GradeDistribution.tsx` already
  uses) — no new season-resolution logic. Players are listed sorted by rating
  descending, each linking to `/players/:id`.

### 2.2 Fixtures (new) and Results (renamed Matches history)

- **Real scheduling, not a reuse of `is_period_closed`.** This app currently
  has no concept of "scheduled but not yet played" — a `matches` row only
  ever exists once a result is entered via `enter-match`. A new `fixtures`
  table is introduced, kept **entirely separate from `matches`** — every
  existing rating-engine, weekly-close, and statistics invariant that assumes
  a `matches` row always has real scores stays exactly true. This was an
  explicit, deliberate choice over extending `matches` with nullable
  scores/status, to avoid touching a working, heavily-tested pipeline.
- **Admin-only, manual, one fixture at a time** — no recurring/bulk
  scheduling algorithm. Same interaction shape as today's Enter Match: a form
  with a date and two players, no scores.
- **Fixture → Result workflow**: an admin opens a fixture from the Fixtures
  list and clicks "Enter Result"; this opens the existing Enter Match form
  pre-filled with that fixture's date and players. **Confirmed by reading
  `web/src/pages/admin/EnterMatch.tsx` (exports `EnterMatchPage`): it has no
  pre-fill capability
  today** — it's a fully self-contained form (local `useState` for date and
  both player selects, no props, no route params). This spec requires a
  real modification to that page: it must accept an optional fixture
  reference (e.g. a `fixtureId` route/query param), look up that fixture,
  pre-populate the date and both player selects from it, and pass
  `fixture_id` through to the `enter-match` call — not a zero-change reuse.
  On successful submission, the fixture's `status` becomes `'completed'` and
  it records which `matches` row resulted from it — **atomically**, by
  extending the existing `enter-match` Edge Function's transaction to
  optionally accept a `fixture_id` (validates the fixture is still
  `'scheduled'` and its players match the submitted ones, inserts the match
  row exactly as it does today, then updates the fixture in the same
  transaction). This is the same transactional-write pattern this codebase
  already requires for every write Edge Function
  (`supabase/functions/_shared/dbTransaction.ts`) — a two-step client-side
  "create match, then separately mark fixture complete" was rejected because
  it can leave a fixture stuck `'scheduled'` if the second step fails.
  **`EnterMatchPage`'s existing success handler already invalidates six
  query keys** (leaderboard, gradeDistribution, matchHistory, two
  playerProfile calls, players) — completing a fixture needs a seventh,
  `queryKeys.fixtures(seasonId)`, or the Fixtures tab won't reflect the
  completion without a manual refresh. This is exactly the class of missed
  invalidation CLAUDE.md calls out as a recurring mistake in this codebase —
  flagging it here so the implementation plan doesn't repeat it.
- **Voiding**: an admin can also void a fixture (`status` → `'voided'`)
  without entering a result, for a game that gets cancelled — mirrors how
  matches can already be voided rather than deleted.
- **Overdue flagging**: a fixture whose `scheduled_date` has passed with no
  `completed_match_id` gets a visually distinct "Overdue" marker in the
  Fixtures list, so an admin notices unentered results. This is purely
  computed from `scheduled_date < today AND status = 'scheduled'` — no new
  column, no background job.
- The existing `/matches` route (`web/src/pages/MatchHistory.tsx`, today's
  played-match history) gains a small pill/tab switcher (matching this app's
  existing `SeasonPillSwitcher` visual language) between "Fixtures" and
  "Results," as **in-memory component state, no URL/query-param
  persistence** — consistent with the deliberate no-URL-persistence choice
  already made for season selection in the prior season-agnostic-redesign
  work. Still one nav item ("Matches"), not two.

### 2.3 Match comparison view

- **Two thin routes sharing one component**: `/fixtures/:id` and
  `/matches/:id`, both rendering the same `MatchComparisonCard` — chosen over
  one polymorphic route because a fixture and a completed match are
  genuinely different shapes (a fixture has no score to show), and forcing
  one route to branch internally on "do I have a result yet" was judged
  messier than two thin pages sharing the comparison component.
- **Approved via visual mockup — "Option A: stat rows"** (an EPL Match
  Centre style): each stat gets one shared row, with each player's value
  anchored to their own side of that row (a small bar/indicator between them
  for the record row), rather than two independent side-by-side profile
  cards. Chosen specifically because it makes "who's ahead on what" visible
  at a glance, which the two-card layout didn't.
- **Stats shown, both fixtures and results**: each player's photo + name,
  current rating & grade, season record (W/L, win %), head-to-head record
  between these two specific players, and recent form (last 5/10 results —
  reusing the already-tracked `player_statistics.form_5`/`form_10` fields,
  no new computation).
- **Results additionally show**: the actual score, and each player's rating
  delta from that specific match (rating-before → rating-after, from the
  existing `rating_events` table, filtered to `match_id` **and**
  `event_type = 'instant'`). Fixtures show none of this, since it doesn't
  exist yet. **Important nuance, confirmed by reading `close-week`'s own
  insert**: weekly-reconciliation rating events carry no `match_id` at all —
  they're a period-level adjustment, not tied to any one match. So this
  delta is *only* the instant Elo nudge applied the moment the result was
  entered; it will not, and is not meant to, reconcile with a player's total
  rating change across the week that match fell in (which may also include
  a later reconciliation adjustment). Worth a one-line caption in the UI
  ("Rating change from this match") so it doesn't read as the player's
  whole-week movement.
- **Head-to-head** is the one genuinely new query: matches between these two
  specific players (in either player_a/player_b order), tallied into a
  simple win count per player. No new table — this reads `matches`.

### 2.4 Dashboard content

- **No admin-authored content at all.** Both "news" and "Player of the Week"
  are fully auto-generated/auto-computed from existing data — explicitly
  chosen over an admin CMS to avoid building an entire content-authoring
  subsystem (new table, RLS, admin CRUD UI) for what turned out not to be
  needed.
- **Player of the Week**: computed by comparing a player's `rating` in the
  two most-recent `weekly_rankings.week_ending` snapshots for the current
  season and picking whoever has the largest **positive** gain. If fewer
  than two snapshots exist yet for the season (the season just started, or
  there's no active season at all — see the season-agnostic-redesign spec's
  `useSeasonInFlight()` design,
  `docs/superpowers/specs/2026-07-26-season-agnostic-redesign-design.md`),
  there's simply no Player-of-the-Week slide that
  cycle. This is a normal empty state, not an error — mirrors the
  `season: null`-is-not-an-error precedent already established for
  `useSeasonInFlight()`.
- **News headlines**: auto-derived, reusing the already-shipped
  `useRecentActivity()` hook's data (recent matches, recently-active
  players) rather than inventing a parallel data source, plus one additional
  headline type: "Season *name* is now live," reusing the already-shipped
  `useSeasonInFlight()` hook. If literally nothing is available (no active
  season, no recent matches, no recent signups, no Player of the Week), the
  carousel shows a single generic welcome slide rather than rendering empty.
- **Layout — approved via visual mockup, "Option A: full-width hero
  carousel"**: one big rotating banner at the very top of the Dashboard
  (above the existing `RecentActivityFeed`/`SeasonInFlightOverview`, both
  unchanged from the prior season-agnostic-redesign work), auto-rotating
  through Player of the Week and the news headlines as equal-weight slides
  in one shared rotation, with dot indicators. Chosen over keeping Player of
  the Week in its own permanent non-rotating spotlight card, for the
  bigger "magazine cover" feel the user asked for.
- Slide count is capped (same `FEED_LIMIT`-style convention as
  `useRecentActivity`) so the carousel can't grow unbounded.
- **No new dependency required.** Checked `web/package.json` and
  `web/src/components/ui/` — there's no carousel library or shadcn carousel
  primitive anywhere in this codebase (no embla-carousel, swiper, or
  similar). A simple interval-based auto-advance (`useState` slide index +
  `setInterval`, with the existing dot-indicator/prev-next affordance from
  the approved mockup) is sufficient and keeps this app's dependency
  footprint unchanged — do not add a carousel package for this.

### 2.5 Email confirmation

- **`enable_confirmations`** flips from `false` to `true` in
  `supabase/config.toml` (local/self-hosted dev stack) **and** in the linked
  Supabase Cloud project's own Auth settings (a project-level setting, not a
  file in this repo — done once via the Supabase dashboard or CLI against
  the live project, not part of any migration).
- **`Signup.tsx`** gains a "check your email" success state — the same
  pattern already used by `ForgotPassword.tsx`'s `sent` state — shown
  whenever `signUp()` returns no session (which is what happens once
  confirmations are required), instead of today's unconditional
  `navigate('/dashboard')`.
- **Password reset is explicitly out of scope for new work** — `ForgotPasswordPage`
  already calls the real `supabase.auth.resetPasswordForEmail()` and
  `ResetPasswordPage` already exists to complete it. This spec only confirms
  that flow keeps working once email confirmation is also required (it's
  independent of the confirmation setting), it does not change it.
- **Existing accounts are unaffected.** Every account created so far — the
  seeded admin, the demo players' owners, and the test player account added
  earlier this session — was created via the Supabase admin API with
  `email_confirm: true` set explicitly, so they're already marked confirmed
  regardless of this project-level setting. No backfill needed.
- Out of scope: a "resend confirmation email" affordance (not asked for);
  custom SMTP configuration for the Cloud project (Supabase Cloud's built-in
  email sending is fine for this app's real volume; flagged as a future
  consideration if delivery ever becomes unreliable, not scoped here).

## 3. Architecture

```
┌─────────────────────────────┐
│  supabase/migrations/…       │  (new) fixtures table: id, season_id,
│  ..._fixtures.sql             │  scheduled_date, player_a_id, player_b_id,
│                               │  status ('scheduled'|'completed'|'voided'),
│                               │  completed_match_id (nullable FK -> matches).
│                               │  RLS: readable by any authenticated user
│                               │  (matches the existing matches/seasons
│                               │  pattern), writable by admin only.
└──────────────┬──────────────┘
               │ read by
┌──────────────▼──────────────┐      ┌─────────────────────────────┐
│  useFixtures(seasonId)        │      │  useMatchResults(seasonId)    │
│  (new)                        │      │  (renamed/adjusted from       │
│                               │      │  existing useMatchHistory)    │
└──────────────┬──────────────┘      └──────────────┬──────────────┘
               │                                     │
               └───────────────┬─────────────────────┘
                                │ both consumed by
                 ┌──────────────▼──────────────┐
                 │  MatchHistory.tsx (modified)  │  pill/tab switcher between
                 │  (existing /matches route)    │  Fixtures and Results,
                 │                               │  reusing SeasonPillSwitcher's
                 │                               │  visual language
                 └──────────────┬──────────────┘
                                │ each row links to
                 ┌──────────────▼──────────────┐
                 │  /fixtures/:id, /matches/:id  │  (new routes) both render
                 │                               │  the same MatchComparisonCard
                 └──────────────┬──────────────┘
                                │ powered by
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
┌───────▼───────┐    ┌──────────▼─────────┐   ┌─────────▼─────────┐
│ useHeadToHead   │    │ existing:           │   │ existing:           │
│ (aId, bId)      │    │ player_season_      │   │ rating_events        │
│ (new)           │    │ ratings,            │   │ (results only, for    │
│                 │    │ player_statistics    │   │ the rating delta)     │
└─────────────────┘    └─────────────────────┘   └─────────────────────┘

┌─────────────────────────────┐
│  GradeDistribution.tsx        │  (modified) grade segments become links
│                               │  to /grades/:grade
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  GradeRosterPage (new)        │  /grades/:grade -- useSeasonSelector() +
│                               │  a new useGradeRoster(seasonId, grade)
│                               │  hook, sorted by rating, links to profiles
└─────────────────────────────┘

┌─────────────────────────────┐
│  usePlayerOfTheWeek()         │  (new) diffs the two most recent
│                               │  weekly_rankings.week_ending snapshots,
│                               │  picks the largest positive rating gain
└──────────────┬──────────────┘
               │ composed together with existing
               │ useRecentActivity() + useSeasonInFlight()
┌──────────────▼──────────────┐
│  HighlightsCarousel.tsx       │  (new) hero carousel, mounted at the top
│                               │  of Dashboard.tsx, above the existing
│                               │  RecentActivityFeed/SeasonInFlightOverview
└─────────────────────────────┘

┌─────────────────────────────┐
│  supabase/config.toml         │  enable_confirmations: false -> true
│  + Cloud project Auth setting │  (project-level, not a repo file)
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│  Signup.tsx (modified)        │  adds a "check your email" success state,
│                               │  mirroring ForgotPassword.tsx's `sent` state
└─────────────────────────────┘
```

**New tables:**
- `fixtures` — the only new table across all five features.

**New backend:**
- `enter-match` Edge Function extended to optionally accept `fixture_id`,
  completing a fixture atomically with inserting its match row.
- A new admin-only write path for creating/voiding a fixture. Since it's a
  single-row insert/update with no rating-engine or multi-row invariant to
  protect (unlike `start-season`'s "at most one active season" or
  `enter-match`'s player-rating updates), this does **not** need a bespoke
  transactional Edge Function — a plain RLS-gated PostgREST insert/update is
  sufficient and consistent with how simple admin-only writes are handled
  elsewhere in this app.

**New frontend files:**
- `web/src/hooks/useFixtures.ts`, `useHeadToHead.ts`, `usePlayerOfTheWeek.ts`,
  `useGradeRoster.ts` — exact signatures finalized in the implementation
  plan(s).
- `web/src/components/MatchComparisonCard.tsx`, `HighlightsCarousel.tsx`.
- `web/src/pages/admin/CreateFixture.tsx` (or folded into an existing admin
  page — implementation-plan-level call).
- `web/src/pages/FixtureDetail.tsx`, `web/src/pages/MatchDetail.tsx`,
  `web/src/pages/GradeRoster.tsx`.

**Modified files:**
- `web/src/pages/MatchHistory.tsx` (the existing `/matches` route) gains the
  Fixtures/Results sub-tab switcher.
- `web/src/pages/GradeDistribution.tsx` — grade segments become links.
- `web/src/pages/Dashboard.tsx` — mounts `HighlightsCarousel` at the top.
- `web/src/pages/Signup.tsx` — "check your email" state.
- `supabase/config.toml` — `enable_confirmations = true`.

**Left untouched, deliberately:**
- `matches`, `rating_events`, `player_season_ratings`, `player_statistics`,
  `weekly_rankings` schemas and every Edge Function's rating-engine logic —
  none of this spec's features change how ratings, grades, or season points
  are computed.
- `ForgotPassword.tsx`/`ResetPassword.tsx` — already correct, not modified.
- `RecentActivityFeed`/`SeasonInFlightOverview` (shipped in the prior
  season-agnostic-redesign plan) — reused as data sources / left mounted
  exactly where they are, just with the new carousel added above them.

## 4. Data flow

**Grade drill-down:** `GradeDistribution.tsx` (unchanged data hook,
`useGradeDistribution`) renders each grade segment as a `Link` to
`/grades/:grade`. `GradeRosterPage` resolves `selectedSeasonId` via
`useSeasonSelector()` exactly like `GradeDistribution.tsx` does today, then
calls a new `useGradeRoster(seasonId, grade)` (queries `player_season_ratings`
joined to `players`, filtered to that grade, ordered by rating descending).

**Fixtures lifecycle:** Admin creates a fixture (`status='scheduled'`) →
appears in the Fixtures list, flagged "Overdue" once `scheduled_date` passes
with no result → admin clicks "Enter Result" → the existing Enter Match form
opens pre-filled → on submit, `enter-match` runs its existing transaction
(row locks in ascending player-id order, exactly as today) plus, when a
`fixture_id` is present, validates and updates that fixture row to
`status='completed', completed_match_id=<new id>` in the same transaction. A
fixture can alternatively be voided directly (`status='voided'`) without ever
producing a match.

**Match comparison:** `/fixtures/:id` fetches the fixture row + both players'
current `player_season_ratings`/`player_statistics`; `/matches/:id` fetches
the match row (as today) + both players' current ratings/statistics + the two
`rating_events` rows for that match (for the delta). Both pages call the new
`useHeadToHead(playerAId, playerBId)` and pass everything into the same
`MatchComparisonCard`, which renders the result-only score/delta section only
when given match (not fixture) data.

**Dashboard highlights:** `HighlightsCarousel` composes three hook calls —
the new `usePlayerOfTheWeek()`, and the already-shipped `useRecentActivity()`
and `useSeasonInFlight()` — into a capped, ordered list of slides (Player of
the Week first if present, then the "season is live" slide if one is active,
then recent-match/new-signup headlines up to the cap), falling back to one
generic welcome slide if the composed list is empty.

**Email confirmation:** `Signup.tsx` calls `supabase.auth.signUp({ email,
password, options: { emailRedirectTo: `${origin}/login` } })`. When the
response has no `session` (confirmation required), the page shows the "check
your email" state instead of navigating away. `ForgotPasswordPage` and
`ResetPasswordPage` are untouched and continue to work exactly as they do
today.

## 5. Error handling

- `useGradeRoster` follows the same loading/error/empty pattern as every
  other data hook in this app (`isLoading`/`isError`/empty-array-is-valid).
- `GradeRosterPage` must handle "no seasons exist yet" the same way
  `GradeDistribution.tsx` already does today (checked: it renders "No
  seasons exist yet" when `useSeasonSelector()`'s `selectedSeasonId` is
  unset) — the new page inherits the identical empty `selectedSeasonId`
  case from the same hook and needs the same fallback, not a crash on an
  `undefined` season id.
- A fixture's `enter-match` completion re-checks the fixture is still
  `status='scheduled'` and its players still match what's being submitted
  *inside* the transaction (the same "re-check any state a lock could have
  made stale" discipline this codebase already requires) — if another admin
  already completed or voided it concurrently, the request fails with a
  clear, verbatim error rather than silently double-completing it.
- `usePlayerOfTheWeek` treats "fewer than two weekly snapshots" as a normal
  empty result (`data: null`), not an error — mirrors `useSeasonInFlight`'s
  existing `season: null` precedent. Only a genuine fetch failure sets
  `isError`.
- `HighlightsCarousel` surfaces a real fetch failure from any of its three
  composed hooks as the existing "Couldn't load…" destructive-text pattern,
  same as every other component in this app — it does not silently render
  an empty carousel on a real error (only on genuinely no data).
- Email confirmation: `signUp()` errors (invalid email, already-registered,
  weak password) surface verbatim, exactly as `Signup.tsx` already does
  today — this spec only adds the no-session "check your email" branch on
  success, it does not change error handling.

## 6. Testing

Vitest + `@testing-library/react` (frontend), following this codebase's
existing per-hook/per-component/per-page conventions; `src/db` integration
tests for the new `fixtures` table/RLS; `src/api` integration tests for the
extended `enter-match` behavior:
- `useGradeRoster`/`GradeRosterPage`: returns/renders players filtered to the
  requested grade, sorted by rating; empty grade shows an empty state, not
  an error.
- `fixtures` table (src/db): RLS allows authenticated read, admin-only
  write; the `enter-match` extension (src/api): completing a fixture updates
  both the new `matches` row and the fixture's `status`/`completed_match_id`
  atomically; re-submitting against an already-completed or voided fixture
  fails cleanly; voiding a fixture without ever entering a result works
  independently.
- Overdue flagging: a fixture with a past `scheduled_date` and
  `status='scheduled'` renders the "Overdue" marker; a fixture with a future
  date, or one already completed/voided, does not.
- `MatchComparisonCard`: renders identically-shaped stat rows for a fixture
  and a result, with the result-only score/delta section appearing only
  when match data (not fixture data) is provided.
- `useHeadToHead`: correctly tallies wins regardless of which player is
  `player_a`/`player_b` in each historical match row.
- `usePlayerOfTheWeek`: picks the correct player when there are at least two
  weekly snapshots; returns `data: null` (not an error) with fewer than two,
  including the "no active season at all" case.
- `HighlightsCarousel`: renders Player of the Week when present, omits it
  when absent; renders the "season is live" slide only when
  `useSeasonInFlight` reports an active season; falls back to the generic
  welcome slide when every composed source is empty; surfaces a real error
  from any composed hook rather than rendering silently empty.
- `Signup.tsx`: shows the "check your email" state when `signUp()` returns
  no session; still navigates to `/dashboard` in the (now rare) case a
  session is returned. **Correction from this spec's own review**: the
  existing success-path test in `Signup.test.tsx` asserts
  `signUp` was called with exactly `{ email, password }` — that assertion
  will legitimately need updating to also expect the new
  `options: { emailRedirectTo }` field, since adding it is exactly what this
  feature requires. Only the existing error-message test
  (`'shows the error message verbatim on a failed signup'`) is genuinely
  unaffected and should keep passing unmodified.
- Regression check (no test changes expected, run to confirm nothing broke):
  `ForgotPassword.tsx`/`ResetPassword.tsx`'s existing tests, and every
  existing `matches`/rating-engine test — this spec must not change any of
  that behavior.
