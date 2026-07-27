# Explore Season-Independent Players Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `Explore`'s Players section from depending on `useActiveSeason()`/`usePlayers(seasonId)` at all (it never needed season-scoped ratings, since it doesn't render one), and add an optional season filter that narrows the Matches section only.

**Architecture:** A new, deliberately minimal `usePlayerRoster()` hook (no season parameter) replaces the season-scoped `usePlayers(seasonId)` call in `Explore.tsx`. A separate, unrelated local `seasonFilter` state adds a `<select>` next to the Matches section heading, narrowing `matchedMatches` only.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Vitest + `@testing-library/react`.

## Global Constraints

- New query key: `queryKeys.playerRoster: () => ['playerRoster'] as const`.
- `usePlayerRoster()` returns `PlayerRosterEntry[]` (`{ id: string; full_name: string; photo_url?: string | null }`) — active players only (`is_active = true`), ordered by `full_name` ascending. It never queries `player_season_ratings` — nothing that renders its result displays a rating.
- The season filter (`seasonFilter` state, default `''` meaning "All seasons") narrows the **Matches** section only. Players and Seasons sections are unaffected by it.
- This plan fixes a genuine pre-existing bug: today `ExplorePage`'s combined `isLoading`/`isError` never includes `activeSeason`'s own error state, and `usePlayers`'s `enabled: seasonId !== undefined` guard means a missing active season leaves that query permanently disabled rather than loading or erroring — the Players section renders in an inconsistent limbo instead of either state. After this plan, `isLoading`/`isError` are computed from exactly three hooks (`usePlayerRoster`, `useSeasons`, `useAllMatches`), none of which has this failure mode.
- `useActiveSeason.ts` and `usePlayers.ts` are not modified — `usePlayers.ts` keeps its existing season-scoped signature for its other caller (`admin/ManagePlayers.tsx`, migrated in a separate already-merged plan).

---

### Task 1: `usePlayerRoster` hook

**Files:**
- Create: `web/src/hooks/usePlayerRoster.ts`
- Test: `web/src/hooks/usePlayerRoster.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabaseClient` (existing), `resolvePlayerPhotoUrls`/`pickResolvedUrl` from `@/lib/playerPhotos` (existing, already used by `usePlayers.ts` for the identical photo-resolution step).
- Produces (used by Task 2):
  ```ts
  export interface PlayerRosterEntry {
    id: string;
    full_name: string;
    photo_url?: string | null;
  }
  export function usePlayerRoster(): UseQueryResult<PlayerRosterEntry[]>;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/hooks/usePlayerRoster.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: mockOrder }) }) }),
  },
}));

import { usePlayerRoster } from './usePlayerRoster';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerRoster', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns the active player roster, ordered by name, without fetching ratings', async () => {
    mockOrder.mockResolvedValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
      ],
      error: null,
    });

    const { result } = renderHook(() => usePlayerRoster(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
      { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
    ]);
    expect(mockOrder).toHaveBeenCalledWith('full_name', { ascending: true });
  });

  it('surfaces a fetch error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => usePlayerRoster(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/hooks/usePlayerRoster.test.tsx`
Expected: FAIL — `Cannot find module './usePlayerRoster'`.

- [ ] **Step 3: Add the query key**

In `web/src/lib/queryKeys.ts`, add a new entry to the `queryKeys` object (alphabetical position doesn't matter — this codebase's existing key list isn't sorted):

```ts
  playerRoster: () => ['playerRoster'] as const,
```

The full file becomes:

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
  isAdmin: (userId: string) => ['isAdmin', userId] as const,
  userProfile: (userId: string) => ['userProfile', userId] as const,
  pendingClaims: () => ['pendingClaims'] as const,
};
```

- [ ] **Step 4: Write the implementation**

```ts
// web/src/hooks/usePlayerRoster.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface PlayerRosterEntry {
  id: string;
  full_name: string;
  photo_url?: string | null;
}

export function usePlayerRoster() {
  return useQuery({
    queryKey: queryKeys.playerRoster(),
    queryFn: async (): Promise<PlayerRosterEntry[]> => {
      const { data, error } = await supabase
        .from('players')
        .select('id, full_name, photo_url')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (error) throw error;

      const rawPlayers = data as { id: string; full_name: string; photo_url: string | null }[];
      const photoUrlByPath = await resolvePlayerPhotoUrls(rawPlayers.map((p) => p.photo_url));
      return rawPlayers.map((player) => ({
        id: player.id,
        full_name: player.full_name,
        photo_url: pickResolvedUrl(photoUrlByPath, player.photo_url),
      }));
    },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/hooks/usePlayerRoster.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/usePlayerRoster.ts web/src/hooks/usePlayerRoster.test.tsx web/src/lib/queryKeys.ts
git commit -m "feat: add usePlayerRoster, a season-independent player list"
```

---

### Task 2: Wire `Explore.tsx` onto `usePlayerRoster`, add the season filter, final check

**Files:**
- Modify: `web/src/pages/Explore.tsx`
- Modify: `web/src/pages/Explore.test.tsx`

**Interfaces:**
- Consumes: `usePlayerRoster()` (Task 1).

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/Explore.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/usePlayerRoster', () => ({
  usePlayerRoster: () => ({
    data: [
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
      { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useSeasons', () => ({
  useSeasons: () => ({
    data: [
      { id: 's1', name: 'Test season', start_date: '2026-07-24', end_date: null, status: 'active' },
      { id: 's0', name: 'Seed Season', start_date: '2025-12-31', end_date: null, status: 'completed' },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useAllMatches', () => ({
  useAllMatches: () => ({
    data: [
      {
        id: 'm1',
        season_id: 's1',
        match_date: '2026-07-24',
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
      {
        id: 'm0',
        season_id: 's0',
        match_date: '2025-12-31',
        player_a_id: 'p1',
        player_b_id: 'p2',
        frames_a: 3,
        frames_b: 1,
        winner_id: 'p1',
        is_voided: false,
        is_period_closed: true,
        player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
        player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { ExplorePage } from './Explore';

function renderPage() {
  return render(
    <MemoryRouter>
      <ExplorePage />
    </MemoryRouter>,
  );
}

describe('ExplorePage', () => {
  it('prompts to search before anything is typed', () => {
    renderPage();
    expect(screen.getByText('Start typing to search players, matches, and seasons.')).toBeInTheDocument();
  });

  it('filters players, seasons, and matches by the typed query', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'Alex');

    const playersSection = screen.getByText('Players (1)').closest('section') as HTMLElement;
    expect(within(playersSection).getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute(
      'href',
      '/players/p1',
    );
    expect(within(playersSection).queryByText('Jordan Testplayer')).not.toBeInTheDocument();

    expect(screen.getByText('No matching seasons.')).toBeInTheDocument();

    // Both fixture matches involve Alex, across two different seasons --
    // Jordan legitimately appears as Alex's opponent in both.
    expect(screen.getByText('Matches (2)')).toBeInTheDocument();
    expect(screen.getByText('4–2')).toBeInTheDocument();
    expect(screen.getByText('3–1')).toBeInTheDocument();
  });

  it('links only the active season to the leaderboard, leaving others informational', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'season');

    expect(screen.getByRole('link', { name: /Test season/ })).toHaveAttribute('href', '/');
    expect(screen.getByText('Seed Season')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Seed Season/ })).not.toBeInTheDocument();
  });

  it('narrows the Matches section to the selected season, leaving Players and Seasons unaffected', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText(/search players, matches, seasons/i), 'Alex');
    expect(screen.getByText('Matches (2)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter matches by season'), 's0');

    expect(screen.getByText('Matches (1)')).toBeInTheDocument();
    expect(screen.getByText('3–1')).toBeInTheDocument();
    expect(screen.queryByText('4–2')).not.toBeInTheDocument();
    expect(screen.getByText('Players (1)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run (from `web/`): `npx vitest run src/pages/Explore.test.tsx`
Expected: the first three FAIL (the `usePlayers`/`useActiveSeason` mocks the current page imports no longer exist in this test file); the fourth (season filter) is new and also fails.

- [ ] **Step 3: Update `Explore.tsx`**

```tsx
// web/src/pages/Explore.tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { MatchTable } from '@/components/MatchTable';
import { usePlayerRoster } from '@/hooks/usePlayerRoster';
import { useSeasons } from '@/hooks/useSeasons';
import { useAllMatches } from '@/hooks/useAllMatches';

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query);
}

export function ExplorePage() {
  const [query, setQuery] = useState('');
  const [seasonFilter, setSeasonFilter] = useState('');
  const playerRoster = usePlayerRoster();
  const seasons = useSeasons();
  const allMatches = useAllMatches();

  const normalizedQuery = query.trim().toLowerCase();

  const matchedPlayers = useMemo(
    () => (playerRoster.data ?? []).filter((p) => matches(p.full_name, normalizedQuery)),
    [playerRoster.data, normalizedQuery],
  );
  const matchedSeasons = useMemo(
    () => (seasons.data ?? []).filter((s) => matches(s.name, normalizedQuery)),
    [seasons.data, normalizedQuery],
  );
  const matchedMatches = useMemo(
    () =>
      (allMatches.data ?? []).filter(
        (m) =>
          (seasonFilter === '' || m.season_id === seasonFilter) &&
          (matches(m.player_a.full_name, normalizedQuery) || matches(m.player_b.full_name, normalizedQuery)),
      ),
    [allMatches.data, normalizedQuery, seasonFilter],
  );

  const isLoading = playerRoster.isLoading || seasons.isLoading || allMatches.isLoading;
  const isError = playerRoster.isError || seasons.isError || allMatches.isError;

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Search</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Explore</h1>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players, matches, seasons…"
        className="mb-6"
        autoFocus
      />

      {!normalizedQuery ? (
        <p className="text-muted-foreground text-sm">Start typing to search players, matches, and seasons.</p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isError ? (
        <p className="text-destructive text-sm">Couldn't load search data. Try refreshing.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
              Players{matchedPlayers.length > 0 && ` (${matchedPlayers.length})`}
            </h2>
            {matchedPlayers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching players.</p>
            ) : (
              <ul className="card-surface overflow-hidden">
                {matchedPlayers.map((player) => (
                  <li key={player.id} className="border-b border-border last:border-0">
                    <Link
                      to={`/players/${player.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5"
                    >
                      <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                      <span className="font-semibold">{player.full_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
              Seasons{matchedSeasons.length > 0 && ` (${matchedSeasons.length})`}
            </h2>
            {matchedSeasons.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching seasons.</p>
            ) : (
              <ul className="card-surface overflow-hidden">
                {matchedSeasons.map((season) => {
                  const row = (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="font-semibold">{season.name}</span>
                      <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                        {season.status}
                      </span>
                    </div>
                  );
                  return (
                    <li key={season.id} className="border-b border-border last:border-0">
                      {season.status === 'active' ? (
                        <Link to="/" className="block hover:bg-foreground/5">
                          {row}
                        </Link>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-muted-foreground text-sm font-bold uppercase tracking-wider">
                Matches{matchedMatches.length > 0 && ` (${matchedMatches.length})`}
              </h2>
              <select
                value={seasonFilter}
                onChange={(e) => setSeasonFilter(e.target.value)}
                aria-label="Filter matches by season"
                className="border-input bg-background rounded-md border px-2 py-1 text-xs"
              >
                <option value="">All seasons</option>
                {(seasons.data ?? []).map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </div>
            {matchedMatches.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching matches.</p>
            ) : (
              <MatchTable matches={matchedMatches} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Explore.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full test suite and the TypeScript build once, as the final check for this plan**

Run: `npx vitest run` (from `web/`)
Expected: PASS, all files.

Run: `npx tsc -b` (from `web/`)
Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Explore.tsx web/src/pages/Explore.test.tsx
git commit -m "fix: make Explore's Players section season-independent, add a season filter to Matches"
```

---

## Self-Review Notes

- **Spec coverage:** `usePlayerRoster()` (season-independent, no ratings fetched), the season filter narrowing Matches only, and the `isLoading`/`isError` fix (no more silently-disabled-query limbo) — all covered. The Seasons section's existing behavior (only the active season links to `/`) is untouched and re-verified by an existing test.
- **Placeholder scan:** none found — every step shows exact before/after code.
- **Type consistency checked:** `PlayerRosterEntry`'s shape (`id`, `full_name`, `photo_url`) matches exactly between Task 1's implementation/tests and Task 2's `Explore.tsx` usage (`player.full_name`, `player.photo_url`, `player.id`) and test fixtures.
