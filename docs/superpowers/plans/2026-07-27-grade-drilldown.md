# Grade Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user click a grade on the Grade Distribution page and see every player currently in that grade, each linking through to their profile.

**Architecture:** One new read-only hook (`useGradeRoster`) queries `player_season_ratings` joined to `players`, filtered by season and grade. One new page (`GradeRosterPage`) at `/grades/:grade` resolves the season via the existing `useSeasonSelector()` (same hook `GradeDistribution.tsx` already uses) and renders the roster. `GradeDistribution.tsx`'s existing grade rows become links to that route — no other page changes.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, React Router v6, Supabase JS client (PostgREST), Vitest + `@testing-library/react`.

## Global Constraints

- Only the Grade Distribution page's rows become clickable. Grade badges elsewhere (Leaderboard, Player Profile, Dashboard) are explicitly out of scope and must not change.
- `/grades/:grade` is a dedicated route, not a modal.
- The roster reads the **currently-selected season** via `useSeasonSelector()` — the same hook, same default-to-most-recent-season behavior already used by `GradeDistribution.tsx`, `Leaderboard.tsx`, and `MatchHistory.tsx`.
- Players are listed sorted by rating, descending.
- `player_season_ratings` is readable by the `authenticated` role today (confirmed: `20260714020000_rls_policies.sql`'s `using (true)` policy is untouched for authenticated users; only `anon`'s grant was revoked in `20260724010000_require_login_for_league_data.sql`) — no migration needed for this plan.
- TanStack Query keys always come from `web/src/lib/queryKeys.ts` — never an inline literal key array.

---

### Task 1: `useGradeRoster` hook

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/useGradeRoster.ts`
- Test: `web/src/hooks/useGradeRoster.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (`web/src/lib/supabaseClient.ts`), `resolvePlayerPhotoUrls`/`pickResolvedUrl` (`web/src/lib/playerPhotos.ts`), `Grade` type (`web/src/lib/types.ts`).
- Produces: `useGradeRoster(seasonId: string | undefined, grade: Grade | undefined)` returning a TanStack Query result whose `data` is `GradeRosterEntry[]`, where `GradeRosterEntry = { player_id: string; full_name: string; photo_url: string | null; rating: number; season_points: number; matches_played: number }`. Consumed by Task 2's `GradeRosterPage`.

- [ ] **Step 1: Add the `gradeRoster` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after the existing `pendingClaims` entry:

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
  seasonInFlight: () => ['seasonInFlight'] as const,
  isAdmin: (userId: string) => ['isAdmin', userId] as const,
  userProfile: (userId: string) => ['userProfile', userId] as const,
  pendingClaims: () => ['pendingClaims'] as const,
  gradeRoster: (seasonId: string, grade: string) => ['gradeRoster', seasonId, grade] as const,
};
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useGradeRoster.test.tsx`:

```tsx
// web/src/hooks/useGradeRoster.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: mockOrder }) }) }) }),
  },
}));

import { useGradeRoster } from './useGradeRoster';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useGradeRoster', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns players in the requested grade, already sorted by rating by the query', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          player_id: 'p1',
          rating: 1900,
          season_points: 20,
          matches_played: 10,
          player: { full_name: 'Alex Testplayer', photo_url: null },
        },
        {
          player_id: 'p2',
          rating: 1850,
          season_points: 18,
          matches_played: 9,
          player: { full_name: 'Jordan Testplayer', photo_url: null },
        },
      ],
      error: null,
    });

    const { result } = renderHook(() => useGradeRoster('s1', 'A+'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      {
        player_id: 'p1',
        full_name: 'Alex Testplayer',
        photo_url: null,
        rating: 1900,
        season_points: 20,
        matches_played: 10,
      },
      {
        player_id: 'p2',
        full_name: 'Jordan Testplayer',
        photo_url: null,
        rating: 1850,
        season_points: 18,
        matches_played: 9,
      },
    ]);
  });

  it('stays disabled until both seasonId and grade are provided', () => {
    const { result } = renderHook(() => useGradeRoster(undefined, undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useGradeRoster('s1', 'A+'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useGradeRoster.test.tsx`
Expected: FAIL — `Failed to resolve import "./useGradeRoster"` (module does not exist yet).

- [ ] **Step 4: Implement `useGradeRoster`**

Create `web/src/hooks/useGradeRoster.ts`:

```ts
// web/src/hooks/useGradeRoster.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { Grade } from '@/lib/types';

export interface GradeRosterEntry {
  player_id: string;
  full_name: string;
  photo_url: string | null;
  rating: number;
  season_points: number;
  matches_played: number;
}

export function useGradeRoster(seasonId: string | undefined, grade: Grade | undefined) {
  return useQuery({
    queryKey: queryKeys.gradeRoster(seasonId ?? '', grade ?? ''),
    queryFn: async (): Promise<GradeRosterEntry[]> => {
      const { data, error } = await supabase
        .from('player_season_ratings')
        .select('player_id, rating, season_points, matches_played, player:player_id(full_name, photo_url)')
        .eq('season_id', seasonId as string)
        .eq('grade', grade as string)
        .order('rating', { ascending: false });
      if (error) throw error;

      const rows = data as unknown as {
        player_id: string;
        rating: number;
        season_points: number;
        matches_played: number;
        player: { full_name: string; photo_url: string | null };
      }[];

      const photoUrlByPath = await resolvePlayerPhotoUrls(rows.map((r) => r.player.photo_url));
      return rows.map((row) => ({
        player_id: row.player_id,
        full_name: row.player.full_name,
        photo_url: pickResolvedUrl(photoUrlByPath, row.player.photo_url),
        rating: row.rating,
        season_points: row.season_points,
        matches_played: row.matches_played,
      }));
    },
    enabled: seasonId !== undefined && grade !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useGradeRoster.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useGradeRoster.ts web/src/hooks/useGradeRoster.test.tsx
git commit -m "feat: add useGradeRoster hook for the grade drill-down feature"
```

---

### Task 2: `GradeRosterPage` + route

**Files:**
- Create: `web/src/pages/GradeRoster.tsx`
- Test: `web/src/pages/GradeRoster.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useGradeRoster` (Task 1), `useSeasonSelector` (`web/src/hooks/useSeasonSelector.ts`, unchanged — returns `{ selectedSeason, selectedSeasonId, seasons, isLoading, isError, selectSeason, selectPrevious, selectNext, hasPrevious, hasNext }`), `SeasonPillSwitcher` (`web/src/components/SeasonPillSwitcher.tsx`, props `{ selectedSeason, seasons, onSelectSeason, onPrevious, onNext, hasPrevious, hasNext }`), `GradeBadge` (`web/src/components/GradeBadge.tsx`, prop `{ grade: Grade }`), `PlayerAvatar` (`web/src/components/PlayerAvatar.tsx`, props `{ name, photoUrl, size }`), `Grade` type.
- Produces: `GradeRosterPage` — no props, reads the grade from the route via `useParams<{ grade: string }>()`. Routed at `/grades/:grade` in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/GradeRoster.test.tsx`:

```tsx
// web/src/pages/GradeRoster.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
const mockUseGradeRoster = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/useGradeRoster', () => ({
  useGradeRoster: (seasonId: string | undefined, grade: string | undefined) => mockUseGradeRoster(seasonId, grade),
}));

import { GradeRosterPage } from './GradeRoster';

const SEASON: Season = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' };

function seasonSelectorReturn(season: Season | null, seasons: Season[]) {
  return {
    selectedSeason: season,
    selectedSeasonId: season?.id,
    seasons,
    isLoading: false,
    isError: false,
    selectSeason: vi.fn(),
    selectPrevious: vi.fn(),
    selectNext: vi.fn(),
    hasPrevious: false,
    hasNext: false,
  };
}

function renderPage(initialPath = '/grades/A+') {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/grades/:grade" element={<GradeRosterPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GradeRosterPage', () => {
  it('renders every player in the requested grade, linking to their profile', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({
      data: [
        {
          player_id: 'p1',
          full_name: 'Alex Testplayer',
          photo_url: null,
          rating: 1900,
          season_points: 20,
          matches_played: 10,
        },
      ],
      isLoading: false,
      isError: false,
    });

    renderPage();
    expect(screen.getByRole('heading', { name: 'Grade A+' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('1900')).toBeInTheDocument();
  });

  it('passes the season id and the route grade through to useGradeRoster', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderPage('/grades/B+');
    expect(mockUseGradeRoster).toHaveBeenCalledWith('s1', 'B+');
  });

  it('shows an empty state for a grade with no players', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('No players in this grade yet.')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });

  it('shows an error message when the roster fails to load', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseGradeRoster.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderPage();
    expect(screen.getByText("Couldn't load grade roster. Try refreshing.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/GradeRoster.test.tsx`
Expected: FAIL — `Failed to resolve import "./GradeRoster"` (module does not exist yet).

- [ ] **Step 3: Implement `GradeRosterPage`**

Create `web/src/pages/GradeRoster.tsx`:

```tsx
// web/src/pages/GradeRoster.tsx
import { Link, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { GradeBadge } from '@/components/GradeBadge';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useGradeRoster } from '@/hooks/useGradeRoster';
import type { Grade } from '@/lib/types';

export function GradeRosterPage() {
  const { grade } = useParams<{ grade: string }>();
  const seasonSelector = useSeasonSelector();
  const roster = useGradeRoster(seasonSelector.selectedSeasonId, grade as Grade | undefined);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load grade roster. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (roster.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (roster.isError) {
    return <p className="text-destructive">Couldn't load grade roster. Try refreshing.</p>;
  }

  const players = roster.data ?? [];

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <div className="mb-3 flex justify-center sm:justify-start">
          <SeasonPillSwitcher
            selectedSeason={seasonSelector.selectedSeason}
            seasons={seasonSelector.seasons}
            onSelectSeason={seasonSelector.selectSeason}
            onPrevious={seasonSelector.selectPrevious}
            onNext={seasonSelector.selectNext}
            hasPrevious={seasonSelector.hasPrevious}
            hasNext={seasonSelector.hasNext}
          />
        </div>
        <div className="flex items-center gap-3">
          <GradeBadge grade={grade as Grade} />
          <h1 className="text-3xl font-extrabold sm:text-4xl">Grade {grade}</h1>
        </div>
      </div>
      {players.length === 0 ? (
        <p className="text-muted-foreground">No players in this grade yet.</p>
      ) : (
        <ul className="card-surface overflow-hidden">
          {players.map((player) => (
            <li key={player.player_id} className="border-b border-border last:border-0">
              <Link
                to={`/players/${player.player_id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5"
              >
                <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                <span className="flex-1 font-semibold">{player.full_name}</span>
                <span className="text-muted-foreground text-sm tabular-nums">{player.rating}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Register the route**

Edit `web/src/App.tsx` — add the import and the route, right after the existing `/grades` route:

```tsx
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { GradeRosterPage } from '@/pages/GradeRoster';
```

```tsx
            <Route path="/grades" element={<GradeDistributionPage />} />
            <Route path="/grades/:grade" element={<GradeRosterPage />} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/GradeRoster.test.tsx`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/GradeRoster.tsx web/src/pages/GradeRoster.test.tsx web/src/App.tsx
git commit -m "feat: add the grade roster page at /grades/:grade"
```

---

### Task 3: Make Grade Distribution rows clickable, final checks

**Files:**
- Modify: `web/src/pages/GradeDistribution.tsx`
- Modify: `web/src/pages/GradeDistribution.test.tsx`

**Interfaces:**
- Consumes: `GradeRosterPage`'s route (Task 2) — no code-level import, just the `/grades/:grade` path string.
- Produces: no new exports — `GradeDistributionPage`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Edit `web/src/pages/GradeDistribution.test.tsx` — replace the file's first test and wrap the render helper in a `MemoryRouter` (needed now that rows are real `Link`s):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Season } from '@/lib/types';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useGradeDistribution', () => ({
  useGradeDistribution: () => ({
    data: [
      { season_id: 's1', grade: 'A+', player_count: 2 },
      { season_id: 's1', grade: 'B', player_count: 5 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { GradeDistributionPage } from './GradeDistribution';

const SEASON: Season = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' };

function seasonSelectorReturn(season: Season | null, seasons: Season[]) {
  return {
    selectedSeason: season,
    selectedSeasonId: season?.id,
    seasons,
    isLoading: false,
    isError: false,
    selectSeason: vi.fn(),
    selectPrevious: vi.fn(),
    selectNext: vi.fn(),
    hasPrevious: false,
    hasNext: false,
  };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GradeDistributionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GradeDistributionPage', () => {
  it('renders a row for every grade band, including zero-count ones, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('links each grade row to its roster page', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('A+').closest('a')).toHaveAttribute('href', '/grades/A+');
    expect(screen.getByText('B').closest('a')).toHaveAttribute('href', '/grades/B');
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: FAIL — only the new `'links each grade row to its roster page'` test fails, with `toHaveAttribute` erroring against `null` (no `<a>` wraps the row yet, since `GradeDistribution.tsx` hasn't been changed to render a `Link` yet). The other two tests still pass unchanged — the `MemoryRouter` wrapper is harmless for a component that doesn't use routing yet.

- [ ] **Step 3: Make each row a link**

Edit `web/src/pages/GradeDistribution.tsx` — add the `Link` import and replace the row markup:

```tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';
```

```tsx
      <div className="card-surface flex flex-col gap-4 p-6">
        {rows.map((row) => (
          <Link
            key={row.grade}
            to={`/grades/${row.grade}`}
            className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-1 hover:bg-foreground/5"
          >
            <div className="w-10">
              <GradeBadge grade={row.grade} />
            </div>
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-foreground/5">
              <div
                className="fpl-gradient h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(row.player_count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-sm font-bold tabular-nums">{row.player_count}</span>
          </Link>
        ))}
      </div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: PASS (3/3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/GradeDistribution.tsx web/src/pages/GradeDistribution.test.tsx
git commit -m "feat: link Grade Distribution rows to their grade roster page"
```

- [ ] **Step 6: Run the full frontend suite and the TypeScript build check**

Run: `cd web && npm test`
Expected: All test files pass (this branch adds 2 new test files and modifies 1 existing one — no prior test should regress).

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0.

If either command reports a failure, fix it directly before considering this task complete.

- [ ] **Step 7: Commit any fixes from Step 6, if needed**

Only run this if Step 6 required changes:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from grade drill-down final check"
```
