# Dashboard Content (Highlights Carousel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard's plain top-of-page text with a rotating hero carousel that auto-computes a "Player of the Week" and auto-derives recent-activity headlines — no admin content authoring, no new tables.

**Architecture:** One new hook, `usePlayerOfTheWeek(seasonId)`, diffs the two most recent `weekly_rankings.week_ending` snapshots per player and picks the largest positive rating gain. One new pure function, `buildHighlightSlides()`, composes that hook's result with the already-shipped `useSeasonInFlight()` and `useRecentActivity()` hooks into an ordered, capped list of slides. One new component, `HighlightsCarousel`, renders those slides with a rotating auto-advance and clickable dot indicators, and is mounted at the top of all three `Dashboard.tsx` role variants.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Supabase JS client (PostgREST), Vitest + `@testing-library/react`.

## Global Constraints

- No admin-authored content at all — "Player of the Week" and news headlines are both fully auto-computed/auto-derived. Do not add a content table, RLS, or admin CRUD UI.
- Player of the Week: diff a player's `rating` between the two most-recent `weekly_rankings.week_ending` snapshots for the given season; pick the largest **positive** gain. Fewer than two snapshots (or no active season at all) means no Player-of-the-Week slide that cycle — a normal empty result (`data: null`), not an error, mirroring `useSeasonInFlight`'s existing `season: null` precedent.
- News headlines reuse the already-shipped `useRecentActivity()` (recent matches, recently-active players) and `useSeasonInFlight()` (season-is-live) hooks — do not invent a parallel data source or new tables.
- If literally nothing is available, show one generic welcome slide rather than an empty carousel.
- Slide count is capped (same `FEED_LIMIT`-style convention as `useRecentActivity`).
- Layout: a full-width hero carousel — approved via visual mockup — with Player of the Week and news headlines as equal-weight slides in one shared rotation, dot indicators, mounted above the existing `RecentActivityFeed`/`SeasonInFlightOverview` (both unchanged, from the prior season-agnostic-redesign plan).
- **No new dependency required.** Confirmed: no carousel library exists anywhere in this codebase (`web/package.json`, `web/src/components/ui/`). A simple interval-based auto-advance (`useState` + `setInterval`) is sufficient — do not add a carousel package.
- TanStack Query keys always come from `web/src/lib/queryKeys.ts` — never an inline literal key array.

---

### Task 1: `usePlayerOfTheWeek` hook

**Files:**
- Modify: `web/src/lib/queryKeys.ts`
- Create: `web/src/hooks/usePlayerOfTheWeek.ts`
- Test: `web/src/hooks/usePlayerOfTheWeek.test.tsx`

**Interfaces:**
- Consumes: `supabase` client, `resolvePlayerPhotoUrls`/`pickResolvedUrl` (`web/src/lib/playerPhotos.ts`).
- Produces: `usePlayerOfTheWeek(seasonId: string | undefined)` returning a TanStack Query result whose `data` is `PlayerOfTheWeek | null`, where `PlayerOfTheWeek = { player_id: string; full_name: string; photo_url: string | null; ratingGain: number }`. `data: null` is a successful, non-error result. Consumed by Task 3's `HighlightsCarousel`.

- [ ] **Step 1: Add the `playerOfTheWeek` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after the existing `gradeRoster` entry:

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
  playerOfTheWeek: (seasonId: string) => ['playerOfTheWeek', seasonId] as const,
};
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/usePlayerOfTheWeek.test.tsx`:

```tsx
// web/src/hooks/usePlayerOfTheWeek.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockFrom = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

interface QueryResult {
  data: unknown;
  error: unknown;
}

function makeBuilder(result: QueryResult) {
  const builder: {
    eq: () => typeof builder;
    order: () => typeof builder;
    then: (resolve: (value: QueryResult) => void) => void;
  } = {
    eq: () => builder,
    order: () => builder,
    then: (resolve) => resolve(result),
  };
  return builder;
}

import { usePlayerOfTheWeek } from './usePlayerOfTheWeek';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerOfTheWeek', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('picks the player with the largest positive rating gain between the two most recent weeks', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { week_ending: '2026-07-22' },
              { week_ending: '2026-07-22' },
              { week_ending: '2026-07-15' },
              { week_ending: '2026-07-15' },
            ],
            error: null,
          }),
      })
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { player_id: 'p1', rating: 1900, player: { full_name: 'Alex Testplayer', photo_url: null } },
              { player_id: 'p2', rating: 1780, player: { full_name: 'Jordan Testplayer', photo_url: null } },
            ],
            error: null,
          }),
      })
      .mockReturnValueOnce({
        select: () =>
          makeBuilder({
            data: [
              { player_id: 'p1', rating: 1830 },
              { player_id: 'p2', rating: 1770 },
            ],
            error: null,
          }),
      });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      player_id: 'p1',
      full_name: 'Alex Testplayer',
      photo_url: null,
      ratingGain: 70,
    });
  });

  it('returns null (not an error) when fewer than two distinct weeks exist yet', async () => {
    mockFrom.mockReturnValueOnce({
      select: () => makeBuilder({ data: [{ week_ending: '2026-07-22' }], error: null }),
    });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a seasonId is provided', () => {
    const { result } = renderHook(() => usePlayerOfTheWeek(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockFrom.mockReturnValueOnce({
      select: () => makeBuilder({ data: null, error: new Error('boom') }),
    });

    const { result } = renderHook(() => usePlayerOfTheWeek('s1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/usePlayerOfTheWeek.test.tsx`
Expected: FAIL — `Failed to resolve import "./usePlayerOfTheWeek"` (module does not exist yet).

- [ ] **Step 4: Implement `usePlayerOfTheWeek`**

Create `web/src/hooks/usePlayerOfTheWeek.ts`:

```ts
// web/src/hooks/usePlayerOfTheWeek.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface PlayerOfTheWeek {
  player_id: string;
  full_name: string;
  photo_url: string | null;
  ratingGain: number;
}

export function usePlayerOfTheWeek(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerOfTheWeek(seasonId ?? ''),
    queryFn: async (): Promise<PlayerOfTheWeek | null> => {
      const { data: weekRows, error: weekError } = await supabase
        .from('weekly_rankings')
        .select('week_ending')
        .eq('season_id', seasonId as string)
        .order('week_ending', { ascending: false });
      if (weekError) throw weekError;

      const distinctWeeks = [...new Set((weekRows as { week_ending: string }[]).map((row) => row.week_ending))];
      if (distinctWeeks.length < 2) return null;

      const [latestWeek, previousWeek] = distinctWeeks;

      const [latestRes, previousRes] = await Promise.all([
        supabase
          .from('weekly_rankings')
          .select('player_id, rating, player:player_id(full_name, photo_url)')
          .eq('season_id', seasonId as string)
          .eq('week_ending', latestWeek),
        supabase
          .from('weekly_rankings')
          .select('player_id, rating')
          .eq('season_id', seasonId as string)
          .eq('week_ending', previousWeek),
      ]);
      if (latestRes.error) throw latestRes.error;
      if (previousRes.error) throw previousRes.error;

      const latestRows = latestRes.data as unknown as {
        player_id: string;
        rating: number;
        player: { full_name: string; photo_url: string | null };
      }[];
      const previousRows = previousRes.data as unknown as { player_id: string; rating: number }[];

      const previousRatingByPlayer = new Map(previousRows.map((row) => [row.player_id, row.rating]));

      let best: PlayerOfTheWeek | null = null;
      for (const row of latestRows) {
        const previousRating = previousRatingByPlayer.get(row.player_id);
        if (previousRating === undefined) continue;
        const gain = row.rating - previousRating;
        if (gain > 0 && (!best || gain > best.ratingGain)) {
          best = {
            player_id: row.player_id,
            full_name: row.player.full_name,
            photo_url: row.player.photo_url,
            ratingGain: gain,
          };
        }
      }

      if (!best) return null;

      const photoUrlByPath = await resolvePlayerPhotoUrls([best.photo_url]);
      return { ...best, photo_url: pickResolvedUrl(photoUrlByPath, best.photo_url) };
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/usePlayerOfTheWeek.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/usePlayerOfTheWeek.ts web/src/hooks/usePlayerOfTheWeek.test.tsx
git commit -m "feat: add usePlayerOfTheWeek hook"
```

---

### Task 2: `buildHighlightSlides` pure function

**Files:**
- Create: `web/src/lib/highlightSlides.ts`
- Test: `web/src/lib/highlightSlides.test.ts`

**Interfaces:**
- Consumes: `MatchRow` type (`web/src/lib/types.ts`), `RecentActivityPlayer` type (`web/src/hooks/useRecentActivity.ts`), `PlayerOfTheWeek` type (Task 1).
- Produces: `HIGHLIGHTS_LIMIT` constant, `HighlightSlide` discriminated-union type (`{kind:'potw',...} | {kind:'season-live',...} | {kind:'match',...} | {kind:'signup',...} | {kind:'welcome'}`), and `buildHighlightSlides(args): HighlightSlide[]`. Consumed by Task 3's `HighlightsCarousel`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/highlightSlides.test.ts`:

```ts
// web/src/lib/highlightSlides.test.ts
import { describe, it, expect } from 'vitest';
import { buildHighlightSlides, HIGHLIGHTS_LIMIT } from './highlightSlides';
import type { MatchRow } from '@/lib/types';
import type { RecentActivityPlayer } from '@/hooks/useRecentActivity';

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
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
    ...overrides,
  };
}

describe('buildHighlightSlides', () => {
  it('puts Player of the Week first, then the season-live slide, when both are present', () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      activeSeasonName: 'Season 2026',
      recentMatches: [],
      recentPlayers: [],
    });

    expect(slides).toEqual([
      { kind: 'potw', playerId: 'p1', fullName: 'Alex Testplayer', photoUrl: null, ratingGain: 42 },
      { kind: 'season-live', seasonName: 'Season 2026' },
    ]);
  });

  it("describes a match slide from the winner's perspective regardless of which side won", () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [makeMatch({ winner_id: 'p2', frames_a: 2, frames_b: 4 })],
      recentPlayers: [],
    });

    expect(slides).toEqual([
      { kind: 'match', matchId: 'm1', description: 'Jordan Testplayer beat Alex Testplayer 4-2' },
    ]);
  });

  it('adds a signup slide for a recently-active player who signed up, but not one whose activity was a match', () => {
    const recentPlayers: RecentActivityPlayer[] = [
      { id: 'p3', full_name: 'Sam Newcomer', photo_url: null, activity: 'signup', activity_date: '2026-07-26' },
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null, activity: 'match', activity_date: '2026-07-25' },
    ];

    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [],
      recentPlayers,
    });

    expect(slides).toEqual([{ kind: 'signup', playerId: 'p3', description: 'New player: Sam Newcomer joined' }]);
  });

  it('caps the total number of slides at HIGHLIGHTS_LIMIT', () => {
    const recentMatches = Array.from({ length: HIGHLIGHTS_LIMIT + 3 }, (_, i) =>
      makeMatch({ id: `m${i}`, match_date: `2026-07-${20 + i}` }),
    );

    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches,
      recentPlayers: [],
    });

    expect(slides).toHaveLength(HIGHLIGHTS_LIMIT);
  });

  it('falls back to a single welcome slide when there is nothing to show', () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [],
      recentPlayers: [],
    });

    expect(slides).toEqual([{ kind: 'welcome' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/highlightSlides.test.ts`
Expected: FAIL — `Failed to resolve import "./highlightSlides"` (module does not exist yet).

- [ ] **Step 3: Implement `buildHighlightSlides`**

Create `web/src/lib/highlightSlides.ts`:

```ts
// web/src/lib/highlightSlides.ts
import type { MatchRow } from '@/lib/types';
import type { RecentActivityPlayer } from '@/hooks/useRecentActivity';
import type { PlayerOfTheWeek } from '@/hooks/usePlayerOfTheWeek';

export const HIGHLIGHTS_LIMIT = 5;

export type HighlightSlide =
  | { kind: 'potw'; playerId: string; fullName: string; photoUrl: string | null; ratingGain: number }
  | { kind: 'season-live'; seasonName: string }
  | { kind: 'match'; matchId: string; description: string }
  | { kind: 'signup'; playerId: string; description: string }
  | { kind: 'welcome' };

export function buildHighlightSlides(args: {
  playerOfTheWeek: PlayerOfTheWeek | null;
  activeSeasonName: string | null;
  recentMatches: MatchRow[];
  recentPlayers: RecentActivityPlayer[];
}): HighlightSlide[] {
  const slides: HighlightSlide[] = [];

  if (args.playerOfTheWeek) {
    slides.push({
      kind: 'potw',
      playerId: args.playerOfTheWeek.player_id,
      fullName: args.playerOfTheWeek.full_name,
      photoUrl: args.playerOfTheWeek.photo_url,
      ratingGain: args.playerOfTheWeek.ratingGain,
    });
  }

  if (args.activeSeasonName) {
    slides.push({ kind: 'season-live', seasonName: args.activeSeasonName });
  }

  for (const match of args.recentMatches) {
    if (slides.length >= HIGHLIGHTS_LIMIT) break;
    const winnerIsA = match.winner_id === match.player_a_id;
    const winner = winnerIsA ? match.player_a : match.player_b;
    const loser = winnerIsA ? match.player_b : match.player_a;
    const winnerFrames = winnerIsA ? match.frames_a : match.frames_b;
    const loserFrames = winnerIsA ? match.frames_b : match.frames_a;
    slides.push({
      kind: 'match',
      matchId: match.id,
      description: `${winner.full_name} beat ${loser.full_name} ${winnerFrames}-${loserFrames}`,
    });
  }

  for (const player of args.recentPlayers) {
    if (slides.length >= HIGHLIGHTS_LIMIT) break;
    if (player.activity !== 'signup') continue;
    slides.push({ kind: 'signup', playerId: player.id, description: `New player: ${player.full_name} joined` });
  }

  if (slides.length === 0) {
    slides.push({ kind: 'welcome' });
  }

  return slides.slice(0, HIGHLIGHTS_LIMIT);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/highlightSlides.test.ts`
Expected: PASS (5/5 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/highlightSlides.ts web/src/lib/highlightSlides.test.ts
git commit -m "feat: add buildHighlightSlides for the Dashboard highlights carousel"
```

---

### Task 3: `HighlightsCarousel` component

**Files:**
- Create: `web/src/components/HighlightsCarousel.tsx`
- Test: `web/src/components/HighlightsCarousel.test.tsx`

**Interfaces:**
- Consumes: `useSeasonInFlight()` (`web/src/hooks/useSeasonInFlight.ts`, unchanged), `usePlayerOfTheWeek()` (Task 1), `useRecentActivity()` (`web/src/hooks/useRecentActivity.ts`, unchanged), `buildHighlightSlides`/`HighlightSlide` (Task 2), `PlayerAvatar` (`web/src/components/PlayerAvatar.tsx`), `Skeleton` (`web/src/components/ui/skeleton.tsx`).
- Produces: `HighlightsCarousel` — a no-props component. Consumed by Task 4's `Dashboard.tsx`.
- **Deliberate test scope note**: this component auto-advances slides on a `setInterval` timer. The tests below verify rendering correctness for every slide kind and that clicking a dot indicator navigates directly to that slide — they do **not** exercise the timer-driven auto-advance itself (fake timers combined with this component's async data-fetching hooks is a known source of flaky interaction with `@testing-library`'s polling-based `waitFor`, per this codebase's own history). This is a deliberate scope choice, not an oversight.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/HighlightsCarousel.test.tsx`:

```tsx
// web/src/components/HighlightsCarousel.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockUseSeasonInFlight = vi.fn();
const mockUsePlayerOfTheWeek = vi.fn();
const mockUseRecentActivity = vi.fn();

vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));
vi.mock('@/hooks/usePlayerOfTheWeek', () => ({ usePlayerOfTheWeek: () => mockUsePlayerOfTheWeek() }));
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));

import { HighlightsCarousel } from './HighlightsCarousel';

function renderComponent() {
  return render(
    <MemoryRouter>
      <HighlightsCarousel />
    </MemoryRouter>,
  );
}

const NO_SEASON = {
  data: { season: null, matchesPlayed: 0, activePlayerCount: 0, daysElapsed: 0 },
  isLoading: false,
  isError: false,
};
const ACTIVE_SEASON = {
  data: {
    season: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const },
    matchesPlayed: 0,
    activePlayerCount: 0,
    daysElapsed: 1,
  },
  isLoading: false,
  isError: false,
};
const NO_ACTIVITY = { data: { recentMatches: [], recentPlayers: [] }, isLoading: false, isError: false };
const NO_POTW = { data: null, isLoading: false, isError: false };

describe('HighlightsCarousel', () => {
  it('shows the Player of the Week slide first, linking to their profile', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex Testplayer' })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('+42 rating this week')).toBeInTheDocument();
  });

  it('shows the season-live slide when there is an active season and no Player of the Week', () => {
    mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Season Season 2026 is live')).toBeInTheDocument();
  });

  it('falls back to the welcome slide when there is nothing to show', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);

    renderComponent();
    expect(screen.getByText('Welcome to PoolIQ')).toBeInTheDocument();
  });

  it('lets clicking a dot indicator jump directly to that slide', async () => {
    mockUseSeasonInFlight.mockReturnValue(ACTIVE_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });
    mockUseRecentActivity.mockReturnValue(NO_ACTIVITY);
    const user = userEvent.setup();

    renderComponent();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show slide 2' }));
    expect(screen.getByText('Season Season 2026 is live')).toBeInTheDocument();
  });

  it('shows a loading skeleton while any composed hook is still loading', () => {
    mockUseSeasonInFlight.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerOfTheWeek.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { container } = renderComponent();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message if any composed hook fails', () => {
    mockUseSeasonInFlight.mockReturnValue(NO_SEASON);
    mockUsePlayerOfTheWeek.mockReturnValue(NO_POTW);
    mockUseRecentActivity.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    renderComponent();
    expect(screen.getByText("Couldn't load dashboard highlights. Try refreshing.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/HighlightsCarousel.test.tsx`
Expected: FAIL — `Failed to resolve import "./HighlightsCarousel"` (module does not exist yet).

- [ ] **Step 3: Implement `HighlightsCarousel`**

Create `web/src/components/HighlightsCarousel.tsx`:

```tsx
// web/src/components/HighlightsCarousel.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useSeasonInFlight } from '@/hooks/useSeasonInFlight';
import { usePlayerOfTheWeek } from '@/hooks/usePlayerOfTheWeek';
import { useRecentActivity } from '@/hooks/useRecentActivity';
import { buildHighlightSlides, type HighlightSlide } from '@/lib/highlightSlides';

const ROTATE_INTERVAL_MS = 6000;

function SlideContent({ slide }: { slide: HighlightSlide }) {
  switch (slide.kind) {
    case 'potw':
      return (
        <div className="flex items-center gap-4">
          <PlayerAvatar name={slide.fullName} photoUrl={slide.photoUrl} size="lg" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-white/80">Player of the Week</p>
            <Link to={`/players/${slide.playerId}`} className="text-xl font-extrabold text-white hover:underline">
              {slide.fullName}
            </Link>
            <p className="text-sm text-white/85">+{slide.ratingGain} rating this week</p>
          </div>
        </div>
      );
    case 'season-live':
      return <p className="text-lg font-bold text-white">Season {slide.seasonName} is live</p>;
    case 'match':
      return <p className="text-lg font-bold text-white">{slide.description}</p>;
    case 'signup':
      return (
        <Link to={`/players/${slide.playerId}`} className="text-lg font-bold text-white hover:underline">
          {slide.description}
        </Link>
      );
    case 'welcome':
      return <p className="text-lg font-bold text-white">Welcome to PoolIQ</p>;
  }
}

export function HighlightsCarousel() {
  const seasonInFlight = useSeasonInFlight();
  const activeSeasonId = seasonInFlight.data?.season?.id;
  const playerOfTheWeek = usePlayerOfTheWeek(activeSeasonId);
  const recentActivity = useRecentActivity();

  const isLoading = seasonInFlight.isLoading || playerOfTheWeek.isLoading || recentActivity.isLoading;
  const isError = seasonInFlight.isError || playerOfTheWeek.isError || recentActivity.isError;

  const slides =
    isLoading || isError
      ? []
      : buildHighlightSlides({
          playerOfTheWeek: playerOfTheWeek.data ?? null,
          activeSeasonName: seasonInFlight.data?.season?.name ?? null,
          recentMatches: recentActivity.data?.recentMatches ?? [],
          recentPlayers: recentActivity.data?.recentPlayers ?? [],
        });

  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    setSlideIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return undefined;
    const interval = setInterval(() => {
      setSlideIndex((current) => (current + 1) % slides.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [slides.length]);

  if (isLoading) {
    return <Skeleton className="mb-6 h-32 w-full rounded-2xl" />;
  }

  if (isError) {
    return <p className="text-destructive mb-6 text-sm">Couldn't load dashboard highlights. Try refreshing.</p>;
  }

  const currentSlide = slides[slideIndex] ?? slides[0];

  return (
    <div className="fpl-gradient mb-6 rounded-2xl px-6 py-8">
      <SlideContent slide={currentSlide} />
      {slides.length > 1 && (
        <div className="mt-4 flex justify-center gap-1.5">
          {slides.map((slide, index) => (
            <button
              key={`${slide.kind}-${index}`}
              type="button"
              aria-label={`Show slide ${index + 1}`}
              onClick={() => setSlideIndex(index)}
              className={`h-1.5 w-1.5 rounded-full ${index === slideIndex ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/HighlightsCarousel.test.tsx`
Expected: PASS (6/6 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/HighlightsCarousel.tsx web/src/components/HighlightsCarousel.test.tsx
git commit -m "feat: add HighlightsCarousel component for the Dashboard"
```

---

### Task 4: Mount `HighlightsCarousel` on `Dashboard.tsx`, final checks

**Files:**
- Modify: `web/src/pages/Dashboard.tsx`
- Modify: `web/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `HighlightsCarousel` (Task 3).
- Produces: no new exports — `DashboardPage`'s signature is unchanged.

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
const mockUsePlayerOfTheWeek = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/hooks/useRecentActivity', () => ({ useRecentActivity: () => mockUseRecentActivity() }));
vi.mock('@/hooks/useSeasonInFlight', () => ({ useSeasonInFlight: () => mockUseSeasonInFlight() }));
vi.mock('@/hooks/usePlayerOfTheWeek', () => ({ usePlayerOfTheWeek: () => mockUsePlayerOfTheWeek() }));

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
    mockUsePlayerOfTheWeek.mockReturnValue({ data: null, isLoading: false, isError: false });
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

  it('shows the highlights carousel with Player of the Week on the admin dashboard', () => {
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUsePlayerOfTheWeek.mockReturnValue({
      data: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      isLoading: false,
      isError: false,
    });

    renderDashboard();
    expect(screen.getByText('Player of the Week')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alex Testplayer' })).toHaveAttribute('href', '/players/p1');
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
Expected: FAIL — only the new `'shows the highlights carousel with Player of the Week...'` test fails (the current `Dashboard.tsx` never imports or renders `HighlightsCarousel`, so "Player of the Week" text never appears). Every other test still passes against the current code — the current `Dashboard.tsx` never calls `usePlayerOfTheWeek()` at all, so mocking it has no effect on the existing rendering, and the new mock's default (`data: null`) doesn't change anything the other tests already assert.

- [ ] **Step 3: Mount `HighlightsCarousel`**

Replace the full contents of `web/src/pages/Dashboard.tsx`:

```tsx
// web/src/pages/Dashboard.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { HighlightsCarousel } from '@/components/HighlightsCarousel';
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
      <HighlightsCarousel />
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
      <HighlightsCarousel />
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
      <HighlightsCarousel />
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
Expected: PASS (10/10 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Dashboard.tsx web/src/pages/Dashboard.test.tsx
git commit -m "feat: mount HighlightsCarousel on the Dashboard"
```

- [ ] **Step 6: Run the full frontend suite and the TypeScript build check**

Run: `cd web && npm test`
Expected: All test files pass (this branch adds 3 new test files and rewrites 1 existing one — no prior test should regress).

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0.

If either command reports a failure, fix it directly before considering this task complete.

- [ ] **Step 7: Commit any fixes from Step 6, if needed**

Only run this if Step 6 required changes:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from dashboard content final check"
```
