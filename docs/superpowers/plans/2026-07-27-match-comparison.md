# Match Comparison View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every fixture and every completed match an EPL-Match-Centre-style side-by-side comparison page (`/fixtures/:id`, `/matches/:id`), reachable by clicking a row in either the Fixtures or Results tab of Match History.

**Architecture:** Two thin route pages (`FixtureDetailPage`, `MatchDetailPage`) share one presentational component (`MatchComparisonCard`). Four new hooks supply the data: `useHeadToHead` (all-time win tally between two players), `usePlayerComparisonStats` (a player's current rating/grade/season stats), `useFixture` (one fixture row by id), `useMatch` (one match row by id, plus its rating-delta from `rating_events`). No new tables, no new migration, no Edge Function changes — every table read here (`fixtures`, `matches`, `player_season_ratings`, `player_statistics`, `rating_events`) is already readable by any authenticated user, exercised by existing hooks (`useFixtures`, `useMatchHistory`, `usePlayerProfile`).

**Tech Stack:** React 18, TypeScript, TanStack Query v5, React Router v6, Tailwind, Vitest + `@testing-library/react`. Frontend-only plan — no backend/migration/Edge Function work, so no `src/db`/`src/api` suites are touched.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-27-engagement-features-design.md`, section 2.3 ("Match comparison view") and its architecture diagram in section 3. Read that section before starting if anything here is ambiguous.
- Routes are exactly `/fixtures/:id` and `/matches/:id` (per spec), registered under the existing `<Route element={<AuthRouteGuard />}>` block in `web/src/App.tsx` — any authenticated user can view a comparison, not just admins (matches how `/players/:playerId` and `/grades/:grade` are already open to all authenticated users).
- **Head-to-head is all-time, not season-scoped.** The spec's own text ("matches between these two specific players... no new table — this reads matches") never mentions a season filter. Query `matches` across every season, excluding voided matches.
- **The rating delta shown on a result is the instant-nudge delta only** (`rating_events` filtered to `event_type = 'instant'`), never the weekly-reconciliation delta — per the spec's explicit nuance (weekly-reconciliation events carry no `match_id` at all, so they can't be attributed to one match). This is why the UI must show the one-line caption "Rating change from this match" — already decided in the spec, implemented in Task 3 below.
- **A completed fixture's row links to `/matches/:completed_match_id`, not `/fixtures/:id`.** `FixtureDetailPage` never renders a score (it has none to show — a fixture is by definition not-yet-played). Once a fixture is completed, the real comparison-with-a-score lives at `/matches/:id`, so Task 8's wiring computes the link target conditionally rather than teaching `FixtureDetailPage` to redirect.
- Every new TanStack Query key comes from `web/src/lib/queryKeys.ts` — never an inline literal array (a recurring, explicitly-tracked bug class in this codebase per `CLAUDE.md`).
- Follow this codebase's existing conventions throughout: `isLoading`/`isError`/empty-is-valid per data hook (see `useFixtures.ts`, `usePlayerProfile.ts`); pages show a `<Skeleton className="h-64 w-full rounded-xl" />` while loading and `<p className="text-destructive">Couldn't load ... Try refreshing.</p>` on error or a missing row (same wording pattern already used by `PlayerProfilePage`, `GradeRosterPage`, `MatchHistoryPage` — a nonexistent id is folded into the same generic error message, not a distinct "not found" page, matching `PlayerProfilePage`'s existing `!profile.data` handling).
- A hook that depends on another hook's data (e.g. `usePlayerComparisonStats` needs `useFixture`'s resolved player id) must use `enabled: <id> !== undefined` exactly like every existing hook in this codebase already does (see `useGradeRoster`, `usePlayerProfile`). Pages must check the *upstream* hook's `isLoading`/`isError`/missing-data state and return early **before** checking the dependent hooks' loading state — while the upstream hook hasn't resolved yet, the dependent hooks are disabled, so their own `isLoading` is `false` even though they have no data yet. Getting this staging order backwards is the one subtle bug shape most likely in this plan; Tasks 5 and 7 show the correct staged structure explicitly.

---

### Task 1: `useHeadToHead` hook

**Files:**
- Create: `web/src/hooks/useHeadToHead.ts`
- Test: `web/src/hooks/useHeadToHead.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.headToHead`.
- Produces: `HeadToHeadTally = { winsA: number; winsB: number; played: number }`, `useHeadToHead(playerAId: string | undefined, playerBId: string | undefined)`. Consumed by Task 5 (`FixtureDetailPage`) and Task 7 (`MatchDetailPage`).

- [ ] **Step 1: Add the `headToHead` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after the existing `fixtures` entry:

```ts
  fixtures: (seasonId: string) => ['fixtures', seasonId] as const,
  headToHead: (playerAId: string, playerBId: string) => ['headToHead', playerAId, playerBId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useHeadToHead.test.tsx`:

```tsx
// web/src/hooks/useHeadToHead.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOr = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ or: mockOr }) }) }),
  },
}));

import { useHeadToHead } from './useHeadToHead';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useHeadToHead', () => {
  beforeEach(() => {
    mockOr.mockReset();
  });

  it('tallies wins per player regardless of which player was player_a in each match', async () => {
    mockOr.mockResolvedValue({
      data: [{ winner_id: 'pA' }, { winner_id: 'pB' }, { winner_id: 'pA' }],
      error: null,
    });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ winsA: 2, winsB: 1, played: 3 });
  });

  it('returns played: 0 with no wins when the two players have never met', async () => {
    mockOr.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ winsA: 0, winsB: 0, played: 0 });
  });

  it('stays disabled until both player ids are provided', () => {
    const { result } = renderHook(() => useHeadToHead(undefined, 'pB'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOr).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockOr.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useHeadToHead('pA', 'pB'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useHeadToHead.test.tsx`
Expected: FAIL — `Failed to resolve import "./useHeadToHead"` (module does not exist yet).

- [ ] **Step 4: Implement `useHeadToHead`**

Create `web/src/hooks/useHeadToHead.ts`:

```ts
// web/src/hooks/useHeadToHead.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';

export interface HeadToHeadTally {
  winsA: number;
  winsB: number;
  played: number;
}

export function useHeadToHead(playerAId: string | undefined, playerBId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.headToHead(playerAId ?? '', playerBId ?? ''),
    queryFn: async (): Promise<HeadToHeadTally> => {
      const { data, error } = await supabase
        .from('matches')
        .select('winner_id')
        .eq('is_voided', false)
        .or(
          `and(player_a_id.eq.${playerAId},player_b_id.eq.${playerBId}),and(player_a_id.eq.${playerBId},player_b_id.eq.${playerAId})`,
        );
      if (error) throw error;

      const rows = data as { winner_id: string }[];
      return {
        winsA: rows.filter((row) => row.winner_id === playerAId).length,
        winsB: rows.filter((row) => row.winner_id === playerBId).length,
        played: rows.length,
      };
    },
    enabled: playerAId !== undefined && playerBId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useHeadToHead.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useHeadToHead.ts web/src/hooks/useHeadToHead.test.tsx
git commit -m "feat: add useHeadToHead hook"
```

---

### Task 2: `usePlayerComparisonStats` hook

**Files:**
- Create: `web/src/hooks/usePlayerComparisonStats.ts`
- Test: `web/src/hooks/usePlayerComparisonStats.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.playerComparisonStats`, `Grade` from `@/lib/types`.
- Produces: `ComparisonStats = { rating: number | null; grade: Grade | null; wins: number | null; losses: number | null; win_pct: number | null; form_5: number | null; form_10: number | null }`, `usePlayerComparisonStats(playerId: string | undefined, seasonId: string | undefined)`. `ComparisonStats` is consumed by Task 3 (`MatchComparisonCard`'s `ComparisonPlayer` extends it); the hook itself is consumed by Task 5 and Task 7.

- [ ] **Step 1: Add the `playerComparisonStats` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after `headToHead`:

```ts
  headToHead: (playerAId: string, playerBId: string) => ['headToHead', playerAId, playerBId] as const,
  playerComparisonStats: (playerId: string, seasonId: string) => ['playerComparisonStats', playerId, seasonId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/usePlayerComparisonStats.test.tsx`:

```tsx
// web/src/hooks/usePlayerComparisonStats.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockRatingMaybeSingle = vi.fn();
const mockStatsMaybeSingle = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockRatingMaybeSingle }) }) }) };
      }
      if (table === 'player_statistics') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mockStatsMaybeSingle }) }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { usePlayerComparisonStats } from './usePlayerComparisonStats';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerComparisonStats', () => {
  beforeEach(() => {
    mockRatingMaybeSingle.mockReset();
    mockStatsMaybeSingle.mockReset();
  });

  it('combines the current rating/grade with season statistics', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: { rating: 1700, grade: 'A' }, error: null });
    mockStatsMaybeSingle.mockResolvedValue({
      data: { wins: 5, losses: 2, win_pct: 71.43, form_5: 80, form_10: 70 },
      error: null,
    });

    const { result } = renderHook(() => usePlayerComparisonStats('p1', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      rating: 1700,
      grade: 'A',
      wins: 5,
      losses: 2,
      win_pct: 71.43,
      form_5: 80,
      form_10: 70,
    });
  });

  it('returns all-null fields when the player has no rating or statistics row yet this season', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePlayerComparisonStats('p2', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      rating: null,
      grade: null,
      wins: null,
      losses: null,
      win_pct: null,
      form_5: null,
      form_10: null,
    });
  });

  it('stays disabled until both playerId and seasonId are provided', () => {
    const { result } = renderHook(() => usePlayerComparisonStats(undefined, 's1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockRatingMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockRatingMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => usePlayerComparisonStats('p1', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/usePlayerComparisonStats.test.tsx`
Expected: FAIL — `Failed to resolve import "./usePlayerComparisonStats"`.

- [ ] **Step 4: Implement `usePlayerComparisonStats`**

Create `web/src/hooks/usePlayerComparisonStats.ts`:

```ts
// web/src/hooks/usePlayerComparisonStats.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Grade } from '@/lib/types';

export interface ComparisonStats {
  rating: number | null;
  grade: Grade | null;
  wins: number | null;
  losses: number | null;
  win_pct: number | null;
  form_5: number | null;
  form_10: number | null;
}

export function usePlayerComparisonStats(playerId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerComparisonStats(playerId ?? '', seasonId ?? ''),
    queryFn: async (): Promise<ComparisonStats> => {
      const [ratingRes, statsRes] = await Promise.all([
        supabase
          .from('player_season_ratings')
          .select('rating, grade')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
        supabase
          .from('player_statistics')
          .select('wins, losses, win_pct, form_5, form_10')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
      ]);
      if (ratingRes.error) throw ratingRes.error;
      if (statsRes.error) throw statsRes.error;

      const rating = ratingRes.data as { rating: number; grade: Grade } | null;
      const stats = statsRes.data as {
        wins: number;
        losses: number;
        win_pct: number;
        form_5: number | null;
        form_10: number | null;
      } | null;

      return {
        rating: rating?.rating ?? null,
        grade: rating?.grade ?? null,
        wins: stats?.wins ?? null,
        losses: stats?.losses ?? null,
        win_pct: stats?.win_pct ?? null,
        form_5: stats?.form_5 ?? null,
        form_10: stats?.form_10 ?? null,
      };
    },
    enabled: playerId !== undefined && seasonId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/usePlayerComparisonStats.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/usePlayerComparisonStats.ts web/src/hooks/usePlayerComparisonStats.test.tsx
git commit -m "feat: add usePlayerComparisonStats hook"
```

---

### Task 3: `MatchComparisonCard` component

**Files:**
- Create: `web/src/components/MatchComparisonCard.tsx`
- Test: `web/src/components/MatchComparisonCard.test.tsx`

**Interfaces:**
- Consumes: `PlayerAvatar`, `GradeBadge`, `cn` from `@/lib/utils`, `ComparisonStats` (Task 2), `HeadToHeadTally` (Task 1, re-declared locally as `HeadToHeadTally` shape to avoid a runtime dependency on Task 1's file — same field names).
- Produces: `ComparisonPlayer = ComparisonStats & { id: string; full_name: string; photo_url: string | null }`, `ComparisonResult = { frames_a: number; frames_b: number; rating_delta_a: number | null; rating_delta_b: number | null }`, `MatchComparisonCard(props: MatchComparisonCardProps)`. Consumed by Task 5 (`FixtureDetailPage`) and Task 7 (`MatchDetailPage`).

- [ ] **Step 1: Write the failing test**

Create `web/src/components/MatchComparisonCard.test.tsx`:

```tsx
// web/src/components/MatchComparisonCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchComparisonCard, type ComparisonPlayer } from './MatchComparisonCard';

const playerA: ComparisonPlayer = {
  id: 'p1',
  full_name: 'Alex Testplayer',
  photo_url: null,
  rating: 1700,
  grade: 'A',
  wins: 5,
  losses: 2,
  win_pct: 71.43,
  form_5: 80,
  form_10: 70,
};

const playerB: ComparisonPlayer = {
  id: 'p2',
  full_name: 'Jordan Testplayer',
  photo_url: null,
  rating: 1550,
  grade: 'B+',
  wins: 3,
  losses: 4,
  win_pct: 42.86,
  form_5: 40,
  form_10: 50,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof MatchComparisonCard>> = {}) {
  return render(
    <MemoryRouter>
      <MatchComparisonCard
        date="2026-03-01"
        playerA={playerA}
        playerB={playerB}
        headToHead={{ winsA: 3, winsB: 1, played: 4 }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('MatchComparisonCard', () => {
  it("renders both players' names, ratings, and grades", () => {
    renderCard();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('1700')).toBeInTheDocument();
    expect(screen.getByText('1550')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B+')).toBeInTheDocument();
  });

  it('links each player name to their profile', () => {
    renderCard();
    expect(screen.getByRole('link', { name: /Alex Testplayer/ })).toHaveAttribute('href', '/players/p1');
    expect(screen.getByRole('link', { name: /Jordan Testplayer/ })).toHaveAttribute('href', '/players/p2');
  });

  it('shows the head-to-head win counts', () => {
    renderCard();
    expect(screen.getByText('3 wins')).toBeInTheDocument();
    expect(screen.getByText('1 wins')).toBeInTheDocument();
  });

  it('shows "No previous meetings" when the two players have never played', () => {
    renderCard({ headToHead: { winsA: 0, winsB: 0, played: 0 } });
    expect(screen.getByText('No previous meetings')).toBeInTheDocument();
  });

  it('does not render a score or rating-change section when no result is given', () => {
    renderCard();
    expect(screen.queryByText('Rating Change')).not.toBeInTheDocument();
  });

  it("renders the score and each player's rating change when result data is given", () => {
    renderCard({ result: { frames_a: 5, frames_b: 2, rating_delta_a: 12.5, rating_delta_b: -12.5 } });
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('+12.5')).toBeInTheDocument();
    expect(screen.getByText('-12.5')).toBeInTheDocument();
    expect(screen.getByText('Rating change from this match')).toBeInTheDocument();
  });

  it('shows a voided-message banner when given one', () => {
    renderCard({ voidedMessage: 'This match was voided.' });
    expect(screen.getByText('This match was voided.')).toBeInTheDocument();
  });

  it('shows a dash for stats the player has none of yet', () => {
    renderCard({
      playerA: { ...playerA, rating: null, grade: null, wins: null, losses: null, win_pct: null, form_5: null, form_10: null },
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/MatchComparisonCard.test.tsx`
Expected: FAIL — `Failed to resolve import "./MatchComparisonCard"`.

- [ ] **Step 3: Implement `MatchComparisonCard`**

Create `web/src/components/MatchComparisonCard.tsx`:

```tsx
// web/src/components/MatchComparisonCard.tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { GradeBadge } from '@/components/GradeBadge';
import { cn } from '@/lib/utils';
import type { ComparisonStats } from '@/hooks/usePlayerComparisonStats';

export interface ComparisonPlayer extends ComparisonStats {
  id: string;
  full_name: string;
  photo_url: string | null;
}

export interface ComparisonResult {
  frames_a: number;
  frames_b: number;
  rating_delta_a: number | null;
  rating_delta_b: number | null;
}

export interface HeadToHeadTally {
  winsA: number;
  winsB: number;
  played: number;
}

export interface MatchComparisonCardProps {
  date: string;
  playerA: ComparisonPlayer;
  playerB: ComparisonPlayer;
  headToHead: HeadToHeadTally;
  result?: ComparisonResult;
  voidedMessage?: string;
}

function dash(value: number | null): string {
  return value === null ? '—' : String(value);
}

function record(player: ComparisonPlayer): string {
  if (player.wins === null || player.losses === null) return '—';
  return `${player.wins}-${player.losses} (${dash(player.win_pct)}%)`;
}

function signedDelta(delta: number | null): string {
  if (delta === null) return '—';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

function StatRow({ label, valueA, valueB }: { label: string; valueA: ReactNode; valueB: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
      <span className="w-28 text-left font-bold tabular-nums">{valueA}</span>
      <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</span>
      <span className="w-28 text-right font-bold tabular-nums">{valueB}</span>
    </div>
  );
}

export function MatchComparisonCard({ date, playerA, playerB, headToHead, result, voidedMessage }: MatchComparisonCardProps) {
  const pctA = headToHead.played === 0 ? 50 : (headToHead.winsA / headToHead.played) * 100;

  return (
    <div className="card-surface overflow-hidden">
      {voidedMessage && (
        <p className="bg-destructive/10 px-4 py-2 text-center text-sm font-semibold text-destructive">
          {voidedMessage}
        </p>
      )}

      <div className="flex items-center justify-between gap-4 px-4 py-5">
        <Link to={`/players/${playerA.id}`} className="flex flex-col items-center gap-2 text-center hover:text-primary">
          <PlayerAvatar name={playerA.full_name} photoUrl={playerA.photo_url} size="lg" />
          <span className="font-bold">{playerA.full_name}</span>
          {playerA.grade && <GradeBadge grade={playerA.grade} />}
        </Link>
        <span className="text-muted-foreground text-sm font-semibold">{date}</span>
        <Link to={`/players/${playerB.id}`} className="flex flex-col items-center gap-2 text-center hover:text-primary">
          <PlayerAvatar name={playerB.full_name} photoUrl={playerB.photo_url} size="lg" />
          <span className="font-bold">{playerB.full_name}</span>
          {playerB.grade && <GradeBadge grade={playerB.grade} />}
        </Link>
      </div>

      {result && (
        <>
          <StatRow label="Score" valueA={result.frames_a} valueB={result.frames_b} />
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  'font-bold tabular-nums',
                  result.rating_delta_a !== null && result.rating_delta_a > 0 && 'text-primary',
                  result.rating_delta_a !== null && result.rating_delta_a < 0 && 'text-destructive',
                )}
              >
                {signedDelta(result.rating_delta_a)}
              </span>
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Rating Change
              </span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  result.rating_delta_b !== null && result.rating_delta_b > 0 && 'text-primary',
                  result.rating_delta_b !== null && result.rating_delta_b < 0 && 'text-destructive',
                )}
              >
                {signedDelta(result.rating_delta_b)}
              </span>
            </div>
            <p className="mt-1 text-center text-xs text-muted-foreground">Rating change from this match</p>
          </div>
        </>
      )}

      <StatRow label="Rating" valueA={dash(playerA.rating)} valueB={dash(playerB.rating)} />
      <StatRow label="Record" valueA={record(playerA)} valueB={record(playerB)} />
      <StatRow label="Form (Last 5)" valueA={dash(playerA.form_5)} valueB={dash(playerB.form_5)} />
      <StatRow label="Form (Last 10)" valueA={dash(playerA.form_10)} valueB={dash(playerB.form_10)} />

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{headToHead.winsA} wins</span>
          <span>Head-to-Head</span>
          <span>{headToHead.winsB} wins</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${pctA}%` }} />
          <div className="bg-destructive/60" style={{ width: `${100 - pctA}%` }} />
        </div>
        {headToHead.played === 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">No previous meetings</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/MatchComparisonCard.test.tsx`
Expected: PASS (8/8 tests)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/MatchComparisonCard.tsx web/src/components/MatchComparisonCard.test.tsx
git commit -m "feat: add MatchComparisonCard component"
```

---

### Task 4: `useFixture` hook (single fixture by id)

**Files:**
- Create: `web/src/hooks/useFixture.ts`
- Test: `web/src/hooks/useFixture.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.fixtureDetail`, `resolvePlayerPhotoUrls`/`pickResolvedUrl` from `@/lib/playerPhotos`, `FixtureStatus` from `./useFixtures`.
- Produces: `FixtureDetail = { id: string; season_id: string; scheduled_date: string; status: FixtureStatus; player_a: {...}; player_b: {...} } `, `useFixture(fixtureId: string | undefined)` returning `FixtureDetail | null` on success. Consumed by Task 5 (`FixtureDetailPage`).

- [ ] **Step 1: Add the `fixtureDetail` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after `playerComparisonStats`:

```ts
  playerComparisonStats: (playerId: string, seasonId: string) => ['playerComparisonStats', playerId, seasonId] as const,
  fixtureDetail: (fixtureId: string) => ['fixtureDetail', fixtureId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useFixture.test.tsx`:

```tsx
// web/src/hooks/useFixture.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  },
}));

import { useFixture } from './useFixture';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const ROW = {
  id: 'f1',
  season_id: 's1',
  scheduled_date: '2026-08-01',
  status: 'scheduled',
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
};

describe('useFixture', () => {
  beforeEach(() => {
    mockMaybeSingle.mockReset();
  });

  it('returns the fixture with both players resolved', async () => {
    mockMaybeSingle.mockResolvedValue({ data: ROW, error: null });

    const { result } = renderHook(() => useFixture('f1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ROW);
  });

  it('returns null when no fixture matches the given id', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const { result } = renderHook(() => useFixture('missing'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a fixtureId is provided', () => {
    const { result } = renderHook(() => useFixture(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });

    const { result } = renderHook(() => useFixture('f1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useFixture.test.tsx`
Expected: FAIL — `Failed to resolve import "./useFixture"`.

- [ ] **Step 4: Implement `useFixture`**

Create `web/src/hooks/useFixture.ts`:

```ts
// web/src/hooks/useFixture.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';
import type { FixtureStatus } from './useFixtures';

export interface FixtureDetail {
  id: string;
  season_id: string;
  scheduled_date: string;
  status: FixtureStatus;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
}

export function useFixture(fixtureId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.fixtureDetail(fixtureId ?? ''),
    queryFn: async (): Promise<FixtureDetail | null> => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(
          'id, season_id, scheduled_date, status, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
        )
        .eq('id', fixtureId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const row = data as unknown as FixtureDetail;
      const photoUrlByPath = await resolvePlayerPhotoUrls([row.player_a.photo_url, row.player_b.photo_url]);
      return {
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
      };
    },
    enabled: fixtureId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useFixture.test.tsx`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useFixture.ts web/src/hooks/useFixture.test.tsx
git commit -m "feat: add useFixture hook"
```

---

### Task 5: `FixtureDetailPage` and its route

**Files:**
- Create: `web/src/pages/FixtureDetail.tsx`
- Test: `web/src/pages/FixtureDetail.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useFixture` (Task 4), `usePlayerComparisonStats` (Task 2), `useHeadToHead` (Task 1), `MatchComparisonCard` (Task 3).
- Produces: `FixtureDetailPage` mounted at `/fixtures/:id`. No exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/FixtureDetail.test.tsx`:

```tsx
// web/src/pages/FixtureDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseFixture = vi.fn();
const mockUsePlayerComparisonStats = vi.fn();
const mockUseHeadToHead = vi.fn();

vi.mock('@/hooks/useFixture', () => ({ useFixture: (id: string | undefined) => mockUseFixture(id) }));
vi.mock('@/hooks/usePlayerComparisonStats', () => ({
  usePlayerComparisonStats: (playerId: string | undefined, seasonId: string | undefined) =>
    mockUsePlayerComparisonStats(playerId, seasonId),
}));
vi.mock('@/hooks/useHeadToHead', () => ({
  useHeadToHead: (a: string | undefined, b: string | undefined) => mockUseHeadToHead(a, b),
}));

import { FixtureDetailPage } from './FixtureDetail';

const FIXTURE = {
  id: 'f1',
  season_id: 's1',
  scheduled_date: '2026-08-01',
  status: 'scheduled' as const,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
};
const STATS_A = { rating: 1700, grade: 'A' as const, wins: 5, losses: 2, win_pct: 71.43, form_5: 80, form_10: 70 };
const STATS_B = { rating: 1550, grade: 'B+' as const, wins: 3, losses: 4, win_pct: 42.86, form_5: 40, form_10: 50 };

function statsFor(playerId: string | undefined) {
  return playerId === 'p1'
    ? { data: STATS_A, isLoading: false, isError: false }
    : { data: STATS_B, isLoading: false, isError: false };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/fixtures/f1']}>
        <Routes>
          <Route path="/fixtures/:id" element={<FixtureDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FixtureDetailPage', () => {
  it("renders the comparison card once the fixture and both players' stats have loaded", () => {
    mockUseFixture.mockReturnValue({ data: FIXTURE, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('1700')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the fixture is loading', () => {
    mockUseFixture.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message when the fixture fails to load', () => {
    mockUseFixture.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this fixture. Try refreshing.")).toBeInTheDocument();
  });

  it('shows an error message when no fixture matches the id', () => {
    mockUseFixture.mockReturnValue({ data: null, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this fixture. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a voided message when the fixture was cancelled', () => {
    mockUseFixture.mockReturnValue({ data: { ...FIXTURE, status: 'voided' }, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('This fixture was cancelled.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/FixtureDetail.test.tsx`
Expected: FAIL — `Failed to resolve import "./FixtureDetail"`.

- [ ] **Step 3: Implement `FixtureDetailPage`**

Create `web/src/pages/FixtureDetail.tsx`:

```tsx
// web/src/pages/FixtureDetail.tsx
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchComparisonCard } from '@/components/MatchComparisonCard';
import { useFixture } from '@/hooks/useFixture';
import { usePlayerComparisonStats } from '@/hooks/usePlayerComparisonStats';
import { useHeadToHead } from '@/hooks/useHeadToHead';

export function FixtureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const fixture = useFixture(id);
  const playerAStats = usePlayerComparisonStats(fixture.data?.player_a.id, fixture.data?.season_id);
  const playerBStats = usePlayerComparisonStats(fixture.data?.player_b.id, fixture.data?.season_id);
  const headToHead = useHeadToHead(fixture.data?.player_a.id, fixture.data?.player_b.id);

  if (fixture.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (fixture.isError || !fixture.data) {
    return <p className="text-destructive">Couldn't load this fixture. Try refreshing.</p>;
  }

  if (playerAStats.isLoading || playerBStats.isLoading || headToHead.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (playerAStats.isError || playerBStats.isError || headToHead.isError || !playerAStats.data || !playerBStats.data) {
    return <p className="text-destructive">Couldn't load this fixture. Try refreshing.</p>;
  }

  return (
    <MatchComparisonCard
      date={fixture.data.scheduled_date}
      playerA={{ ...fixture.data.player_a, ...playerAStats.data }}
      playerB={{ ...fixture.data.player_b, ...playerBStats.data }}
      headToHead={headToHead.data ?? { winsA: 0, winsB: 0, played: 0 }}
      voidedMessage={fixture.data.status === 'voided' ? 'This fixture was cancelled.' : undefined}
    />
  );
}
```

- [ ] **Step 4: Register the route**

Edit `web/src/App.tsx` — add the import and the route inside the existing `<Route element={<AuthRouteGuard />}>` block, right after `/matches`:

```tsx
import { FixtureDetailPage } from '@/pages/FixtureDetail';
```

```tsx
            <Route path="/matches" element={<MatchHistoryPage />} />
            <Route path="/fixtures/:id" element={<FixtureDetailPage />} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/FixtureDetail.test.tsx`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/FixtureDetail.tsx web/src/pages/FixtureDetail.test.tsx web/src/App.tsx
git commit -m "feat: add FixtureDetailPage at /fixtures/:id"
```

---

### Task 6: `useMatch` hook (single match by id, with rating delta)

**Files:**
- Create: `web/src/hooks/useMatch.ts`
- Test: `web/src/hooks/useMatch.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

**Interfaces:**
- Consumes: `supabase` client, `queryKeys.matchDetail`, `resolvePlayerPhotoUrls`/`pickResolvedUrl` from `@/lib/playerPhotos`.
- Produces: `MatchDetail = { id, season_id, match_date, frames_a, frames_b, winner_id, is_voided, player_a, player_b, rating_delta_a: number | null, rating_delta_b: number | null }`, `useMatch(matchId: string | undefined)` returning `MatchDetail | null` on success. Consumed by Task 7 (`MatchDetailPage`).

- [ ] **Step 1: Add the `matchDetail` query key**

Edit `web/src/lib/queryKeys.ts` — add one line after `fixtureDetail`:

```ts
  fixtureDetail: (fixtureId: string) => ['fixtureDetail', fixtureId] as const,
  matchDetail: (matchId: string) => ['matchDetail', matchId] as const,
```

- [ ] **Step 2: Write the failing test**

Create `web/src/hooks/useMatch.test.tsx`:

```tsx
// web/src/hooks/useMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMatchMaybeSingle = vi.fn();
const mockEventsEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'matches') {
        return { select: () => ({ eq: () => ({ maybeSingle: mockMatchMaybeSingle }) }) };
      }
      if (table === 'rating_events') {
        return { select: () => ({ eq: () => ({ eq: mockEventsEq }) }) };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { useMatch } from './useMatch';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const MATCH_ROW = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-03-01',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
};

describe('useMatch', () => {
  beforeEach(() => {
    mockMatchMaybeSingle.mockReset();
    mockEventsEq.mockReset();
  });

  it("combines the match with each player's instant rating delta from that match", async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: MATCH_ROW, error: null });
    mockEventsEq.mockResolvedValue({
      data: [
        { player_id: 'p1', delta: 12.5 },
        { player_id: 'p2', delta: -12.5 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ...MATCH_ROW, rating_delta_a: 12.5, rating_delta_b: -12.5 });
  });

  it('returns null rating deltas when no instant rating_events exist for this match', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: MATCH_ROW, error: null });
    mockEventsEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rating_delta_a).toBeNull();
    expect(result.current.data?.rating_delta_b).toBeNull();
  });

  it('returns null when no match matches the given id', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockEventsEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('missing'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('stays disabled until a matchId is provided', () => {
    const { result } = renderHook(() => useMatch(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockMatchMaybeSingle).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error from the match query', async () => {
    mockMatchMaybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    mockEventsEq.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useMatch('m1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useMatch.test.tsx`
Expected: FAIL — `Failed to resolve import "./useMatch"`.

- [ ] **Step 4: Implement `useMatch`**

Create `web/src/hooks/useMatch.ts`:

```ts
// web/src/hooks/useMatch.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import { resolvePlayerPhotoUrls, pickResolvedUrl } from '@/lib/playerPhotos';

export interface MatchDetail {
  id: string;
  season_id: string;
  match_date: string;
  frames_a: number;
  frames_b: number;
  winner_id: string;
  is_voided: boolean;
  player_a: { id: string; full_name: string; photo_url: string | null };
  player_b: { id: string; full_name: string; photo_url: string | null };
  rating_delta_a: number | null;
  rating_delta_b: number | null;
}

export function useMatch(matchId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.matchDetail(matchId ?? ''),
    queryFn: async (): Promise<MatchDetail | null> => {
      const [matchRes, eventsRes] = await Promise.all([
        supabase
          .from('matches')
          .select(
            'id, season_id, match_date, frames_a, frames_b, winner_id, is_voided, player_a:player_a_id(id, full_name, photo_url), player_b:player_b_id(id, full_name, photo_url)',
          )
          .eq('id', matchId as string)
          .maybeSingle(),
        supabase
          .from('rating_events')
          .select('player_id, delta')
          .eq('match_id', matchId as string)
          .eq('event_type', 'instant'),
      ]);
      if (matchRes.error) throw matchRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (!matchRes.data) return null;

      const row = matchRes.data as unknown as Omit<MatchDetail, 'rating_delta_a' | 'rating_delta_b'>;
      const events = eventsRes.data as { player_id: string; delta: number }[];
      const deltaFor = (playerId: string) => events.find((event) => event.player_id === playerId)?.delta ?? null;

      const photoUrlByPath = await resolvePlayerPhotoUrls([row.player_a.photo_url, row.player_b.photo_url]);
      return {
        ...row,
        player_a: { ...row.player_a, photo_url: pickResolvedUrl(photoUrlByPath, row.player_a.photo_url) },
        player_b: { ...row.player_b, photo_url: pickResolvedUrl(photoUrlByPath, row.player_b.photo_url) },
        rating_delta_a: deltaFor(row.player_a.id),
        rating_delta_b: deltaFor(row.player_b.id),
      };
    },
    enabled: matchId !== undefined,
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useMatch.test.tsx`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/queryKeys.ts web/src/hooks/useMatch.ts web/src/hooks/useMatch.test.tsx
git commit -m "feat: add useMatch hook"
```

---

### Task 7: `MatchDetailPage` and its route

**Files:**
- Create: `web/src/pages/MatchDetail.tsx`
- Test: `web/src/pages/MatchDetail.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useMatch` (Task 6), `usePlayerComparisonStats` (Task 2), `useHeadToHead` (Task 1), `MatchComparisonCard` (Task 3).
- Produces: `MatchDetailPage` mounted at `/matches/:id`. No exports consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `web/src/pages/MatchDetail.test.tsx`:

```tsx
// web/src/pages/MatchDetail.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseMatch = vi.fn();
const mockUsePlayerComparisonStats = vi.fn();
const mockUseHeadToHead = vi.fn();

vi.mock('@/hooks/useMatch', () => ({ useMatch: (id: string | undefined) => mockUseMatch(id) }));
vi.mock('@/hooks/usePlayerComparisonStats', () => ({
  usePlayerComparisonStats: (playerId: string | undefined, seasonId: string | undefined) =>
    mockUsePlayerComparisonStats(playerId, seasonId),
}));
vi.mock('@/hooks/useHeadToHead', () => ({
  useHeadToHead: (a: string | undefined, b: string | undefined) => mockUseHeadToHead(a, b),
}));

import { MatchDetailPage } from './MatchDetail';

const MATCH = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-03-01',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
  rating_delta_a: 12.5,
  rating_delta_b: -12.5,
};
const STATS_A = { rating: 1700, grade: 'A' as const, wins: 5, losses: 2, win_pct: 71.43, form_5: 80, form_10: 70 };
const STATS_B = { rating: 1550, grade: 'B+' as const, wins: 3, losses: 4, win_pct: 42.86, form_5: 40, form_10: 50 };

function statsFor(playerId: string | undefined) {
  return playerId === 'p1'
    ? { data: STATS_A, isLoading: false, isError: false }
    : { data: STATS_B, isLoading: false, isError: false };
}

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/matches/m1']}>
        <Routes>
          <Route path="/matches/:id" element={<MatchDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchDetailPage', () => {
  it("renders the comparison card with the score and each player's rating change", () => {
    mockUseMatch.mockReturnValue({ data: MATCH, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('+12.5')).toBeInTheDocument();
    expect(screen.getByText('-12.5')).toBeInTheDocument();
    expect(screen.getByText('Rating change from this match')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the match is loading', () => {
    mockUseMatch.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    const { container } = renderPage();
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows an error message when the match fails to load', () => {
    mockUseMatch.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this match. Try refreshing.")).toBeInTheDocument();
  });

  it('shows an error message when no match matches the id', () => {
    mockUseMatch.mockReturnValue({ data: null, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    mockUseHeadToHead.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    renderPage();
    expect(screen.getByText("Couldn't load this match. Try refreshing.")).toBeInTheDocument();
  });

  it('shows a voided-match warning when the match was voided', () => {
    mockUseMatch.mockReturnValue({ data: { ...MATCH, is_voided: true }, isLoading: false, isError: false });
    mockUsePlayerComparisonStats.mockImplementation((playerId: string | undefined) => statsFor(playerId));
    mockUseHeadToHead.mockReturnValue({ data: { winsA: 3, winsB: 1, played: 4 }, isLoading: false, isError: false });

    renderPage();
    expect(
      screen.getByText('This match was voided — these stats may not reflect the current record.'),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/MatchDetail.test.tsx`
Expected: FAIL — `Failed to resolve import "./MatchDetail"`.

- [ ] **Step 3: Implement `MatchDetailPage`**

Create `web/src/pages/MatchDetail.tsx`:

```tsx
// web/src/pages/MatchDetail.tsx
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { MatchComparisonCard } from '@/components/MatchComparisonCard';
import { useMatch } from '@/hooks/useMatch';
import { usePlayerComparisonStats } from '@/hooks/usePlayerComparisonStats';
import { useHeadToHead } from '@/hooks/useHeadToHead';

export function MatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const match = useMatch(id);
  const playerAStats = usePlayerComparisonStats(match.data?.player_a.id, match.data?.season_id);
  const playerBStats = usePlayerComparisonStats(match.data?.player_b.id, match.data?.season_id);
  const headToHead = useHeadToHead(match.data?.player_a.id, match.data?.player_b.id);

  if (match.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (match.isError || !match.data) {
    return <p className="text-destructive">Couldn't load this match. Try refreshing.</p>;
  }

  if (playerAStats.isLoading || playerBStats.isLoading || headToHead.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (playerAStats.isError || playerBStats.isError || headToHead.isError || !playerAStats.data || !playerBStats.data) {
    return <p className="text-destructive">Couldn't load this match. Try refreshing.</p>;
  }

  return (
    <MatchComparisonCard
      date={match.data.match_date}
      playerA={{ ...match.data.player_a, ...playerAStats.data }}
      playerB={{ ...match.data.player_b, ...playerBStats.data }}
      headToHead={headToHead.data ?? { winsA: 0, winsB: 0, played: 0 }}
      result={{
        frames_a: match.data.frames_a,
        frames_b: match.data.frames_b,
        rating_delta_a: match.data.rating_delta_a,
        rating_delta_b: match.data.rating_delta_b,
      }}
      voidedMessage={
        match.data.is_voided ? 'This match was voided — these stats may not reflect the current record.' : undefined
      }
    />
  );
}
```

- [ ] **Step 4: Register the route**

Edit `web/src/App.tsx` — add the import and the route right after `/fixtures/:id`:

```tsx
import { MatchDetailPage } from '@/pages/MatchDetail';
```

```tsx
            <Route path="/fixtures/:id" element={<FixtureDetailPage />} />
            <Route path="/matches/:id" element={<MatchDetailPage />} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/MatchDetail.test.tsx`
Expected: PASS (5/5 tests)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/MatchDetail.tsx web/src/pages/MatchDetail.test.tsx web/src/App.tsx
git commit -m "feat: add MatchDetailPage at /matches/:id"
```

---

### Task 8: Wire up entry points from Match History

**Files:**
- Modify: `web/src/pages/MatchHistory.tsx`
- Modify: `web/src/pages/MatchHistory.test.tsx`
- Modify: `web/src/components/MatchTable.tsx`
- Modify: `web/src/components/MatchTable.test.tsx`

**Interfaces:**
- Consumes: nothing new — only adds `Link`s to routes already registered in Tasks 5 and 7.
- Produces: nothing new exported. Every fixture row in the Fixtures tab and every result row in the Results tab becomes a link into the comparison view.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `web/src/pages/MatchHistory.test.tsx`, right after the existing `'shows a "no fixtures scheduled yet"...'` test (before the closing `});` of the `describe` block):

```tsx
  it('links a scheduled fixture row to its fixture detail page', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2099-01-01', status: 'scheduled', completed_match_id: null,
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: /Sam Newcomer/ })).toHaveAttribute('href', '/fixtures/f1');
  });

  it('links a completed fixture row to its resulting match, not the fixture page', async () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    mockUseFixtures.mockReturnValue({
      data: [
        {
          id: 'f1', season_id: 's1', scheduled_date: '2026-01-01', status: 'completed', completed_match_id: 'm9',
          player_a: { id: 'p3', full_name: 'Sam Newcomer', photo_url: null },
          player_b: { id: 'p4', full_name: 'Riley Scheduled', photo_url: null },
        },
      ],
      isLoading: false,
      isError: false,
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Fixtures' }));

    expect(screen.getByRole('link', { name: /Sam Newcomer/ })).toHaveAttribute('href', '/matches/m9');
  });
```

Add this test to `web/src/components/MatchTable.test.tsx`, right after the existing `'marks voided matches...'` test:

```tsx
  it('links the score to that match’s detail page', () => {
    render(<MatchTable matches={matches} />, { wrapper: MemoryRouter });
    expect(screen.getByRole('link', { name: '5–2' })).toHaveAttribute('href', '/matches/m1');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx src/components/MatchTable.test.tsx`
Expected: FAIL — the two new `MatchHistory.test.tsx` tests fail because fixture rows have no link yet; the new `MatchTable.test.tsx` test fails because the score isn't a link yet. Every other test in both files still passes.

- [ ] **Step 3: Wrap each fixture row's content in a link to its detail page**

Edit `web/src/pages/MatchHistory.tsx` — replace the `<li>` body inside `FixturesList` (the `<span>` for the date through the closing `</div>` of the players row) with a `Link` wrapping both:

```tsx
        <li
          key={fixture.id}
          className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <Link
            to={
              fixture.status === 'completed' && fixture.completed_match_id
                ? `/matches/${fixture.completed_match_id}`
                : `/fixtures/${fixture.id}`
            }
            className="flex flex-1 flex-wrap items-center gap-3 hover:text-primary"
          >
            <span className="text-muted-foreground w-24 text-sm">{fixture.scheduled_date}</span>
            <div className="flex flex-1 items-center gap-2">
              <PlayerAvatar name={fixture.player_a.full_name} photoUrl={fixture.player_a.photo_url} size="sm" />
              <span className="font-semibold">{fixture.player_a.full_name}</span>
              <span className="text-muted-foreground text-xs">vs</span>
              <PlayerAvatar name={fixture.player_b.full_name} photoUrl={fixture.player_b.photo_url} size="sm" />
              <span className="font-semibold">{fixture.player_b.full_name}</span>
            </div>
          </Link>
          {fixture.status === 'voided' && (
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">Voided</span>
          )}
          {fixture.status === 'completed' && (
            <span className="text-primary text-xs font-semibold uppercase tracking-wider">Completed</span>
          )}
          {isOverdue(fixture) && (
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold uppercase text-destructive">
              Overdue
            </span>
          )}
          {isAdmin && fixture.status === 'scheduled' && (
            <div className="flex gap-3">
              <Link
                to={`/admin/enter-match?fixtureId=${fixture.id}`}
                className="text-primary text-xs font-semibold hover:underline"
              >
                Enter Result
              </Link>
              <button
                type="button"
                onClick={() => handleVoid(fixture.id)}
                className="text-destructive text-xs font-semibold hover:underline"
              >
                Void
              </button>
            </div>
          )}
        </li>
```

(`Link` is already imported in this file — no import changes needed.)

- [ ] **Step 4: Make the score cell a link to the match detail page**

Edit `web/src/components/MatchTable.tsx` — replace the score `<td>`:

```tsx
              <td className="px-4 py-3 font-bold tabular-nums">
                {match.frames_a}–{match.frames_b}
                {match.is_voided && <span className="ml-2 text-xs font-normal italic">(voided)</span>}
              </td>
```

with:

```tsx
              <td className="px-4 py-3 font-bold tabular-nums">
                <Link to={`/matches/${match.id}`} className="hover:text-primary hover:underline">
                  {match.frames_a}–{match.frames_b}
                </Link>
                {match.is_voided && <span className="ml-2 text-xs font-normal italic">(voided)</span>}
              </td>
```

(`Link` is already imported in this file — no import changes needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx src/components/MatchTable.test.tsx`
Expected: PASS (9/9 in `MatchHistory.test.tsx`, 4/4 in `MatchTable.test.tsx`)

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/MatchHistory.tsx web/src/pages/MatchHistory.test.tsx web/src/components/MatchTable.tsx web/src/components/MatchTable.test.tsx
git commit -m "feat: link fixtures and results to the match comparison view"
```

---

### Task 9: Full-suite final check

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full frontend suite**

Run: `cd web && npm test`
Expected: All test files pass. This branch adds 8 new test files (Tasks 1–7) and modifies 2 (Task 8) on top of the existing suite.

- [ ] **Step 2: Run the TypeScript build check**

Run: `cd web && npx tsc -b`
Expected: No output, exit code 0.

- [ ] **Step 3: Confirm the root suite is unaffected**

This plan makes no backend/migration/Edge Function changes, so the root suite should be identical to its state before this plan started. Confirm anyway:

Run (from repo root): `npm test`
Expected: All of `test:unit`, `test:integration`, and `test:api` pass, unchanged from before this plan.

If any command reports a failure, fix it directly before considering this task complete. If a failure looks flaky rather than real (a single test timing out under load), re-run that one file alone before concluding it's a genuine regression, per this repo's own documented testing discipline.

- [ ] **Step 4: Commit any fixes from Steps 1–3, if needed**

Only run this if a fix was required:

```bash
git add -A
git commit -m "fix: address full-suite/tsc-b findings from match comparison view"
```
