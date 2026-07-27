# Dashboard Redesign + Admin Season-in-Flight Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop `Dashboard.tsx`'s hard dependency on an active season existing, replacing its season-scoped cards with a shared, always-populated "what's new" activity feed for every role, and give admins an at-a-glance "season in flight" overview (reused on the Start Season page).

**Architecture:** Two new independent hooks — `useRecentActivity()` (N most recent matches across any season + recently-active players, one merged list combining match participation and new signups) and `useSeasonInFlight()` (admin-only operational status: looks specifically for `status === 'active'`, treats "none currently running" as a normal `season: null` result, not an error) — each power one new presentational component (`RecentActivityFeed`, `SeasonInFlightOverview`). `Dashboard.tsx` is rewritten so all three role variants (`AdminDashboard`/`LinkedPlayerDashboard`/`UnlinkedDashboard`) drop `useActiveSeason()`/`seasonId` entirely and mount the shared feed; `AdminDashboard` additionally mounts the season-in-flight overview, which is also reused at the top of `admin/StartSeason.tsx`.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Supabase JS client, Vitest + `@testing-library/react`, Tailwind (existing `card-surface` utility class).

## Global Constraints

- `Dashboard.tsx`'s three role variants (`AdminDashboard`, `LinkedPlayerDashboard`, `UnlinkedDashboard`) drop the season concept entirely — no `useActiveSeason()`, no `seasonId` prop, no season-scoped rating/rank/chart cards. That data still lives, unchanged, on the full Player Profile page.
- A shared `RecentActivityFeed` (most recent matches across *any* season, plus a list of recently-active players — "most recent new match or new signup", merged into one list, most recent first) is mounted identically across all three role variants.
- The admin season-in-flight overview shows exactly: season name, status, start date, matches played this season, active player count (players with a recorded rating this season, i.e. a `player_season_ratings` row), and days elapsed since `start_date`. Rendered as `card-surface` stat tiles matching the existing `StatTile` pattern already used on `PlayerProfile.tsx` (`card-surface p-4`, label in `text-muted-foreground text-xs font-semibold uppercase tracking-wider`, value in `mt-1 text-2xl font-extrabold tabular-nums`) — no new visual language.
- `useSeasonInFlight()` looks specifically for `status === 'active'`. `season: null` (no row found) is a normal, successful result — **not** an error. Only a genuine fetch failure sets `isError`.
- `SeasonInFlightOverview` is mounted on `AdminDashboard` (the admin's `/dashboard` landing view) **and** reused at the top of the existing `admin/StartSeason.tsx` page.
- Out of scope (do not implement): URL-persisted season selection, any change to season lifecycle or Edge Functions, any visual redesign beyond the pieces named above.
- TanStack Query keys always come from `web/src/lib/queryKeys.ts` — never an inline literal key array in a hook or an `invalidateQueries` call.

---

## File Structure

**New files:**
- `web/src/hooks/useRecentActivity.ts` — recent matches (any season, capped) + recently-active players (merged matches/signups).
- `web/src/hooks/useSeasonInFlight.ts` — admin operational-status hook.
- `web/src/components/RecentActivityFeed.tsx` — renders both lists from `useRecentActivity()`.
- `web/src/components/SeasonInFlightOverview.tsx` — renders the stat-tile row or "No active season" prompt from `useSeasonInFlight()`.

**Modified files:**
- `web/src/lib/queryKeys.ts` — add `recentActivity` and `seasonInFlight` keys.
- `web/src/pages/Dashboard.tsx` — full rewrite of `AdminDashboard`/`LinkedPlayerDashboard`/`UnlinkedDashboard`/`DashboardPage`.
- `web/src/pages/Dashboard.test.tsx` — full rewrite to match.
- `web/src/pages/admin/StartSeason.tsx` — mount `SeasonInFlightOverview`, invalidate its query key on a successful start.
- `web/src/pages/admin/StartSeason.test.tsx` — mock the new hook, add a coverage case, extend the invalidation-keys test.

---

### Task 1: `useRecentActivity()` hook

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/useRecentActivity.ts`
- Test: `web/src/hooks/useRecentActivity.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (`web/src/lib/supabaseClient.ts`), `resolvePlayerPhotoUrls`/`pickResolvedUrl` (`web/src/lib/playerPhotos.ts`), `MatchRow`/`PlayerSummary` types (`web/src/lib/types.ts`).
- Produces: `useRecentActivity()` returning a TanStack Query result whose `data` is `{ recentMatches: MatchRow[]; recentPlayers: RecentActivityPlayer[] }`, where `RecentActivityPlayer = { id: string; full_name: string; photo_url?: string | null; activity: 'match' | 'signup'; activity_date: string }`. Consumed by Task 3's `RecentActivityFeed`.

- [ ] **Step 1: Add the `recentActivity` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after the existing `playerRoster` entry:

```ts
// web/src/lib/queryKeys.ts
export const queryKeys = {
  leaderboard: (seasonId: string) => ['leaderboard', seasonId] as const,
  gradeDistribution: (seasonId: string) => ['gradeDistribution', seasonId] as const,
  playerProfile: (playerId: string, seasonId: string) => ['playerProfile', playerId, seasonId] as const,
  matchHistory: (seasonId: string) => ['matchHistory', seasonId] as const,
  openMatches: (seasonId: string) => ['openMatches', seasonId] as const,
  allMatches: () => ['allMatches'] as const,
  seasons: () => ['seasons'] as const,
  activeSeason: () => ['activeSeason'] as const,
  players: (seasonId: string) => ['players', seasonId] as const,
  playerRoster: () => ['playerRoster'] as const,
  recentActivity: () => ['recentActivity'] as const,
  isAdmin: (userId: string) => ['isAdmin', userId] as const,
  userProfile: (userId: string) => ['userProfile', userId] as const,
  pendingClaims: () => ['pendingClaims'] as const,
};
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useRecentActivity.test.tsx`:

```tsx
// web/src/hooks/useRecentActivity.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMatchesLimit = vi.fn();
const mockPlayersLimit = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'matches') {
        return { select: () => ({ order: () => ({ limit: mockMatchesLimit }) }) };
      }
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: mockPlayersLimit }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { useRecentActivity } from './useRecentActivity';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useRecentActivity', () => {
  beforeEach(() => {
    mockMatchesLimit.mockReset();
    mockPlayersLimit.mockReset();
  });

  it('returns the most recent matches and merges recently-active players by whichever activity is most recent', async () => {
    mockMatchesLimit.mockResolvedValue({
      data: [
        {
          id: 'm1',
          season_id: 's1',
          match_date: '2026-07-25',
          player_a_id: 'p1',
          player_b_id: 'p2',
          frames_a: 4,
          frames_b: 2,
          winner_id: 'p1',
          is_voided: false,
          is_period_closed: false,
          player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
          player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });
    mockPlayersLimit.mockResolvedValue({
      data: [
        { id: 'p3', full_name: 'Brand New Player', photo_url: null, joined_date: '2026-07-26' },
        { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null, joined_date: '2026-01-01' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMatchesLimit).toHaveBeenCalledWith(5);
    expect(mockPlayersLimit).toHaveBeenCalledWith(5);

    expect(result.current.data?.recentMatches).toHaveLength(1);
    expect(result.current.data?.recentMatches[0].id).toBe('m1');

    const players = result.current.data?.recentPlayers ?? [];
    // p3 is the newest signup (2026-07-26); p1 only appears via the match
    // (2026-07-25); p2 appears in both, but their match date (07-25) is more
    // recent than their join date (01-01), so their entry stays 'match'.
    expect(players.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
    expect(players.find((p) => p.id === 'p3')).toMatchObject({ activity: 'signup', activity_date: '2026-07-26' });
    expect(players.find((p) => p.id === 'p1')).toMatchObject({ activity: 'match', activity_date: '2026-07-25' });
    expect(players.find((p) => p.id === 'p2')).toMatchObject({ activity: 'match', activity_date: '2026-07-25' });
  });

  it('surfaces a matches-fetch failure as an error', async () => {
    mockMatchesLimit.mockResolvedValue({ data: null, error: new Error('boom') });
    mockPlayersLimit.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('surfaces a players-fetch failure as an error', async () => {
    mockMatchesLimit.mockResolvedValue({ data: [], error: null });
    mockPlayersLimit.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useRecentActivity(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useRecentActivity.test.tsx`
Expected: FAIL — `Failed to resolve import "./useRecentActivity"` (module does not exist yet).

- [ ] **Step 4: Implement `useRecentActivity`**

Create `web/src/hooks/useRecentActivity.ts`:

```ts
// web/src/hooks/useRecentActivity.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { MatchRow } from '@/lib/types';

// Both the recent-matches list and the raw "recently joined" candidate pool
// are capped at this size, then merged and re-capped to the same size --
// see the merge step below.
const FEED_LIMIT = 5;

export interface RecentActivityPlayer {
  id: string;
  full_name: string;
  photo_url?: string | null;
  activity: 'match' | 'signup';
  activity_date: string;
}

export interface RecentActivity {
  recentMatches: MatchRow[];
  recentPlayers: RecentActivityPlayer[];
}

export function useRecentActivity() {
  return useQuery({
    queryKey: queryKeys.recentActivity(),
    queryFn: async (): Promise<RecentActivity> => {
      const [matchesRes, playersRes] = await Promise.all([
        supabase
          .from('matches')
          .select('*, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)')
          .order('match_date', { ascending: false })
          .limit(FEED_LIMIT),
        supabase
          .from('players')
          .select('id, full_name, photo_url, joined_date')
          .eq('is_active', true)
          .order('joined_date', { ascending: false })
          .limit(FEED_LIMIT),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (playersRes.error) throw playersRes.error;

      const rawMatches = matchesRes.data as unknown as MatchRow[];
      const rawPlayers = playersRes.data as {
        id: string;
        full_name: string;
        photo_url: string | null;
        joined_date: string;
      }[];

      const photoUrlByPath = await resolvePlayerPhotoUrls([
        ...rawMatches.flatMap((m) => [m.player_a.photo_url, m.player_b.photo_url]),
        ...rawPlayers.map((p) => p.photo_url),
      ]);

      const recentMatches = rawMatches.map((match) => ({
        ...match,
        player_a: { ...match.player_a, photo_url: pickResolvedUrl(photoUrlByPath, match.player_a.photo_url) },
        player_b: { ...match.player_b, photo_url: pickResolvedUrl(photoUrlByPath, match.player_b.photo_url) },
      }));

      // Merge two activity signals into one list: playing in a recent match,
      // or being a recent signup. Each player keeps whichever activity is
      // more recent; ties keep the match-derived entry.
      const candidatesById = new Map<string, RecentActivityPlayer>();
      for (const match of recentMatches) {
        for (const player of [match.player_a, match.player_b]) {
          const existing = candidatesById.get(player.id);
          if (!existing || match.match_date > existing.activity_date) {
            candidatesById.set(player.id, {
              id: player.id,
              full_name: player.full_name,
              photo_url: player.photo_url,
              activity: 'match',
              activity_date: match.match_date,
            });
          }
        }
      }
      for (const player of rawPlayers) {
        const existing = candidatesById.get(player.id);
        if (!existing || player.joined_date > existing.activity_date) {
          candidatesById.set(player.id, {
            id: player.id,
            full_name: player.full_name,
            photo_url: pickResolvedUrl(photoUrlByPath, player.photo_url),
            activity: 'signup',
            activity_date: player.joined_date,
          });
        }
      }

      const recentPlayers = [...candidatesById.values()]
        .sort((a, b) => (a.activity_date < b.activity_date ? 1 : a.activity_date > b.activity_date ? -1 : 0))
        .slice(0, FEED_LIMIT);

      return { recentMatches, recentPlayers };
    },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useRecentActivity.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useRecentActivity.ts web/src/hooks/useRecentActivity.test.tsx
git commit -m "feat: add useRecentActivity hook for the season-agnostic Dashboard feed"
```

---

### Task 2: `useSeasonInFlight()` hook

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/useSeasonInFlight.ts`
- Test: `web/src/hooks/useSeasonInFlight.test.tsx`

**Interfaces:**
- Consumes: `supabase` client, `Season` type (`web/src/lib/types.ts`).
- Produces: `useSeasonInFlight()` returning a TanStack Query result whose `data` is `SeasonInFlight = { season: Season | null; matchesPlayed: number; activePlayerCount: number; daysElapsed: number }`. `season: null` is a successful result, never `isError`. Consumed by Task 4's `SeasonInFlightOverview`.

- [ ] **Step 1: Add the `seasonInFlight` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after `recentActivity` (added in Task 1):

```ts
  recentActivity: () => ['recentActivity'] as const,
  seasonInFlight: () => ['seasonInFlight'] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useSeasonInFlight.test.tsx`:

```tsx
// web/src/hooks/useSeasonInFlight.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockSeasonMaybeSingle = vi.fn();
const mockMatchesEq = vi.fn();
const mockRatingsEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'seasons') {
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: mockSeasonMaybeSingle }) }) }),
          }),
        };
      }
      if (table === 'matches') {
        return { select: () => ({ eq: mockMatchesEq }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: mockRatingsEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { useSeasonInFlight } from './useSeasonInFlight';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSeasonInFlight', () => {
  beforeEach(() => {
    mockSeasonMaybeSingle.mockReset();
    mockMatchesEq.mockReset();
    mockRatingsEq.mockReset();
  });

  it('returns the active season with its match count, active player count, and days elapsed', async () => {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 10);
    const startDateStr = startDate.toISOString().slice(0, 10);

    mockSeasonMaybeSingle.mockResolvedValue({
      data: { id: 's1', name: 'Season 2026', start_date: startDateStr, end_date: null, status: 'active' },
      error: null,
    });
    mockMatchesEq.mockResolvedValue({ count: 12, error: null });
    mockRatingsEq.mockResolvedValue({ count: 8, error: null });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.season).toMatchObject({ id: 's1', name: 'Season 2026', status: 'active' });
    expect(result.current.data?.matchesPlayed).toBe(12);
    expect(result.current.data?.activePlayerCount).toBe(8);
    // Computed the same way the implementation does. Both run within the same
    // test process at effectively the same instant, so this isn't
    // meaningfully time-flaky (it would only mismatch if the process
    // happened to cross a UTC day boundary between these two lines).
    const expectedDays = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    expect(result.current.data?.daysElapsed).toBe(expectedDays);
  });

  it('returns season: null (not an error) when no season is currently active', async () => {
    mockSeasonMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 });
    expect(result.current.isError).toBe(false);
    expect(mockMatchesEq).not.toHaveBeenCalled();
    expect(mockRatingsEq).not.toHaveBeenCalled();
  });

  it('surfaces a real fetch failure as an error', async () => {
    mockSeasonMaybeSingle.mockResolvedValue({ data: null, error: new Error('network down') });

    const { result } = renderHook(() => useSeasonInFlight(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useSeasonInFlight.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSeasonInFlight"` (module does not exist yet).

- [ ] **Step 4: Implement `useSeasonInFlight`**

Create `web/src/hooks/useSeasonInFlight.ts`:

```ts
// web/src/hooks/useSeasonInFlight.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export interface SeasonInFlight {
  season: Season | null;
  matchesPlayed: number;
  activePlayerCount: number;
  daysElapsed: number;
}

export function useSeasonInFlight() {
  return useQuery({
    queryKey: queryKeys.seasonInFlight(),
    queryFn: async (): Promise<SeasonInFlight> => {
      const { data: seasonData, error: seasonError } = await supabase
        .from('seasons')
        .select('*')
        .eq('status', 'active')
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (seasonError) throw seasonError;

      const season = seasonData as Season | null;
      if (!season) {
        return { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 };
      }

      const [matchesRes, ratingsRes] = await Promise.all([
        supabase.from('matches').select('id', { count: 'exact', head: true }).eq('season_id', season.id),
        supabase
          .from('player_season_ratings')
          .select('player_id', { count: 'exact', head: true })
          .eq('season_id', season.id),
      ]);
      if (matchesRes.error) throw matchesRes.error;
      if (ratingsRes.error) throw ratingsRes.error;

      const daysElapsed = Math.max(
        0,
        Math.floor((Date.now() - new Date(season.start_date).getTime()) / MS_PER_DAY),
      );

      return {
        season,
        matchesPlayed: matchesRes.count ?? 0,
        activePlayerCount: ratingsRes.count ?? 0,
        daysElapsed,
      };
    },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useSeasonInFlight.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useSeasonInFlight.ts web/src/hooks/useSeasonInFlight.test.tsx
git commit -m "feat: add useSeasonInFlight hook for the admin operational-status overview"
```

---

### Task 3: `RecentActivityFeed` component

**Files:**
- Create: `web/src/components/RecentActivityFeed.tsx`
- Test: `web/src/components/RecentActivityFeed.test.tsx`

**Interfaces:**
- Consumes: `useRecentActivity()` from Task 1 (`data: { recentMatches: MatchRow[]; recentPlayers: RecentActivityPlayer[] } | undefined`, `isLoading`, `isError`), `MatchTable` (`web/src/components/MatchTable.tsx`, takes `{ matches: MatchRow[] }`, already renders its own "No matches yet." empty state), `PlayerAvatar` (`web/src/components/PlayerAvatar.tsx`, takes `{ name, photoUrl, size }`), `Skeleton` (`web/src/components/ui/skeleton.tsx`).
- Produces: `RecentActivityFeed` — a no-props component. Consumed by Task 5's `Dashboard.tsx` (mounted identically in all three role variants).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/RecentActivityFeed.test.tsx`:

```tsx
// web/src/components/RecentActivityFeed.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseRecentActivity = vi.fn();
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));

import { RecentActivityFeed } from './RecentActivityFeed';

function renderComponent() {
  return render(
    <MemoryRouter>
      <RecentActivityFeed />
    </MemoryRouter>,
  );
}

describe('RecentActivityFeed', () => {
  it('renders recent matches and recently active players', () => {
    mockUseRecentActivity.mockReturnValue({
      data: {
        recentMatches: [
          {
            id: 'm1',
            season_id: 's1',
            match_date: '2026-07-25',
            player_a_id: 'p1',
            player_b_id: 'p2',
            frames_a: 4,
            frames_b: 2,
            winner_id: 'p1',
            is_voided: false,
            is_period_closed: false,
            player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
            player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
          },
        ],
        recentPlayers: [
          {
            id: 'p3',
            full_name: 'Brand New Player',
            photo_url: null,
            activity: 'signup',
            activity_date: '2026-07-26',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Brand New Player')).toBeInTheDocument();
    expect(screen.getByText('New player')).toBeInTheDocument();
  });

  it('shows empty-state messages when there is no activity at all', () => {
    mockUseRecentActivity.mockReturnValue({
      data: { recentMatches: [], recentPlayers: [] },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('No matches yet.')).toBeInTheDocument();
    expect(screen.getByText('No player activity yet.')).toBeInTheDocument();
  });

  it('shows an error message on fetch failure', () => {
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderComponent();
    expect(screen.getByText("Couldn't load recent activity. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', () => {
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/RecentActivityFeed.test.tsx`
Expected: FAIL — `Failed to resolve import "./RecentActivityFeed"` (module does not exist yet).

- [ ] **Step 3: Implement `RecentActivityFeed`**

Create `web/src/components/RecentActivityFeed.tsx`:

```tsx
// web/src/components/RecentActivityFeed.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { MatchTable } from '@/components/MatchTable';
import { useRecentActivity } from '@/hooks/useRecentActivity';

export function RecentActivityFeed() {
  const recentActivity = useRecentActivity();

  if (recentActivity.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (recentActivity.isError) {
    return <p className="text-destructive text-sm">Couldn't load recent activity. Try refreshing.</p>;
  }

  const recentMatches = recentActivity.data?.recentMatches ?? [];
  const recentPlayers = recentActivity.data?.recentPlayers ?? [];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">Recent matches</h2>
        <MatchTable matches={recentMatches} />
      </div>
      <div>
        <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
          Recently active players
        </h2>
        {recentPlayers.length === 0 ? (
          <p className="text-muted-foreground text-sm">No player activity yet.</p>
        ) : (
          <ul className="card-surface overflow-hidden">
            {recentPlayers.map((player) => (
              <li
                key={player.id}
                className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
              >
                <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                <span className="flex-1 font-semibold">{player.full_name}</span>
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  {player.activity === 'signup' ? 'New player' : 'Recent match'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/RecentActivityFeed.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RecentActivityFeed.tsx web/src/components/RecentActivityFeed.test.tsx
git commit -m "feat: add RecentActivityFeed component for the Dashboard"
```

---

### Task 4: `SeasonInFlightOverview` component

**Files:**
- Create: `web/src/components/SeasonInFlightOverview.tsx`
- Test: `web/src/components/SeasonInFlightOverview.test.tsx`

**Interfaces:**
- Consumes: `useSeasonInFlight()` from Task 2 (`data: SeasonInFlight | undefined`, `isLoading`, `isError`).
- Produces: `SeasonInFlightOverview` — a no-props component. Consumed by Task 5's `Dashboard.tsx` (`AdminDashboard` only) and Task 6's `admin/StartSeason.tsx`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/SeasonInFlightOverview.test.tsx`:

```tsx
// web/src/components/SeasonInFlightOverview.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseSeasonInFlight = vi.fn();
vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));

import { SeasonInFlightOverview } from './SeasonInFlightOverview';

function renderComponent() {
  return render(
    <MemoryRouter>
      <SeasonInFlightOverview />
    </MemoryRouter>,
  );
}

describe('SeasonInFlightOverview', () => {
  it('shows the season stat tiles when a season is active', () => {
    mockUseSeasonInFlight.mockReturnValue({
      data: {
        season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
        matchesPlayed: 12,
        activePlayerCount: 8,
        daysElapsed: 30,
      },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows a "Start Season" prompt when there is no active season', () => {
    mockUseSeasonInFlight.mockReturnValue({
      data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
      isLoading: false,
      isError: false,
    });
    renderComponent();
    expect(screen.getByText('No active season')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Season/ })).toHaveAttribute('href', '/admin/start-season');
  });

  it('shows an error message on fetch failure', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderComponent();
    expect(screen.getByText("Couldn't load season status. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a loading skeleton while fetching', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/SeasonInFlightOverview.test.tsx`
Expected: FAIL — `Failed to resolve import "./SeasonInFlightOverview"` (module does not exist yet).

- [ ] **Step 3: Implement `SeasonInFlightOverview`**

Create `web/src/components/SeasonInFlightOverview.tsx`:

```tsx
// web/src/components/SeasonInFlightOverview.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useSeasonInFlight } from '@/hooks/useSeasonInFlight';

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card-surface p-4">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

export function SeasonInFlightOverview() {
  const seasonInFlight = useSeasonInFlight();

  if (seasonInFlight.isLoading) {
    return <Skeleton className="mb-6 h-24 w-full rounded-xl" />;
  }

  if (seasonInFlight.isError) {
    return <p className="text-destructive mb-6 text-sm">Couldn't load season status. Try refreshing.</p>;
  }

  const data = seasonInFlight.data;
  if (!data || !data.season) {
    return (
      <div className="card-surface mb-6 p-6">
        <h2 className="mb-2 text-lg font-bold">No active season</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          No season is currently running. Start one to begin recording matches.
        </p>
        <Link to="/admin/start-season" className="text-primary text-sm font-semibold hover:underline">
          Start Season →
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-lg font-bold">{data.season.name}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Status" value={data.season.status} />
        <StatTile label="Start date" value={data.season.start_date} />
        <StatTile label="Days elapsed" value={data.daysElapsed} />
        <StatTile label="Matches played" value={data.matchesPlayed} />
        <StatTile label="Active players" value={data.activePlayerCount} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/SeasonInFlightOverview.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SeasonInFlightOverview.tsx web/src/components/SeasonInFlightOverview.test.tsx
git commit -m "feat: add SeasonInFlightOverview component for admin operational status"
```

---

### Task 5: Rewrite `Dashboard.tsx`

**Files:**
- Modify: `web/src/pages/Dashboard.tsx` (full rewrite)
- Modify: `web/src/pages/Dashboard.test.tsx` (full rewrite)

**Interfaces:**
- Consumes: `RecentActivityFeed` (Task 3), `SeasonInFlightOverview` (Task 4), existing `useAuth`, `useIsAdmin`, `useUserProfile`, `usePendingClaims` hooks (all unchanged), `PlayerClaim` type.
- Produces: `DashboardPage` — unchanged export name and no-props signature, now with no season dependency at all.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/Dashboard.test.tsx`:

```tsx
// web/src/pages/Dashboard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseUserProfile = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockUseRecentActivity = vi.fn();
const mockUseSeasonInFlight = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));
vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));

import { DashboardPage } from './Dashboard';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseRecentActivity.mockReturnValue({
      data: { recentMatches: [], recentPlayers: [] },
      isLoading: false,
      isError: false,
    });
    mockUseSeasonInFlight.mockReturnValue({
      data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
      isLoading: false,
      isError: false,
    });
  });

  it('shows the admin panel, the season-in-flight overview, and the shared activity feed for an admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [{ id: 'c1' }], isLoading: false, isError: false });
    mockUseSeasonInFlight.mockReturnValue({
      data: {
        season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
        matchesPlayed: 12,
        activePlayerCount: 8,
        daysElapsed: 30,
      },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Enter Match' })).toHaveAttribute('href', '/admin/enter-match');
  });

  it('shows an error message when pending claims fail to load in the admin panel', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderDashboard();
    expect(screen.getByText(/couldn't load pending claims/i)).toBeInTheDocument();
  });

  it("shows the admin's 'no active season' prompt when no season is currently running (regression: the whole Dashboard no longer hard-fails on this)", () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('No active season')).toBeInTheDocument();
  });

  it('shows the player panel with a link to the full profile for a linked, non-admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: 'p1', pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view your full profile/i })).toHaveAttribute('href', '/players/p1');
  });

  it('shows the claim CTA for an unlinked account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to settings/i })).toHaveAttribute('href', '/settings');
  });

  it('shows a pending-review message for an unlinked account with an outstanding claim', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });

  it('renders the shared recent-activity feed for a non-admin account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUseRecentActivity.mockReturnValue({
      data: {
        recentMatches: [],
        recentPlayers: [
          { id: 'p9', full_name: 'Sam Newcomer', photo_url: null, activity: 'signup', activity_date: '2026-07-26' },
        ],
      },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByText('Sam Newcomer')).toBeInTheDocument();
  });

  it('shows a loading skeleton while auth/admin/profile are resolving', () => {
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseUserProfile.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePendingClaims.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { container } = renderDashboard();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it("shows an error message when the user's profile fails to load", () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderDashboard();
    expect(screen.getByText(/couldn't load your dashboard/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/Dashboard.test.tsx`
Expected: FAIL — the current `Dashboard.tsx` still requires `seasonId`/`useActiveSeason`, several `getByText`/`getByRole` assertions above (e.g. `'Admin Dashboard'` heading rendering without season text, `'Welcome back'`, `SeasonInFlightOverview`'s `'No active season'`) will not match the old markup, and `useActiveSeason`/`useLeaderboard`/`useMatchHistory`/`usePlayerProfile` are not mocked so those hooks will hit the real (unmocked) `supabase` client and throw.

- [ ] **Step 3: Rewrite `Dashboard.tsx`**

Replace the full contents of `web/src/pages/Dashboard.tsx`:

```tsx
// web/src/pages/Dashboard.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { RecentActivityFeed } from '@/components/RecentActivityFeed';
import { SeasonInFlightOverview } from '@/components/SeasonInFlightOverview';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';
import { useUserProfile } from '@/hooks/useUserProfile';
import { usePendingClaims } from '@/hooks/usePendingClaims';
import type { PlayerClaim } from '@/lib/types';

const ADMIN_ACTIONS = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
  { to: '/admin/players', label: 'Players' },
];

function AdminDashboard() {
  const pendingClaims = usePendingClaims();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Admin Dashboard</h1>
      <p className="text-muted-foreground mb-6 text-sm">League operations at a glance.</p>
      <SeasonInFlightOverview />
      {pendingClaims.isLoading ? (
        <Skeleton className="mb-6 h-[72px] w-full rounded-xl" />
      ) : pendingClaims.isError ? (
        <p className="text-destructive mb-6 text-sm">Couldn't load pending claims. Try refreshing.</p>
      ) : (
        <Link to="/admin/players" className="card-surface mb-6 block p-4 hover:border-accent">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Pending claims</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums">{pendingClaims.data?.length ?? 0}</p>
        </Link>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {ADMIN_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="card-surface p-4 text-center text-sm font-semibold hover:border-accent"
          >
            {action.label}
          </Link>
        ))}
      </div>
      <RecentActivityFeed />
    </div>
  );
}

function LinkedPlayerDashboard({ playerId }: { playerId: string }) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Welcome back</h1>
      <Link
        to={`/players/${playerId}`}
        className="card-surface mb-6 block p-4 text-sm font-semibold hover:border-accent"
      >
        View your full profile →
      </Link>
      <RecentActivityFeed />
    </div>
  );
}

function UnlinkedDashboard({ pendingClaim }: { pendingClaim: PlayerClaim | null }) {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Welcome</h1>
      {pendingClaim ? (
        <p className="text-muted-foreground mb-6 text-sm">Your player claim is pending review by an admin.</p>
      ) : (
        <div className="card-surface mb-6 p-6">
          <h2 className="mb-2 text-lg font-bold">Claim your player profile</h2>
          <p className="text-muted-foreground mb-4 text-sm">
            If you're a league player, link your account to see your own rating, rank, and match history here.
          </p>
          <Link to="/settings" className="text-primary text-sm font-semibold hover:underline">
            Go to Settings →
          </Link>
        </div>
      )}
      <RecentActivityFeed />
    </div>
  );
}

export function DashboardPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);

  if (isAdmin.isLoading || userProfile.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError) {
    return <p className="text-destructive">Couldn't load your dashboard. Try refreshing.</p>;
  }

  if (isAdmin.data === true) {
    return <AdminDashboard />;
  }
  if (userProfile.data?.linkedPlayerId) {
    return <LinkedPlayerDashboard playerId={userProfile.data.linkedPlayerId} />;
  }
  return <UnlinkedDashboard pendingClaim={userProfile.data?.pendingClaim ?? null} />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/Dashboard.test.tsx`
Expected: PASS (9/9 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.tsx web/src/pages/Dashboard.test.tsx
git commit -m "feat: drop the season dependency from Dashboard, add shared activity feed"
```

---

### Task 6: Mount `SeasonInFlightOverview` on `admin/StartSeason.tsx`, final checks

**Files:**
- Modify: `web/src/pages/admin/StartSeason.tsx`
- Modify: `web/src/pages/admin/StartSeason.test.tsx`

**Interfaces:**
- Consumes: `SeasonInFlightOverview` (Task 4), existing `useSeasons`, `startSeason`, `queryKeys` (now including `seasonInFlight` from Task 2).
- Produces: no new exports — `StartSeasonPage`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Replace the full contents of `web/src/pages/admin/StartSeason.test.tsx`:

```tsx
// web/src/pages/admin/StartSeason.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useSeasons', () => ({
  useSeasons: () => ({
    data: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useSeasonInFlight', () => ({
  useSeasonInFlight: () => ({
    data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
    isLoading: false,
    isError: false,
  }),
}));

const mockStartSeason = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ startSeason: (body: unknown) => mockStartSeason(body) }));

import { StartSeasonPage } from './StartSeason';

function renderPage() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <StartSeasonPage />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

describe('StartSeasonPage', () => {
  beforeEach(() => {
    mockStartSeason.mockReset();
    mockToastSuccess.mockReset();
  });

  it('lists existing seasons in the carry-over picker', () => {
    renderPage();
    expect(screen.getByRole('option', { name: 'Season 2026' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None (fresh start)' })).toBeInTheDocument();
  });

  it('shows the season-in-flight overview above the form', () => {
    renderPage();
    expect(screen.getByText('No active season')).toBeInTheDocument();
  });

  it('omits previous_season_id when "None" is selected, and confirms before submitting', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    expect(mockStartSeason).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(mockStartSeason).toHaveBeenCalledWith(
        expect.objectContaining({ new_season_name: 'Season 2027', previous_season_id: undefined }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.');
  });

  it('invalidates seasons, activeSeason, and seasonInFlight caches after a successful start, with exact keys', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    const { invalidateSpy } = renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.'));

    // Regression coverage per the Task 14/15/16 lesson: assert the exact query keys via the real
    // queryKeys builder (not hand-typed arrays), and the exact call count/order, so this test
    // fails if an invalidation is dropped, duplicated, reordered, or its key drifts.
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenNthCalledWith(1, { queryKey: queryKeys.seasons() });
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, { queryKey: queryKeys.activeSeason() });
    expect(invalidateSpy).toHaveBeenNthCalledWith(3, { queryKey: queryKeys.seasonInFlight() });
  });

  it('resets the form fields after a successful start', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.selectOptions(screen.getByLabelText('Carry over ratings from'), 'Season 2026');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Season "Season 2027" created.'));

    expect(screen.getByLabelText('New season name')).toHaveValue('');
    expect(screen.getByLabelText('Carry over ratings from')).toHaveValue('');
  });

  it('includes previous_season_id when a carry-over season is selected', async () => {
    mockStartSeason.mockResolvedValue({ season_id: 's2' });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.selectOptions(screen.getByLabelText('Carry over ratings from'), 'Season 2026');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(mockStartSeason).toHaveBeenCalledWith(
        expect.objectContaining({ new_season_name: 'Season 2027', previous_season_id: 's1' }),
      ),
    );
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockStartSeason.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText('New season name'), 'Season 2027');
    await user.click(screen.getByRole('button', { name: 'Start Season' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Start Season' }));

    await waitFor(() =>
      expect(screen.getByText('duplicate key value violates unique constraint')).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/StartSeason.test.tsx`
Expected: FAIL — `useSeasonInFlight` is not imported by the current page (the mock is simply unused so far), the `'shows the season-in-flight overview above the form'` case fails since nothing renders `'No active season'` yet, and the invalidation-count test fails (currently invalidates 2 keys, not 3).

- [ ] **Step 3: Update `StartSeason.tsx`**

Edit `web/src/pages/admin/StartSeason.tsx` — add the import and mount the overview, and add the third invalidation call:

```tsx
// web/src/pages/admin/StartSeason.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SeasonInFlightOverview } from '@/components/SeasonInFlightOverview';
import { useSeasons } from '@/hooks/useSeasons';
import { startSeason } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function StartSeasonPage() {
  const queryClient = useQueryClient();
  const seasons = useSeasons();

  const [newSeasonName, setNewSeasonName] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [previousSeasonId, setPreviousSeasonId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleConfirm() {
    setError(null);
    if (!newSeasonName.trim()) {
      setError('Season name is required.');
      return;
    }

    setIsSubmitting(true);
    try {
      await startSeason({
        new_season_name: newSeasonName,
        start_date: startDate,
        previous_season_id: previousSeasonId || undefined,
      });
      toast.success(`Season "${newSeasonName}" created.`);
      queryClient.invalidateQueries({ queryKey: queryKeys.seasons() });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeSeason() });
      queryClient.invalidateQueries({ queryKey: queryKeys.seasonInFlight() });
      setNewSeasonName('');
      setPreviousSeasonId('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to start season.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (seasons.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (seasons.isError) {
    return <p className="text-destructive">Couldn't load seasons. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Start Season</h1>
      <SeasonInFlightOverview />
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="newSeasonName">New season name</Label>
          <Input
            id="newSeasonName"
            value={newSeasonName}
            onChange={(e) => setNewSeasonName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="previousSeason">Carry over ratings from</Label>
          <select
            id="previousSeason"
            value={previousSeasonId}
            onChange={(e) => setPreviousSeasonId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">None (fresh start)</option>
            {seasons.data?.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <ConfirmDialog
          trigger={
            <Button type="button" disabled={isSubmitting || !newSeasonName.trim()}>
              Start Season
            </Button>
          }
          title={`Start season "${newSeasonName}"?`}
          description={
            previousSeasonId
              ? 'This creates a new season and carries over ratings from the selected season using the soft-reset formula. This cannot be undone.'
              : 'This creates a new season with no ratings carried over. This cannot be undone.'
          }
          confirmLabel="Confirm Start Season"
          onConfirm={handleConfirm}
          isConfirming={isSubmitting}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/StartSeason.test.tsx`
Expected: PASS (7/7 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/admin/StartSeason.tsx web/src/pages/admin/StartSeason.test.tsx
git commit -m "feat: mount SeasonInFlightOverview on the Start Season page"
```

- [ ] **Step 6: Run the full frontend suite and the TypeScript build check**

Run: `cd web && npm test`
Expected: All test files pass (this branch adds 4 new test files and rewrites 2 existing ones — no prior test should regress).

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0 (clean build — per this codebase's recurring `tsc -b`-vs-Vitest divergence lesson, this is the only step that catches type-level mistakes Vitest's esbuild transform does not).

If either command reports a failure, fix it directly before considering this task complete (do not leave a broken build/suite for the final whole-branch review to discover).

- [ ] **Step 7: Commit any fixes from Step 6, if needed**

Only run this if Step 6 required changes:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from Dashboard redesign final check"
```
