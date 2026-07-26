# Season Selector & Pill Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `useActiveSeason()`'s hard-throw-on-no-active-season with a `useSeasonSelector()` hook that always defaults to the most recent season, across every "browsing" page (Leaderboard, Grades, Matches get a visible pill switcher; PlayerProfile, Settings, admin/ManagePlayers get the same default silently, no switcher UI).

**Architecture:** One new hook (`useSeasonSelector`, wrapping the existing `useSeasons()`) becomes the single source of "which season am I looking at" for six pages. Three of them additionally render a new presentational `SeasonPillSwitcher` component driven by that hook's return value. `useActiveSeason()` itself is untouched — this plan is purely additive, migrating callers off it one at a time.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, Vitest + `@testing-library/react`, existing shadcn/ui `Select`, lucide-react icons.

## Global Constraints

- Default season = `seasons[0]` from `useSeasons()` (already ordered by `start_date` descending) — the most recent one, whether `'active'` or `'completed'`.
- No URL/query-param persistence — the selected season is in-memory component state, resets to the default on refresh.
- The pill switcher (‹ name [Active badge] ▾ ›) is rendered **only** on Leaderboard, GradeDistribution, and MatchHistory. PlayerProfile, Settings, and admin/ManagePlayers consume the same hook and get the same default-to-most-recent behavior, but render no switcher UI.
- A season with `status === 'active'` shows an "Active" badge in the pill; any other status shows no badge.
- When there are zero seasons in the database at all, browsing pages show an explicit "No seasons exist yet." message — distinct from both the loading skeleton and the destructive-text error message.
- `useActiveSeason.ts` is not modified or deleted in this plan — `admin/EnterMatch.tsx`, `admin/CorrectMatch.tsx`, and `admin/CloseWeek.tsx` keep using it directly and are not touched.
- `useLeaderboard`, `useGradeDistribution`, `useMatchHistory`, `usePlayerProfile`, `usePlayers` — all unchanged, still take the same `seasonId: string | undefined` parameter they do today; only the source of that id changes.

---

### Task 1: `useSeasonSelector` hook

**Files:**
- Create: `web/src/hooks/useSeasonSelector.ts`
- Test: `web/src/hooks/useSeasonSelector.test.tsx`

**Interfaces:**
- Consumes: `useSeasons()` from `@/hooks/useSeasons` (existing, unchanged — returns `{ data: Season[] | undefined, isLoading, isError }`, already ordered by `start_date` descending).
- Produces (used by every later task in this plan):
  ```ts
  interface UseSeasonSelectorResult {
    selectedSeason: Season | null;
    selectedSeasonId: string | undefined;
    seasons: Season[];
    isLoading: boolean;
    isError: boolean;
    selectSeason: (seasonId: string) => void;
    selectPrevious: () => void;
    selectNext: () => void;
    hasPrevious: boolean;
    hasNext: boolean;
  }
  export function useSeasonSelector(): UseSeasonSelectorResult;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/hooks/useSeasonSelector.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockUseSeasons = vi.fn();
vi.mock('@/hooks/useSeasons', () => ({ useSeasons: () => mockUseSeasons() }));

import { useSeasonSelector } from './useSeasonSelector';

const SEASONS = [
  { id: 's3', name: 'Season 3', start_date: '2026-06-01', end_date: null, status: 'active' as const },
  { id: 's2', name: 'Season 2', start_date: '2026-03-01', end_date: '2026-05-31', status: 'completed' as const },
  { id: 's1', name: 'Season 1', start_date: '2026-01-01', end_date: '2026-02-28', status: 'completed' as const },
];

describe('useSeasonSelector', () => {
  beforeEach(() => {
    mockUseSeasons.mockReset();
  });

  it('defaults to the most recent season once seasons load', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.selectedSeason?.id).toBe('s3');
    expect(result.current.selectedSeasonId).toBe('s3');
  });

  it('leaves selectedSeasonId unset when there are no seasons at all', () => {
    mockUseSeasons.mockReturnValue({ data: [], isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.selectedSeason).toBeNull();
    expect(result.current.selectedSeasonId).toBeUndefined();
  });

  it('selectSeason switches to an explicit season', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());

    act(() => {
      result.current.selectSeason('s1');
    });

    expect(result.current.selectedSeason?.id).toBe('s1');
  });

  it('selectPrevious/selectNext step chronologically and stop at either end', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());

    expect(result.current.selectedSeasonId).toBe('s3');
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s2');
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s1');
    expect(result.current.hasPrevious).toBe(false);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s1');

    act(() => {
      result.current.selectNext();
    });
    expect(result.current.selectedSeasonId).toBe('s2');
  });

  it('surfaces loading/error state from useSeasons', () => {
    mockUseSeasons.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.isLoading).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/hooks/useSeasonSelector.test.tsx`
Expected: FAIL — `Cannot find module './useSeasonSelector'`.

- [ ] **Step 3: Write the implementation**

```ts
// web/src/hooks/useSeasonSelector.ts
import { useState } from 'react';
import { useSeasons } from '@/hooks/useSeasons';
import type { Season } from '@/lib/types';

export interface UseSeasonSelectorResult {
  selectedSeason: Season | null;
  selectedSeasonId: string | undefined;
  seasons: Season[];
  isLoading: boolean;
  isError: boolean;
  selectSeason: (seasonId: string) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function useSeasonSelector(): UseSeasonSelectorResult {
  const seasonsQuery = useSeasons();
  const [explicitSeasonId, setExplicitSeasonId] = useState<string | undefined>(undefined);

  const seasons = seasonsQuery.data ?? [];
  const selectedSeasonId = explicitSeasonId ?? seasons[0]?.id;
  const selectedIndex = seasons.findIndex((season) => season.id === selectedSeasonId);
  const selectedSeason = selectedIndex === -1 ? null : seasons[selectedIndex];

  function selectSeason(seasonId: string): void {
    setExplicitSeasonId(seasonId);
  }

  function selectPrevious(): void {
    if (selectedIndex === -1 || selectedIndex >= seasons.length - 1) return;
    setExplicitSeasonId(seasons[selectedIndex + 1].id);
  }

  function selectNext(): void {
    if (selectedIndex <= 0) return;
    setExplicitSeasonId(seasons[selectedIndex - 1].id);
  }

  return {
    selectedSeason,
    selectedSeasonId,
    seasons,
    isLoading: seasonsQuery.isLoading,
    isError: seasonsQuery.isError,
    selectSeason,
    selectPrevious,
    selectNext,
    hasPrevious: selectedIndex !== -1 && selectedIndex < seasons.length - 1,
    hasNext: selectedIndex > 0,
  };
}
```

This lazy default (`explicitSeasonId ?? seasons[0]?.id`) is computed fresh on every render from the current `seasons` data — no `useEffect`, no lazy `useState` initializer, so there is nothing here that could repeat the StrictMode-impure-initializer trap this codebase has hit before (see `docs/superpowers/plans/2026-07-26-idle-session-timeout.md`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useSeasonSelector.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useSeasonSelector.ts web/src/hooks/useSeasonSelector.test.tsx
git commit -m "feat: add useSeasonSelector hook defaulting to the most recent season"
```

---

### Task 2: `SeasonPillSwitcher` component

**Files:**
- Create: `web/src/components/SeasonPillSwitcher.tsx`
- Test: `web/src/components/SeasonPillSwitcher.test.tsx`

**Interfaces:**
- Consumes: nothing from `useSeasonSelector()` directly — it's a pure presentational component driven entirely by props (so it's testable without mocking any hook, and any of the three switcher pages just spreads the relevant fields from `useSeasonSelector()`'s return value into it).
- Produces (used by Tasks 3-5):
  ```ts
  export interface SeasonPillSwitcherProps {
    selectedSeason: Season | null;
    seasons: Season[];
    onSelectSeason: (seasonId: string) => void;
    onPrevious: () => void;
    onNext: () => void;
    hasPrevious: boolean;
    hasNext: boolean;
  }
  export function SeasonPillSwitcher(props: SeasonPillSwitcherProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/components/SeasonPillSwitcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonPillSwitcher } from './SeasonPillSwitcher';

const SEASONS = [
  { id: 's2', name: 'Season 2026', start_date: '2026-06-01', end_date: null, status: 'active' as const },
  { id: 's1', name: 'Season 2025', start_date: '2025-01-01', end_date: '2025-12-31', status: 'completed' as const },
];

describe('SeasonPillSwitcher', () => {
  it('renders nothing when there is no selected season', () => {
    const { container } = render(
      <SeasonPillSwitcher
        selectedSeason={null}
        seasons={[]}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the season name and an Active badge when the selected season is active', () => {
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[0]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious
        hasNext={false}
      />,
    );
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('does not show the Active badge for a completed season', () => {
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[1]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext
      />,
    );
    expect(screen.getByText('Season 2025')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('disables the previous button when hasPrevious is false, and calls onNext when the next button is clicked', async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[1]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious={false}
        hasNext
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous season' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next season' }));
    expect(onNext).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/components/SeasonPillSwitcher.test.tsx`
Expected: FAIL — `Cannot find module './SeasonPillSwitcher'`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/SeasonPillSwitcher.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Season } from '@/lib/types';

export interface SeasonPillSwitcherProps {
  selectedSeason: Season | null;
  seasons: Season[];
  onSelectSeason: (seasonId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function SeasonPillSwitcher({
  selectedSeason,
  seasons,
  onSelectSeason,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: SeasonPillSwitcherProps) {
  if (!selectedSeason) return null;

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Previous season"
        disabled={!hasPrevious}
        onClick={onPrevious}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <Select value={selectedSeason.id} onValueChange={onSelectSeason}>
        <SelectTrigger className="h-auto w-auto gap-2 rounded-full border-border bg-card px-4 py-1.5">
          <SelectValue>
            <span className="flex items-center gap-2 text-sm font-bold">
              {selectedSeason.name}
              {selectedSeason.status === 'active' && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  Active
                </span>
              )}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {seasons.map((season) => (
            <SelectItem key={season.id} value={season.id}>
              {season.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        aria-label="Next season"
        disabled={!hasNext}
        onClick={onNext}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/SeasonPillSwitcher.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SeasonPillSwitcher.tsx web/src/components/SeasonPillSwitcher.test.tsx
git commit -m "feat: add SeasonPillSwitcher component"
```

---

### Task 3: Wire into `Leaderboard.tsx`

**Files:**
- Modify: `web/src/pages/Leaderboard.tsx`
- Modify: `web/src/pages/Leaderboard.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1), `SeasonPillSwitcher` (Task 2).

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/Leaderboard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useLeaderboard', () => ({
  useLeaderboard: () => ({
    data: [
      { player_id: 'p1', full_name: 'Alex Testplayer', season_id: 's1', rating: 1768, grade: 'A+', season_points: 142, rank: 1 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { LeaderboardPage } from './Leaderboard';

const SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof SEASON | null, seasons: (typeof SEASON)[]) {
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
        <LeaderboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('LeaderboardPage', () => {
  it('renders a row per leaderboard entry with a link to the player profile, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Alex Testplayer/ });
    expect(link).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run (from `web/`): `npx vitest run src/pages/Leaderboard.test.tsx`
Expected: the first test FAILS (`useActiveSeason` mock no longer matches what the page imports); the second is new and also fails.

- [ ] **Step 3: Update `Leaderboard.tsx`**

```tsx
// web/src/pages/Leaderboard.tsx
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { cn } from '@/lib/utils';

const RANK_STYLES: Record<number, string> = {
  1: 'bg-primary text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.45)]',
  2: 'bg-accent text-accent-foreground',
  3: 'bg-fpl-magenta text-white',
};

export function LeaderboardPage() {
  const seasonSelector = useSeasonSelector();
  const leaderboard = useLeaderboard(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load the leaderboard. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (leaderboard.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (leaderboard.isError) {
    return <p className="text-destructive">Couldn't load the leaderboard. Try refreshing.</p>;
  }

  const entries = leaderboard.data ?? [];

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
        <h1 className="text-3xl font-extrabold sm:text-4xl">Leaderboard</h1>
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active players yet.</p>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="text-muted-foreground grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]">
          <span>#</span>
          <span>Player</span>
          <span className="text-center">Grade</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Pts</span>
          </div>
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.player_id}
                className={cn(
                  'grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-foreground/5 sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]',
                  entry.rank <= 3 && 'bg-foreground/[0.03]',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold',
                    RANK_STYLES[entry.rank] ?? 'bg-foreground/10 text-foreground',
                  )}
                >
                  {entry.rank}
                </span>
                <Link
                  to={`/players/${entry.player_id}`}
                  className="group flex min-w-0 items-center gap-3"
                >
                  <PlayerAvatar name={entry.full_name} photoUrl={entry.photo_url} size="md" />
                  <span className="truncate font-semibold group-hover:text-primary">
                    {entry.full_name}
                  </span>
                </Link>
                <span className="text-center">
                  <GradeBadge grade={entry.grade} />
                </span>
                <span className="text-right font-bold tabular-nums">{entry.rating}</span>
                <span className="fpl-gradient-text text-right font-extrabold tabular-nums">
                  {entry.season_points}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Leaderboard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Leaderboard.tsx web/src/pages/Leaderboard.test.tsx
git commit -m "feat: give Leaderboard a season pill switcher, default to most recent season"
```

---

### Task 4: Wire into `GradeDistribution.tsx`

**Files:**
- Modify: `web/src/pages/GradeDistribution.tsx`
- Modify: `web/src/pages/GradeDistribution.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1), `SeasonPillSwitcher` (Task 2).

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/GradeDistribution.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof SEASON | null, seasons: (typeof SEASON)[]) {
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
      <GradeDistributionPage />
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

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run (from `web/`): `npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: FAIL (same reason as Task 3).

- [ ] **Step 3: Update `GradeDistribution.tsx`**

```tsx
// web/src/pages/GradeDistribution.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';

export function GradeDistributionPage() {
  const seasonSelector = useSeasonSelector();
  const distribution = useGradeDistribution(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (distribution.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (distribution.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  const rows = toFullGradeDistribution(distribution.data ?? []);
  const maxCount = Math.max(1, ...rows.map((r) => r.player_count));

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
        <h1 className="text-3xl font-extrabold sm:text-4xl">Grade Distribution</h1>
      </div>
      <div className="card-surface flex flex-col gap-4 p-6">
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-4">
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
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/GradeDistribution.tsx web/src/pages/GradeDistribution.test.tsx
git commit -m "feat: give GradeDistribution a season pill switcher, default to most recent season"
```

---

### Task 5: Wire into `MatchHistory.tsx`

**Files:**
- Modify: `web/src/pages/MatchHistory.tsx`
- Modify: `web/src/pages/MatchHistory.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1), `SeasonPillSwitcher` (Task 2).

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/MatchHistory.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));

vi.mock('@/hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({
    data: [
      {
        id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
        frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: true,
        player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { MatchHistoryPage } from './MatchHistory';

const SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof SEASON | null, seasons: (typeof SEASON)[]) {
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
        <MatchHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MatchHistoryPage', () => {
  it('renders the match table with league-wide results, and the season pill', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
  });

  it('shows a "no seasons exist yet" message instead of erroring when there are no seasons at all', () => {
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(null, []));
    renderPage();
    expect(screen.getByText('No seasons exist yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run (from `web/`): `npx vitest run src/pages/MatchHistory.test.tsx`
Expected: FAIL (same reason as Task 3).

- [ ] **Step 3: Update `MatchHistory.tsx`**

```tsx
// web/src/pages/MatchHistory.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useMatchHistory } from '@/hooks/useMatchHistory';

export function MatchHistoryPage() {
  const seasonSelector = useSeasonSelector();
  const matchHistory = useMatchHistory(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (matchHistory.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (matchHistory.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

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
        <h1 className="text-3xl font-extrabold sm:text-4xl">Match History</h1>
      </div>
      <MatchTable matches={matchHistory.data ?? []} />
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/MatchHistory.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/MatchHistory.tsx web/src/pages/MatchHistory.test.tsx
git commit -m "feat: give MatchHistory a season pill switcher, default to most recent season"
```

---

### Task 6: Wire into `PlayerProfile.tsx` (no switcher UI)

**Files:**
- Modify: `web/src/pages/PlayerProfile.tsx`
- Modify: `web/src/pages/PlayerProfile.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1). Does **not** render `SeasonPillSwitcher`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/PlayerProfile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const usePlayerProfileMock = vi.fn();
const mockUseSeasonSelector = vi.fn();
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/usePlayerProfile', () => ({
  usePlayerProfile: (...args: unknown[]) => usePlayerProfileMock(...args),
}));

import { PlayerProfilePage } from './PlayerProfile';

const SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof SEASON | null, seasons: (typeof SEASON)[]) {
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
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
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
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(SEASON, [SEASON]));
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

  it('renders using the most recent season when none is active, instead of erroring', () => {
    const completedSeason = { ...SEASON, status: 'completed' as const };
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(completedSeason, [completedSeason]));
    usePlayerProfileMock.mockReturnValue({
      data: {
        player: { id: 'p1', full_name: 'Alex Testplayer' },
        seasonRating: null,
        statistics: null,
        ratingEvents: [],
        matches: [],
      },
      isLoading: false,
      isError: false,
    });
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load this player. Try refreshing.")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run (from `web/`): `npx vitest run src/pages/PlayerProfile.test.tsx`
Expected: the first two FAIL (mock no longer matches); the third is new and also fails.

- [ ] **Step 3: Update `PlayerProfile.tsx`**

```tsx
// web/src/pages/PlayerProfile.tsx
import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { toRatingHistoryPoints } from '@/lib/ratingHistory';
import { toPlayerProfileMatches } from '@/lib/playerProfileMatches';
import { cn } from '@/lib/utils';

const RatingChart = lazy(() => import('@/components/RatingChart').then((m) => ({ default: m.RatingChart })));

function streakLabel(streak: number): string {
  if (streak === 0) return '—';
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

function StatTile({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="card-surface p-4">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">{label}</p>
      <p className={cn('mt-1 text-2xl font-extrabold tabular-nums', highlight && 'fpl-gradient-text')}>
        {value}
      </p>
    </div>
  );
}

export function PlayerProfilePage() {
  const { playerId } = useParams<{ playerId: string }>();
  const seasonSelector = useSeasonSelector();
  const profile = usePlayerProfile(playerId, seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load this player. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (profile.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (profile.isError || !profile.data) {
    return <p className="text-destructive">Couldn't load this player. Try refreshing.</p>;
  }

  const { player, seasonRating, statistics, ratingEvents, matches } = profile.data;
  const chartPoints = toRatingHistoryPoints(ratingEvents);
  const recentMatches = toPlayerProfileMatches(player.id, matches, ratingEvents);

  return (
    <div>
      {/* Hero */}
      <div className="fpl-gradient-soft mb-6 flex flex-col items-start gap-5 rounded-2xl border border-border px-6 py-8 sm:flex-row sm:items-center">
        <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="xl" className="fpl-glow-green" />
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            {seasonSelector.selectedSeason?.name}
          </p>
          <h1 className="truncate text-3xl font-extrabold sm:text-4xl">{player.full_name}</h1>
          {seasonRating && (
            <div className="mt-2">
              <GradeBadge grade={seasonRating.grade} />
            </div>
          )}
        </div>
      </div>

      {!seasonRating && (
        <p className="text-muted-foreground mb-6 text-sm">
          No rating yet this season — check back after their first match.
        </p>
      )}

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Rating" value={seasonRating?.rating ?? '—'} />
        <StatTile label="Win %" value={statistics ? `${statistics.win_pct}%` : '—'} />
        <StatTile label="Streak" value={statistics ? streakLabel(statistics.current_streak) : '—'} />
        <StatTile label="Form" value={statistics?.form_score ?? '—'} />
        <StatTile label="Season Pts" value={seasonRating?.season_points ?? '—'} highlight />
      </div>

      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
        Rating history
      </h2>
      <div className="card-surface mb-8 p-4">
        <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
          <RatingChart points={chartPoints} />
        </Suspense>
      </div>

      <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
        Recent matches
      </h2>
      {recentMatches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matches yet.</p>
      ) : (
        <div className="card-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border text-left text-xs font-semibold uppercase tracking-wider">
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Opponent</th>
                <th className="px-4 py-2.5">Score</th>
                <th className="px-4 py-2.5">Result</th>
                <th className="px-4 py-2.5">Δ Rating</th>
              </tr>
            </thead>
            <tbody>
              {recentMatches.map((match) => (
                <tr
                  key={match.id}
                  className={cn(
                    'border-b border-border transition-colors last:border-0 hover:bg-foreground/5',
                    match.is_voided && 'opacity-50',
                  )}
                >
                  <td className="text-muted-foreground px-4 py-3">{match.match_date}</td>
                  <td className="px-4 py-3 font-medium">{match.opponent_name}</td>
                  <td className="px-4 py-3 font-bold tabular-nums">
                    {match.frames_for}–{match.frames_against}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold',
                        match.won ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive',
                      )}
                    >
                      {match.won ? 'Win' : 'Loss'}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 font-semibold tabular-nums',
                      match.rating_delta !== null && match.rating_delta > 0 && 'text-primary',
                      match.rating_delta !== null && match.rating_delta < 0 && 'text-destructive',
                    )}
                  >
                    {match.rating_delta !== null ? match.rating_delta.toFixed(1) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/PlayerProfile.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/PlayerProfile.tsx web/src/pages/PlayerProfile.test.tsx
git commit -m "feat: default PlayerProfile to the most recent season instead of erroring"
```

---

### Task 7: Wire into `Settings.tsx` (no switcher UI)

**Files:**
- Modify: `web/src/pages/Settings.tsx`
- Modify: `web/src/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1). Does **not** render `SeasonPillSwitcher`.

This is the page that motivated re-checking every real caller during spec review: today it hard-fails its *entire* account page — password change and all, none of it season-related — over a missing active season.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/Settings.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseUserProfile = vi.fn();
const mockUsePlayers = vi.fn();
const mockUseSeasonSelector = vi.fn();
const mockSubmitClaimMutate = vi.fn();
const mockUpdateUser = vi.fn();

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => mockUseUserProfile() }));
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/useSubmitPlayerClaim', () => ({
  useSubmitPlayerClaim: () => ({ mutate: mockSubmitClaimMutate, isPending: false }),
}));
vi.mock('@/hooks/usePlayerPhotoUpload', () => ({
  usePlayerPhotoUpload: () => ({ inputRef: { current: null }, isUploading: false, handleFile: vi.fn(), handleRemove: vi.fn() }),
}));
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: (args: unknown) => mockUpdateUser(args) } },
}));

import { SettingsPage } from './Settings';

const ACTIVE_SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof ACTIVE_SEASON | null, seasons: (typeof ACTIVE_SEASON)[]) {
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

function renderSettings() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    mockSubmitClaimMutate.mockReset();
    mockUpdateUser.mockReset();
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1', email: 'u1@example.com' } }, isLoading: false });
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(ACTIVE_SEASON, [ACTIVE_SEASON]));
  });

  it('shows the claim picker for an unlinked, non-admin account', async () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderSettings();
    expect(screen.getByText(/claim your player profile/i)).toBeInTheDocument();
  });

  it('shows a pending-review status instead of the picker when a claim is outstanding', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: { id: 'c1', player_id: 'p1', status: 'pending' } },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderSettings();
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
  });

  it('shows the linked player name read-only and the photo manager for a linked account', () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: 'p1', pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderSettings();
    expect(screen.getByText(/linked to: alex testplayer/i)).toBeInTheDocument();
  });

  it('updates the password on submit', async () => {
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUpdateUser.mockResolvedValue({ error: null });
    const user = userEvent.setup();

    renderSettings();
    await user.type(screen.getByLabelText('New password'), 'newpassword1');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpassword1' }));
  });

  it('still renders account settings when there is no active season (regression: this used to hard-fail the whole page)', () => {
    const completedSeason = { ...ACTIVE_SEASON, status: 'completed' as const };
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(completedSeason, [completedSeason]));
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    mockUseUserProfile.mockReturnValue({
      data: { linkedPlayerId: null, pendingClaim: null },
      isLoading: false,
      isError: false,
    });
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });

    renderSettings();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run (from `web/`): `npx vitest run src/pages/Settings.test.tsx`
Expected: the first four FAIL (mock no longer matches what the page imports); the fifth is new and also fails.

- [ ] **Step 3: Update `Settings.tsx`**

Change the import line:
```tsx
import { useActiveSeason } from '@/hooks/useActiveSeason';
```
to:
```tsx
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
```

Change the `SettingsPage` function body:
```tsx
export function SettingsPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);
  const activeSeason = useActiveSeason();

  if (isAdmin.isLoading || userProfile.isLoading || activeSeason.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError || activeSeason.isError || !userId) {
    return <p className="text-destructive">Couldn't load your account. Try refreshing.</p>;
  }

  const seasonId = activeSeason.data?.id ?? '';
```
to:
```tsx
export function SettingsPage() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const isAdmin = useIsAdmin(userId);
  const userProfile = useUserProfile(userId);
  const seasonSelector = useSeasonSelector();

  if (isAdmin.isLoading || userProfile.isLoading || seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (userProfile.isError || seasonSelector.isError || !userId) {
    return <p className="text-destructive">Couldn't load your account. Try refreshing.</p>;
  }

  const seasonId = seasonSelector.selectedSeasonId ?? '';
```

Everything else in the file (`AccountSection`, `AdminDisplayNameSection`, `LinkedPlayerSection`, `ClaimSection`, and the rest of `SettingsPage`'s JSX) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Settings.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Settings.tsx web/src/pages/Settings.test.tsx
git commit -m "fix: stop Settings hard-failing its entire page over a missing active season"
```

---

### Task 8: Wire into `admin/ManagePlayers.tsx` (no switcher UI), final check

**Files:**
- Modify: `web/src/pages/admin/ManagePlayers.tsx`
- Modify: `web/src/pages/admin/ManagePlayers.test.tsx`

**Interfaces:**
- Consumes: `useSeasonSelector()` (Task 1). Does **not** render `SeasonPillSwitcher`.

- [ ] **Step 1: Write the failing tests**

```tsx
// web/src/pages/admin/ManagePlayers.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseSeasonSelector = vi.fn();
const mockUsePlayers = vi.fn();
const mockUsePendingClaims = vi.fn();
const mockReviewPlayerClaim = vi.fn();

vi.mock('@/hooks/useSeasonSelector', () => ({ useSeasonSelector: () => mockUseSeasonSelector() }));
vi.mock('@/hooks/usePlayers', () => ({ usePlayers: () => mockUsePlayers() }));
vi.mock('@/hooks/usePendingClaims', () => ({ usePendingClaims: () => mockUsePendingClaims() }));
vi.mock('@/lib/edgeFunctions', () => ({ reviewPlayerClaim: (args: unknown) => mockReviewPlayerClaim(args) }));

import { ManagePlayersPage } from './ManagePlayers';

const ACTIVE_SEASON = { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' as const };

function seasonSelectorReturn(season: typeof ACTIVE_SEASON | null, seasons: (typeof ACTIVE_SEASON)[]) {
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
        <ManagePlayersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ManagePlayersPage pending claims', () => {
  beforeEach(() => {
    mockReviewPlayerClaim.mockReset();
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(ACTIVE_SEASON, [ACTIVE_SEASON]));
    mockUsePlayers.mockReturnValue({ data: [], isLoading: false, isError: false });
  });

  it('lists pending claims and approves one on confirm', async () => {
    mockUsePendingClaims.mockReturnValue({
      data: [{ id: 'c1', user_id: 'u1', player_id: 'p1', player_name: 'Alex Testplayer', created_at: '2026-07-20' }],
      isLoading: false,
      isError: false,
    });
    mockReviewPlayerClaim.mockResolvedValue({ claim_id: 'c1', status: 'approved' });
    const user = userEvent.setup();

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Approve' }));

    await waitFor(() =>
      expect(mockReviewPlayerClaim).toHaveBeenCalledWith({ claim_id: 'c1', decision: 'approve' }),
    );
  });

  it('shows nothing when there are no pending claims', () => {
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    renderPage();
    expect(screen.queryByText(/pending claims/i)).not.toBeInTheDocument();
  });

  it('still renders the roster when there is no active season, using the most recent season', () => {
    const completedSeason = { ...ACTIVE_SEASON, status: 'completed' as const };
    mockUseSeasonSelector.mockReturnValue(seasonSelectorReturn(completedSeason, [completedSeason]));
    mockUsePendingClaims.mockReturnValue({ data: [], isLoading: false, isError: false });
    mockUsePlayers.mockReturnValue({
      data: [{ id: 'p1', full_name: 'Alex Testplayer', rating: 1500, photo_url: null }],
      isLoading: false,
      isError: false,
    });

    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load players. Try refreshing.")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run (from `web/`): `npx vitest run src/pages/admin/ManagePlayers.test.tsx`
Expected: the first two FAIL (mock no longer matches); the third is new and also fails.

- [ ] **Step 3: Update `ManagePlayers.tsx`**

Change the import line:
```tsx
import { useActiveSeason } from '@/hooks/useActiveSeason';
```
to:
```tsx
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
```

Change the `ManagePlayersPage` function:
```tsx
export function ManagePlayersPage() {
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);

  if (activeSeason.isLoading || players.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (activeSeason.isError || players.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  return (
    <div className="max-w-2xl">
      <PendingClaimsSection />
      <h1 className="mb-1 text-2xl font-extrabold">Players</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Upload player photos — they'll appear on the leaderboard, match history, and player profiles.
      </p>
      <ul className="card-surface overflow-hidden">
        {players.data?.map((player) => (
          <PlayerPhotoRow key={player.id} player={player} seasonId={activeSeason.data?.id ?? ''} />
        ))}
      </ul>
    </div>
  );
}
```
to:
```tsx
export function ManagePlayersPage() {
  const seasonSelector = useSeasonSelector();
  const players = usePlayers(seasonSelector.selectedSeasonId);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (players.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (players.isError) {
    return <p className="text-destructive">Couldn't load players. Try refreshing.</p>;
  }

  return (
    <div className="max-w-2xl">
      <PendingClaimsSection />
      <h1 className="mb-1 text-2xl font-extrabold">Players</h1>
      <p className="text-muted-foreground mb-6 text-sm">
        Upload player photos — they'll appear on the leaderboard, match history, and player profiles.
      </p>
      <ul className="card-surface overflow-hidden">
        {players.data?.map((player) => (
          <PlayerPhotoRow key={player.id} player={player} seasonId={seasonSelector.selectedSeasonId ?? ''} />
        ))}
      </ul>
    </div>
  );
}
```

`PlayerPhotoRow` and `PendingClaimsSection` are unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/admin/ManagePlayers.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full test suite and the TypeScript build once, as the final check for this plan**

Run: `npx vitest run` (from `web/`)
Expected: PASS, all files.

Run: `npx tsc -b` (from `web/`)
Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/admin/ManagePlayers.tsx web/src/pages/admin/ManagePlayers.test.tsx
git commit -m "fix: default admin ManagePlayers to the most recent season instead of erroring"
```

---

## Self-Review Notes

- **Spec coverage:** `useSeasonSelector` defaulting to the most recent season (Task 1), the pill switcher on Leaderboard/Grades/Matches (Tasks 3-5), the silent no-switcher migration for PlayerProfile/Settings/admin-ManagePlayers (Tasks 6-8) including the Settings bug this whole plan exists to fix, the "no seasons exist yet" empty state on every migrated page — all covered. `useActiveSeason.ts` and `admin/EnterMatch.tsx`/`CorrectMatch.tsx`/`CloseWeek.tsx` are correctly never touched by any task.
- **Placeholder scan:** none found — every step shows exact before/after code.
- **Type consistency checked:** `UseSeasonSelectorResult`'s shape (`selectedSeason`, `selectedSeasonId`, `seasons`, `isLoading`, `isError`, `selectSeason`, `selectPrevious`, `selectNext`, `hasPrevious`, `hasNext`) is identical everywhere it's consumed — Task 1's implementation/tests, `SeasonPillSwitcherProps` (Task 2), and all six page-level mocks (Tasks 3-8) use the exact same field names and types.
