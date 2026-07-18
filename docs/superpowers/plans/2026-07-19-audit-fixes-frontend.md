# Audit Fixes: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every Important/Minor frontend finding from the 2026-07-16 production-readiness audit (`web/src/**`).

**Architecture:** No structural changes — these are targeted correctness, accessibility, and cache-consistency fixes to existing hooks/components/pages. The one recurring theme (per the audit) is cache-invalidation gaps after admin mutations; the fix is to route every query key through the central `queryKeys` registry so there's a single place that can't silently drift out of sync with what each mutation invalidates.

**Tech Stack:** React 18, TanStack Query v5, Vitest + Testing Library (existing, unchanged).

## Global Constraints

- Every hook's query key must come from `web/src/lib/queryKeys.ts` — no inline `['literal', ...]` arrays in hooks or invalidation call sites. This is both a fix (two hooks currently bypass it) and a guard against the exact bug class the audit flagged twice.
- Existing tests must keep passing unmodified unless the fix specifically requires changing what a test asserts (and if so, say why in the commit).
- This app's own principle (established in earlier phases): show real error messages, don't swallow or generalize them. Preserve that in any error-state changes.

---

### Task 1: Query-key registry consolidation and cache-invalidation fixes

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/src/hooks/usePlayers.ts`
- Modify: `web/src/hooks/useIsAdmin.ts`
- Modify: `web/src/pages/admin/CloseWeek.tsx`
- Modify: `web/src/pages/admin/CorrectMatch.tsx`
- Modify: `web/src/pages/admin/EnterMatch.tsx`
- Modify (if they assert exact invalidated keys): `web/src/pages/admin/CloseWeek.test.tsx`, `web/src/pages/admin/CorrectMatch.test.tsx`, `web/src/pages/admin/EnterMatch.test.tsx`

**Interfaces:**
- Produces: `queryKeys.players(seasonId: string)` and `queryKeys.isAdmin(userId: string)`, added alongside the existing entries in `queryKeys.ts`.

- [ ] **Step 1: Add the two missing keys to the registry**

  ```ts
  // web/src/lib/queryKeys.ts
  export const queryKeys = {
    leaderboard: (seasonId: string) => ['leaderboard', seasonId] as const,
    gradeDistribution: (seasonId: string) => ['gradeDistribution', seasonId] as const,
    playerProfile: (playerId: string, seasonId: string) => ['playerProfile', playerId, seasonId] as const,
    matchHistory: (seasonId: string) => ['matchHistory', seasonId] as const,
    openMatches: (seasonId: string) => ['openMatches', seasonId] as const,
    seasons: () => ['seasons'] as const,
    activeSeason: () => ['activeSeason'] as const,
    players: (seasonId: string) => ['players', seasonId] as const,
    isAdmin: (userId: string) => ['isAdmin', userId] as const,
  };
  ```

- [ ] **Step 2: Update the two hooks that currently bypass the registry**

  In `web/src/hooks/usePlayers.ts`, change:
  ```ts
  queryKey: ['players', seasonId ?? ''],
  ```
  to:
  ```ts
  queryKey: queryKeys.players(seasonId ?? ''),
  ```
  (add `import { queryKeys } from '@/lib/queryKeys';` at the top).

  In `web/src/hooks/useIsAdmin.ts`, change:
  ```ts
  queryKey: ['isAdmin', userId ?? ''],
  ```
  to:
  ```ts
  queryKey: queryKeys.isAdmin(userId ?? ''),
  ```
  (add the same import).

- [ ] **Step 3: Fix `EnterMatch.tsx`'s hand-written literal**

  Change:
  ```ts
  queryClient.invalidateQueries({ queryKey: ['players', activeSeason.data.id] });
  ```
  to:
  ```ts
  queryClient.invalidateQueries({ queryKey: queryKeys.players(activeSeason.data.id) });
  ```

- [ ] **Step 4: Fix `CloseWeek.tsx`'s cache invalidation gaps**

  The audit found that closing a week reconciles every affected player's rating/grade via Glicko-2, but the page never invalidates `playerProfile` (a profile page open at close time, or in another tab, shows stale data) or `players` (the odds widget on the Enter Match page shows stale ratings after a close). Fix: add both, invalidating the whole `playerProfile` key prefix (not per-player — every reconciled player's profile needs a refresh, not just specific ones) so a partial-match invalidation catches every player regardless of who was involved:

  ```ts
  const seasonId = activeSeason.data.id;
  queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(seasonId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.players(seasonId) });
  queryClient.invalidateQueries({ queryKey: ['playerProfile'] });
  ```
  (`['playerProfile']` is a deliberate partial key — TanStack Query invalidates every query whose key starts with this prefix, i.e. every player's profile for every season, which is correct here since close-week doesn't tell the client which specific players were reconciled.)

  Also fix the wording bug the audit noted in the same file: the confirm dialog and helper text say "This will close **N** match(es)" using a client-side estimate that can disagree with the server's actual count, and the button/heading implies "this week" specifically when the endpoint actually closes every open match on or before the chosen date. Reword the helper text under the date input to: `"This will close every open match on or before this date."` and drop the specific pre-computed count from that sentence (the `result` block after a successful close already shows the server's real count — that's the trustworthy number, leave it as-is).

- [ ] **Step 5: Fix `CorrectMatch.tsx`'s cache invalidation gaps**

  The audit found a correction only invalidates the two players directly in the corrected match, but a correction replays every later match in the open week too, which can change third-party opponents' stats. Replace the two specific `playerProfile` invalidations with the same whole-prefix invalidation as Step 4, and add the missing `players` invalidation:

  ```ts
  if (activeSeason.data) {
    const seasonId = activeSeason.data.id;
    queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.players(seasonId) });
    queryClient.invalidateQueries({ queryKey: ['playerProfile'] });
  }
  ```

- [ ] **Step 6: Check the three admin page test files for assertions on exact invalidated keys**

  If `CloseWeek.test.ts(x)`/`CorrectMatch.test.ts(x)`/`EnterMatch.test.ts(x)` assert on a query client's invalidated-keys list, update those assertions to match the new invalidation sets above. If they don't (e.g. they only assert on rendered UI/toast text), no change needed.

- [ ] **Step 7: Run the frontend test suite**

  ```bash
  cd web && npm test
  ```
  Expected: all tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/lib/queryKeys.ts web/src/hooks/usePlayers.ts web/src/hooks/useIsAdmin.ts web/src/pages/admin/CloseWeek.tsx web/src/pages/admin/CorrectMatch.tsx web/src/pages/admin/EnterMatch.tsx
  git commit -m "fix: consolidate query keys into the central registry and close cache-invalidation gaps"
  ```

---

### Task 2: `usePlayerProfile` — fix `.single()` crash and unsafe filter interpolation

**Files:**
- Modify: `web/src/hooks/usePlayerProfile.ts`
- Modify: `web/src/pages/PlayerProfile.tsx`
- Modify: `web/src/pages/PlayerProfile.test.tsx`

**Interfaces:**
- Produces: `PlayerProfileData.seasonRating` becomes `PlayerSeasonRating | null` (was `PlayerSeasonRating`) — `PlayerProfile.tsx` is the only consumer and is fixed in this same task.

- [ ] **Step 1: Fix the `.single()` crash for a player with no rating row yet**

  `player_season_ratings` is queried with `.single()`, which throws `PGRST116` on zero rows — this breaks the profile page entirely for any player who hasn't played yet this season (a fresh-start season, or a player added mid-season before their first match). Change to `.maybeSingle()` and update the return type/value:

  ```ts
  export interface PlayerProfileData {
    player: PlayerSummary;
    seasonRating: PlayerSeasonRating | null;
    statistics: PlayerStatistics | null;
    ratingEvents: RatingEvent[];
    matches: MatchRow[];
  }
  ```
  ```ts
  supabase
    .from('player_season_ratings')
    .select('*')
    .eq('player_id', playerId as string)
    .eq('season_id', seasonId as string)
    .maybeSingle(),
  ```
  and drop the `if (ratingRes.error) throw ratingRes.error;` guard's assumption of a row existing — `maybeSingle()` only errors on a real query error, not on zero rows, so the existing `if (ratingRes.error) throw ratingRes.error;` line is unchanged; only `.single()` → `.maybeSingle()` and `ratingRes.data as PlayerSeasonRating` → `ratingRes.data as PlayerSeasonRating | null` need to change.

- [ ] **Step 2: Validate `playerId` before interpolating it into the `.or()` filter string**

  ```ts
  supabase
    .from('matches')
    .select('*, player_a:player_a_id(id, full_name), player_b:player_b_id(id, full_name)')
    .eq('season_id', seasonId as string)
    .eq('is_voided', false)
    .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
  ```
  builds a PostgREST filter string by direct interpolation. Since `matches` is public-read anyway, the worst case today is a malformed-filter 400, not a cross-table leak — but it's the one query in this file not using a parameterized `.eq(...)`. Add a UUID format guard at the top of the hook (mirroring the shape check already used on the backend in `supabase/functions/_shared/validation.ts`, but this is a standalone frontend copy — don't import across the Deno/Node boundary):

  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  ```
  at the top of `usePlayerProfile.ts`, and change the hook's `enabled` condition to also require it:
  ```ts
  enabled: playerId !== undefined && seasonId !== undefined && UUID_RE.test(playerId),
  ```
  This means a malformed `playerId` (e.g. a stray route segment) simply never fires the query instead of reaching the interpolated filter string.

- [ ] **Step 3: Update `PlayerProfile.tsx` to handle `seasonRating === null`**

  Currently `seasonRating.grade`/`.rating`/`.season_points` are read unconditionally, which would now throw if `seasonRating` is `null`. Change the destructuring and the three places that read it:

  ```tsx
  const { player, seasonRating, statistics, ratingEvents, matches } = profile.data;
  const chartPoints = toRatingHistoryPoints(ratingEvents);
  const recentMatches = toPlayerProfileMatches(player.id, matches, ratingEvents);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{player.full_name}</h1>
          <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
        </div>
        {seasonRating && <GradeBadge grade={seasonRating.grade} />}
      </div>

      {!seasonRating && (
        <p className="text-muted-foreground mb-6 text-sm">No rating yet this season — check back after their first match.</p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Rating</p>
          <p className="text-lg font-bold">{seasonRating?.rating ?? '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Win %</p>
          <p className="text-lg font-bold">{statistics ? `${statistics.win_pct}%` : '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Streak</p>
          <p className="text-lg font-bold">{statistics ? streakLabel(statistics.current_streak) : '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Form</p>
          <p className="text-lg font-bold">{statistics?.form_score ?? '—'}</p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Season Pts</p>
          <p className="text-lg font-bold">{seasonRating?.season_points ?? '—'}</p>
        </div>
      </div>
      {/* ...rest of the component (rating history, recent matches) is unchanged... */}
  ```
  Only the grade badge, the "no rating yet" note, and the Rating/Season Pts cells change; everything below (rating history chart, recent matches table) already tolerates empty data (`chartPoints`/`recentMatches` are already derived from `ratingEvents`/`matches`, which are `[]`, not `null`, for a player with no matches — unaffected by this change).

- [ ] **Step 4: Add a regression test to `PlayerProfile.test.tsx`**

  Keep the existing test unmodified. Add:
  ```tsx
  it('shows an empty-state instead of crashing when the player has no rating row yet', () => {
    vi.doMock('@/hooks/usePlayerProfile', () => ({
      usePlayerProfile: () => ({
        data: {
          player: { id: 'p2', full_name: 'Fresh Player' },
          seasonRating: null,
          statistics: null,
          ratingEvents: [],
          matches: [],
        },
        isLoading: false,
        isError: false,
      }),
    }));
    // Re-import after doMock so this test gets the overridden mock; vi.doMock
    // is not hoisted like vi.mock, so it must run before the import it affects.
  });
  ```
  Note: since the file already uses a static top-level `vi.mock('@/hooks/usePlayerProfile', ...)` for the existing test, adding a *second* differently-mocked test in the same file requires either (a) restructuring the existing top-level `vi.mock` into a `vi.fn()` you reassign per-test, or (b) two separate test files. Prefer (a) — it's a small, self-contained change:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { MemoryRouter, Route, Routes } from 'react-router-dom';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

  const usePlayerProfileMock = vi.fn();
  vi.mock('@/hooks/useActiveSeason', () => ({
    useActiveSeason: () => ({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      isLoading: false,
      isError: false,
    }),
  }));
  vi.mock('@/hooks/usePlayerProfile', () => ({
    usePlayerProfile: (...args: unknown[]) => usePlayerProfileMock(...args),
  }));

  import { PlayerProfilePage } from './PlayerProfile';

  function renderPage() {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/players/p1']}>
          <Routes>
            <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  describe('PlayerProfilePage', () => {
    it('renders the player name, grade, and stat cards', () => {
      usePlayerProfileMock.mockReturnValue({
        data: {
          player: { id: 'p1', full_name: 'Alex Testplayer' },
          seasonRating: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
          statistics: { id: 'st1', player_id: 'p1', season_id: 's1', wins: 4, losses: 1, win_pct: 80, current_streak: 3, longest_streak: 3, frames_won: 20, frames_lost: 8, avg_opponent_rating: 1500, form_5: 80, form_10: 80, form_score: 82 },
          ratingEvents: [],
          matches: [],
        },
        isLoading: false,
        isError: false,
      });
      renderPage();
      expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
      expect(screen.getByText('A+')).toBeInTheDocument();
      expect(screen.getByText('1768')).toBeInTheDocument();
      expect(screen.getByText('80%')).toBeInTheDocument();
      expect(screen.getByText('W3')).toBeInTheDocument();
      expect(screen.getByText('142')).toBeInTheDocument();
    });

    it('shows an empty-state instead of crashing when the player has no rating row yet', () => {
      usePlayerProfileMock.mockReturnValue({
        data: {
          player: { id: 'p2', full_name: 'Fresh Player' },
          seasonRating: null,
          statistics: null,
          ratingEvents: [],
          matches: [],
        },
        isLoading: false,
        isError: false,
      });
      renderPage();
      expect(screen.getByText('Fresh Player')).toBeInTheDocument();
      expect(screen.getByText(/no rating yet this season/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 5: Run the tests**

  ```bash
  cd web && npx vitest run src/pages/PlayerProfile.test.tsx src/hooks
  ```
  Expected: both tests in `PlayerProfile.test.tsx` pass.

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/hooks/usePlayerProfile.ts web/src/pages/PlayerProfile.tsx web/src/pages/PlayerProfile.test.tsx
  git commit -m "fix: usePlayerProfile no longer crashes for a player with no rating row yet"
  ```

---

### Task 3: Accessibility and visual fixes — grade badge contrast, rating chart, lazy-loading

**Files:**
- Modify: `web/src/components/GradeBadge.tsx`
- Modify: `web/src/components/GradeBadge.test.tsx` (if it asserts specific class names)
- Modify: `web/src/components/RatingChart.tsx`
- Modify: `web/src/pages/PlayerProfile.tsx`

- [ ] **Step 1: Fix grade badge contrast**

  White text on `bg-yellow-500` (B), `bg-lime-600` (B+), and `bg-orange-500` (C+) measures well below the 4.5:1 WCAG AA minimum for small text. Switch those three to dark text; leave the other four (already dark enough backgrounds) with white text:

  ```tsx
  const GRADE_COLORS: Record<Grade, string> = {
    'A+': 'bg-green-700 text-white',
    A: 'bg-green-600 text-white',
    'B+': 'bg-lime-600 text-black',
    B: 'bg-yellow-500 text-black',
    'C+': 'bg-orange-500 text-black',
    C: 'bg-orange-700 text-white',
    D: 'bg-red-700 text-white',
  };

  export function GradeBadge({ grade }: { grade: Grade }) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold',
          GRADE_COLORS[grade],
        )}
      >
        {grade}
      </span>
    );
  }
  ```
  (`text-white`/`text-black` moved into the per-grade map since it now varies; the shared className string drops the hardcoded `text-white`.)

- [ ] **Step 2: Check `GradeBadge.test.tsx` for class-name assertions**

  If it asserts the exact className string, update the assertions for B/B+/C+ to expect `text-black` instead of the old shared `text-white`. If it only asserts the rendered grade text, no change needed.

- [ ] **Step 3: Add an accessible label to the rating chart**

  ```tsx
  export function RatingChart({ points }: { points: RatingHistoryPoint[] }) {
    if (points.length === 0) {
      return <p className="text-muted-foreground text-sm">No rating history yet.</p>;
    }

    return (
      <div
        data-testid="rating-chart"
        role="img"
        aria-label={`Rating history over ${points.length} data points, from ${points[0].rating} to ${points[points.length - 1].rating}`}
        style={{ width: '100%', height: 200 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis domain={['dataMin - 50', 'dataMax + 50']} />
            <Tooltip />
            <Line type="monotone" dataKey="rating" stroke="#2563eb" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  ```

- [ ] **Step 4: Lazy-load `RatingChart` in `PlayerProfile.tsx`**

  Recharts is only used by this one component, on this one page — lazy-loading it keeps it out of every other page's bundle. Change the import and wrap the usage:
  ```tsx
  import { lazy, Suspense } from 'react';
  // ...
  const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));
  ```
  and where it's rendered:
  ```tsx
  <div className="mb-6">
    <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
      <RatingChart points={chartPoints} />
    </Suspense>
  </div>
  ```
  (add `import { Skeleton } from '@/components/ui/skeleton';` if not already imported in this file — check first, it may already be imported for the loading state).

- [ ] **Step 5: Run the tests**

  ```bash
  cd web && npx vitest run src/components/GradeBadge.test.tsx src/components/RatingChart.test.tsx src/pages/PlayerProfile.test.tsx
  ```
  Expected: all pass. (`Suspense` with a lazy import resolves synchronously enough in the test environment for existing assertions to still find the chart — if `RatingChart.test.tsx` renders the component directly rather than through `PlayerProfile.tsx`, it is unaffected by the lazy-loading change entirely, since that test imports `RatingChart` directly, not lazily.)

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/components/GradeBadge.tsx web/src/components/GradeBadge.test.tsx web/src/components/RatingChart.tsx web/src/pages/PlayerProfile.tsx
  git commit -m "fix: grade badge contrast (WCAG AA), add rating chart accessible label, lazy-load recharts"
  ```

---

### Task 4: `useActiveSeason` determinism, dead ThemeProvider wiring, test timeout

**Files:**
- Modify: `web/src/hooks/useActiveSeason.ts`
- Modify: `web/src/components/ui/sonner.tsx`
- Modify: `web/package.json` (remove unused `next-themes` dependency)
- Modify: `web/vite.config.ts`

- [ ] **Step 1: Make `useActiveSeason` deterministic and give it a clear error on zero rows**

  `.single()` throws a raw `PGRST116` Postgres error if zero or more-than-one row matches — the app now enforces at most one active season at the database level (a prior backend fix), so the more-than-one case shouldn't recur, but making the query itself deterministic and the zero-row case clearly worded is cheap defense-in-depth:

  ```ts
  export function useActiveSeason() {
    return useQuery({
      queryKey: queryKeys.activeSeason(),
      queryFn: async (): Promise<Season> => {
        const { data, error } = await supabase
          .from('seasons')
          .select('*')
          .eq('status', 'active')
          .order('start_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('No active season found.');
        return data as Season;
      },
    });
  }
  ```
  The return type stays `Season` (non-null) for every existing consumer — a missing active season now surfaces through the hook's existing `isError` path with a clear message, instead of a raw Postgres error object.

- [ ] **Step 2: Remove the dead `next-themes` wiring**

  No `ThemeProvider` is mounted anywhere in the app (`web/src/main.tsx` has no such provider, and `next-themes` isn't imported anywhere except `sonner.tsx`), so `useTheme()` always resolves to its own hardcoded fallback. Remove the unused indirection and pass a fixed value directly:

  ```tsx
  // web/src/components/ui/sonner.tsx
  "use client"

  import {
    CircleCheck,
    Info,
    LoaderCircle,
    OctagonX,
    TriangleAlert,
  } from "lucide-react"
  import { Toaster as Sonner } from "sonner"

  type ToasterProps = React.ComponentProps<typeof Sonner>

  const Toaster = ({ ...props }: ToasterProps) => {
    return (
      <Sonner
        theme="system"
        className="toaster group"
        icons={{
          success: <CircleCheck className="h-4 w-4" />,
          info: <Info className="h-4 w-4" />,
          warning: <TriangleAlert className="h-4 w-4" />,
          error: <OctagonX className="h-4 w-4" />,
          loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
        }}
        toastOptions={{
          classNames: {
            toast:
              "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
            description: "group-[.toast]:text-muted-foreground",
            actionButton:
              "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
            cancelButton:
              "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          },
        }}
        {...props}
      />
    )
  }

  export { Toaster }
  ```

  Then remove the `"next-themes": "^0.4.6",` line from `web/package.json`'s `dependencies`, and run `cd web && npm install` to update `package-lock.json` (or the equivalent lockfile actually present — check which one exists first: `npm ls next-themes` before removal to confirm nothing else in `web/` depends on it, since this changes installed packages).

- [ ] **Step 3: Bump the test timeout to reduce false failures under load**

  This session's own test runs have shown 5000ms timeouts on setup-heavy tests when multiple files run concurrently under machine load — the tests themselves are correct (they pass individually), the default timeout is just tight for this environment. Raise it:

  ```ts
  // web/vite.config.ts
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    testTimeout: 15000,
  },
  ```

- [ ] **Step 4: Run the full frontend suite**

  ```bash
  cd web && npm test
  ```
  Expected: all pass.

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/hooks/useActiveSeason.ts web/src/components/ui/sonner.tsx web/package.json web/package-lock.json web/vite.config.ts
  git commit -m "fix: deterministic active-season query, remove dead ThemeProvider wiring, raise test timeout"
  ```

---

## Execution notes for the controller

- All four tasks touch disjoint files except Task 3's `PlayerProfile.tsx` (also touched by Task 2). Dispatch Task 1 and Task 4 in parallel with each other (fully independent); dispatch Task 2 before Task 3 since Task 3 edits the same file Task 2 already modified (avoids a merge/rebase between two implementers touching one file simultaneously).
- After all four tasks are reviewed and merged into this branch, run the whole-branch review before finishing, per the subagent-driven-development skill.
