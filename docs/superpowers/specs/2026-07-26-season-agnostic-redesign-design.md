# Season-Agnostic Redesign — Design

Status: Approved by user, 2026-07-26

## 1. Purpose

Today `useActiveSeason()` throws if no `seasons` row has `status = 'active'`,
and every page that depends on it (`Leaderboard`, `GradeDistribution`,
`MatchHistory`, `Dashboard`) treats that as a hard failure — the user just
sees "Couldn't load..." for the entire page. In practice there's a real gap
between seasons (after one is marked `'completed'` and before the next is
started) where the app becomes fully unusable for its core pages. This spec
removes that hard dependency: browsing pages default sensibly to the most
recent season instead of erroring, `Explore` gains an optional season filter,
`Dashboard` becomes genuinely season-agnostic "what's new" content, and admins
get an at-a-glance view of whatever season is (or isn't) currently running.

## 2. Scope decisions locked in during brainstorming

- **Two different "season" concepts, resolved differently — this is the core
  architectural decision of this spec:**
  - **Browsing** (`Leaderboard`, `GradeDistribution`, `MatchHistory`,
    `Explore`'s match filter): the user wants to see *a* season's data, and
    the page should always show something sensible. A new
    `useSeasonSelector()` hook wraps the existing `useSeasons()` (already
    fetches every season, ordered by `start_date` descending) and tracks
    "which season is currently selected" as in-memory component state,
    defaulting to `seasons[0]` (the most recent one, whether `'active'` or
    `'completed'`). **No URL/query-param persistence** — refreshing resets to
    the default. This is a deliberate simplicity choice; if bookmarking a
    specific season's view ever becomes a real ask, that's a small follow-up
    (add a `?season=` param), not a reason to complicate this pass.
  - **Admin operational status** (the new season-in-flight overview): this
    specifically means "is a season currently running," so it keeps looking
    for `status === 'active'` and shows a distinct "No active season
    currently running — Start one" prompt if there isn't one, rather than
    falling back to the last completed season. Falling back here would be
    actively misleading for an admin trying to gauge current state.
- **`Leaderboard`/`GradeDistribution`/`MatchHistory`** each get a pill-style
  season switcher (‹ *Season name* [Active badge if applicable] ▾ ›)
  replacing today's plain season-name text in their banners. The chevrons
  step chronologically through `useSeasons()`'s list; the center pill opens
  the full list. Chosen over a plain `<select>` after a live mockup
  comparison, specifically for the "EFL Fantasy Premier League" game-like
  feel the user asked for. Only the *source* of the `seasonId` passed into
  `useLeaderboard`/`useGradeDistribution`/`useMatchHistory` changes — those
  hooks and their query contracts are untouched.
- **`Explore`** gets a season filter (defaulting to "All seasons") that
  narrows the **Matches** section only. The Players and Seasons sections are
  untouched — players are season-independent identities (only their
  *rating* is season-scoped, and Explore's player search doesn't show
  ratings), and the Seasons section is already an exhaustive list of every
  season.
- **`Dashboard` drops the season concept entirely.** The season-scoped cards
  that exist today — a linked player's rating/rank/season-points tiles, the
  rating history chart, `AdminDashboard`'s one-line "*name* — *status*" — move
  out. That data still lives on the full Player Profile page, completely
  unchanged. Dashboard becomes a shared "what's new" feed, the same for every
  role: the most recent matches played across *any* season, plus a short list
  of recently-active players (most recent new match or new signup) — no
  ratings, no rankings, always populated even in the gap between seasons.
  Role-specific extras are retained on top of that shared feed: an admin
  still gets the pending-claims count, the admin action shortcuts, and the
  new season-in-flight overview (below); a linked player gets a "View your
  full profile →" link instead of inline stat tiles; an unlinked account
  still gets the claim-your-profile prompt.
- **Admin season-in-flight overview** shows: season name, status, start date,
  matches played this season, active player count (players with a recorded
  rating this season), and days elapsed since `start_date`. Rendered as a row
  of stat tiles matching the existing `card-surface` tile pattern already
  used on Player Profile (`StatTile`) — visual consistency, no new component
  language invented. Lives on `AdminDashboard` (the admin's `/dashboard`
  landing view) and is reused at the top of the existing
  `/admin/start-season` page, since "here's what's currently running" is
  directly relevant context right before starting a new one.
- **Out of scope**: URL-persisted season selection (see above); changing
  what counts as `'draft'`/`'active'`/`'completed'` or the season lifecycle
  itself (`start-season`'s "at most one active season" invariant is
  untouched); adding a season selector to the full Player Profile page (it
  keeps showing "whatever the browsing-default resolves to" the same way
  Leaderboard does, just without its own switcher UI — not requested);
  any visual redesign beyond the pieces named above (the existing FPL-inspired
  gradient/palette identity, already reinforced by the light/dark mode work,
  is extended to the new components, not replaced).

## 3. Architecture

```
┌─────────────────────────────┐
│      useSeasons.ts            │   (existing, unchanged) — fetches every
│                               │   season, ordered by start_date desc
└──────────────┬──────────────┘
               │ wrapped by
┌──────────────▼──────────────┐
│   useSeasonSelector.ts        │   (new) in-memory { selectedSeasonId,
│                               │   seasons, isLoading, isError,
│                               │   selectSeason, selectPrevious,
│                               │   selectNext } — defaults selectedSeasonId
│                               │   to seasons[0].id once seasons load
└──────────────┬──────────────┘
               │ used by
┌──────────────▼──────────────┐
│  SeasonPillSwitcher.tsx       │   (new) the ‹ name [badge] ▾ › control;
│                               │   pure presentational component driven by
│                               │   useSeasonSelector()'s return value
└─────────────────────────────┘
               │ both consumed together by
┌──────────────▼──────────────┐
│ Leaderboard.tsx, GradeDistribution.tsx, MatchHistory.tsx │  (modified) —
│ replace useActiveSeason() with useSeasonSelector(), render            │
│ SeasonPillSwitcher instead of the plain banner text                   │
└────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────┐
│  useSeasonInFlight.ts         │   (new) admin-specific: looks for
│                               │   status==='active' specifically,
│                               │   returns { season: Season | null,
│                               │   matchesPlayed, activePlayerCount,
│                               │   daysElapsed, isLoading, isError } —
│                               │   season: null means "genuinely none
│                               │   active", not an error
└──────────────┬──────────────┘
               │ used by
┌──────────────▼──────────────┐
│  SeasonInFlightOverview.tsx   │   (new) renders the stat-tile row, or the
│                               │   "No active season — Start one" prompt
│                               │   when season is null. Mounted on
│                               │   AdminDashboard and StartSeasonPage.
└─────────────────────────────┘

┌─────────────────────────────┐
│  Dashboard.tsx                │   (modified) — AdminDashboard/
│                               │   LinkedPlayerDashboard/UnlinkedDashboard  │
│                               │   all drop their useActiveSeason()/       │
│                               │   seasonId dependency; a new shared       │
│                               │   RecentActivityFeed.tsx component (most  │
│                               │   recent matches + recently-active        │
│                               │   players, both season-agnostic queries)  │
│                               │   replaces the season-scoped cards        │
└─────────────────────────────┘
```

**New files:**
- `web/src/hooks/useSeasonSelector.ts` — the browsing-mode season state.
- `web/src/hooks/useSeasonInFlight.ts` — the admin operational-status hook.
- `web/src/hooks/useRecentActivity.ts` — powers the Dashboard feed (recent
  matches across any season + recently-active players).
- `web/src/components/SeasonPillSwitcher.tsx` — the pill UI.
- `web/src/components/SeasonInFlightOverview.tsx` — the admin stat-tile row
  / empty-state.
- `web/src/components/RecentActivityFeed.tsx` — the Dashboard feed UI.

**Modified files:**
- `web/src/pages/Leaderboard.tsx`, `web/src/pages/GradeDistribution.tsx`,
  `web/src/pages/MatchHistory.tsx` — swap `useActiveSeason()` for
  `useSeasonSelector()`, render `SeasonPillSwitcher`.
- `web/src/pages/Explore.tsx` — add the season filter (a plain `<select>` is
  fine here, it's a filter control among several, not the page's primary
  identity the way the pill is on Leaderboard/Grades/Matches) narrowing the
  Matches section.
- `web/src/pages/Dashboard.tsx` — all three role variants drop their season
  dependency; mount `RecentActivityFeed` (shared) and, for admins,
  `SeasonInFlightOverview`.
- `web/src/pages/admin/StartSeason.tsx` — mount `SeasonInFlightOverview` at
  the top of the existing form.
- `web/src/lib/queryKeys.ts` — add keys for the new queries (exact names in
  the implementation plan).

**Left untouched, deliberately:** `useActiveSeason.ts` itself — still used
nowhere in this spec's scope beyond needing to note it becomes dead code once
every current caller (`Leaderboard`, `GradeDistribution`, `MatchHistory`,
`Dashboard`) migrates off it; whether to delete it or leave it is an
implementation-plan-level decision, not a design one. `useLeaderboard`,
`useGradeDistribution`, `useMatchHistory`, `usePlayers`, `useAllMatches`,
`useSeasons` — all unchanged, still take/return exactly what they do today.
`start-season`, `enter-match`, `correct-match`, `close-week` Edge Functions —
completely untouched; this is a read-path/browsing spec only.

## 4. Data flow

**Browsing (Leaderboard/Grades/Matches):**
1. Page mounts → `useSeasonSelector()` → `useSeasons()` resolves → if no
   season is yet selected, default `selectedSeasonId` to `seasons[0].id`.
2. Page passes `selectedSeasonId` into its existing data hook
   (`useLeaderboard(selectedSeasonId)` etc.) exactly as it passes
   `activeSeason.data.id` today.
3. `SeasonPillSwitcher` renders the selected season's name + an `Active`
   badge only if that season's `status === 'active'`. Clicking ‹/›
   calls `selectPrevious()`/`selectNext()` (index-shift within the
   `start_date`-ordered list); clicking the pill itself opens a dropdown of
   every season (reusing the same list) calling `selectSeason(id)`.

**Explore:**
1. A local `seasonFilter: string | null` (`null` = "All seasons") in
   `ExplorePage`, driven by a `<select>` populated from `useSeasons()`.
2. The existing `matches(...)` client-side filter gains one more predicate:
   `(seasonFilter === null || m.season_id === seasonFilter)`.

**Dashboard:**
1. `useRecentActivity()` — one query for the N most recent matches (any
   season, via a query on `matches` ordered by `match_date` descending,
   independent of `useAllMatches()`'s existing full-history query — this one
   is deliberately capped/limited rather than fetching everything), one for
   the N most-recently-active players (most recent `created_at`/rating event
   as a proxy for "activity" — exact definition finalized in the
   implementation plan).
2. `RecentActivityFeed` renders both lists. Mounted identically across
   `AdminDashboard`/`LinkedPlayerDashboard`/`UnlinkedDashboard`.
3. `AdminDashboard` additionally mounts `SeasonInFlightOverview`, which runs
   its own `useSeasonInFlight()` query (looks for `status === 'active'`
   specifically; `season: null` on no match, not an error).

## 5. Error handling

- `useSeasonSelector`/`useSeasons` failing (a genuine network/RLS error, not
  "no seasons exist") still surfaces the existing "Couldn't load..." pattern
  — this spec removes the *no-active-season* error case specifically, not
  all error handling.
- `useSeasonInFlight` treats "no active season" as a normal, non-error state
  (`season: null`) — only a real fetch failure sets `isError`. This is the
  one place in the whole spec where the distinction between "empty" and
  "error" is load-bearing, since the whole point is to distinguish "nothing
  is running right now" (expected, common) from "something broke" (rare,
  needs the destructive-text treatment).
- A brand-new database with zero seasons ever created: `useSeasonSelector`'s
  `seasons` array is empty, so there's no `seasons[0]` to default to. Browsing
  pages show an explicit "No seasons exist yet" state (distinct from both the
  loading skeleton and the destructive-text error message) rather than
  crashing on `undefined.id`.

## 6. Testing

Vitest + `@testing-library/react`, following this codebase's existing
per-hook/per-component test conventions:
- `useSeasonSelector`: defaults to the most recent season once loaded;
  `selectSeason`/`selectPrevious`/`selectNext` update state correctly
  (including not stepping past either end of the list); an empty seasons
  list leaves `selectedSeasonId` unset rather than erroring.
- `useSeasonInFlight`: returns the active season's stats when one exists;
  returns `season: null` (not an error) when none does; a real fetch failure
  still sets `isError`.
- `SeasonPillSwitcher`, `SeasonInFlightOverview`, `RecentActivityFeed`:
  standard render/interaction tests per this codebase's existing component
  test patterns (mocked hooks, asserting on rendered text/roles).
- `Leaderboard`/`GradeDistribution`/`MatchHistory`: existing tests updated —
  the "no active season → error" case is replaced with a "no active season →
  still renders the most recent season's data" case.
- `Dashboard`: all three role variants' tests updated to assert the shared
  feed renders instead of the old season-scoped cards; a new case confirms
  the page renders even when `useSeasonInFlight` reports no active season.
- `Explore`: a new case for the season filter narrowing the Matches section.
