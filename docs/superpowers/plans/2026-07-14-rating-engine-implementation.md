# Rating Engine + Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and fully unit-test the pool league's rating/grading math as a
standalone TypeScript library, and stand up the Postgres schema it will run
against, validated by integration tests against a real dockerized database.

**Architecture:** A pure, dependency-free TypeScript module per formula from the
design spec (`docs/superpowers/specs/2026-07-14-rating-engine-design.md`), each with
its own unit tests (TDD). The database schema is written as a Supabase-compatible
SQL migration (`supabase/migrations/`) so Phase 2 can adopt it unchanged when it
wires up the full Supabase local Docker stack; here it's validated against a
plain `postgres:16-alpine` container defined in `docker-compose.yml`. That
compose file is deliberately minimal for this phase — Phase 2 extends it with
Supabase's services, and Phase 3 adds the frontend container, building toward the
"full docker-compose stack" end state incrementally.

**Tech Stack:** TypeScript (strict mode), Vitest (unit + integration tests), `pg`
(Postgres client for integration tests), Docker Compose + `postgres:16-alpine`
(local test database), SQL migrations in Supabase's expected directory layout.

## Global Constraints

Exact values below are copied from
`docs/superpowers/specs/2026-07-14-rating-engine-design.md` and apply to every task:

- Baseline rating = 1500. Initial RD = 350, RD floor = 50. Initial volatility = 0.06. (spec §3.1)
- Instant nudge: `K_min=10, K_max=50, RD_min=50, RD_max=350` for the K scale; MoV
  multiplier ranges 1.0 (narrowest win) to 1.5 (whitewash). (spec §3.2)
- Glicko-2 scale factor = 173.7178, τ (tau) = 0.5, convergence epsilon = 0.000001. (spec §3.3)
- Season carryover: `new_rating = 1500 + 0.75 × (old_rating − 1500)`,
  `new_rd = min(350, old_rd + 50)`, volatility unchanged. (spec §5)
- Ranking eligibility threshold: 3 matches played. (spec §4.2)
- Form score weighting: 0.65 × last-5 win% + 0.35 × last-10 win%. (spec §6)
- Season points: win=3, +1 per frame won, upset bonus `min(5, round((oppRating −
  ownRating)/100))` when won against a higher-rated opponent, +2 whitewash bonus
  for winning by the maximum possible margin. (spec §7)
- Odds: `P = 1 / (1 + 10^(-(R_A - R_B)/400))`, implied decimal odds `= 1/P`. (spec §8)
- Grade bands: A+ ≥2000, A 1800–1999, B+ 1600–1799, B 1400–1599, C+ 1200–1399,
  C 1000–1199, D <1000. (spec §4.1)
- Database schema: table names, columns, and constraints exactly as spec §9.

---

### Task 1: Project scaffolding, rating constants, and local Postgres container

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `src/rating/constants.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: exported constants from `src/rating/constants.ts` — `BASELINE_RATING`,
  `INITIAL_RD`, `RD_FLOOR`, `RD_MIN_FOR_K`, `RD_MAX_FOR_K`, `K_MIN`, `K_MAX`,
  `INITIAL_VOLATILITY`, `GLICKO2_SCALE`, `GLICKO2_TAU`,
  `GLICKO2_CONVERGENCE_EPSILON`, `SEASON_CARRYOVER_REGRESSION`,
  `SEASON_CARRYOVER_RD_INCREASE`, `MIN_MATCHES_FOR_RANKING`, `FORM_WEIGHT_LAST5`,
  `FORM_WEIGHT_LAST10` (all `number`). Every later task imports from this file —
  no task hardcodes one of these values itself.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pool-league-rating-engine",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test:unit": "vitest run src/rating",
    "test:integration": "vitest run src/db",
    "test": "npm run test:unit && npm run test:integration",
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^20.14.15",
    "@types/pg": "^8.11.6"
  },
  "dependencies": {
    "pg": "^8.12.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: pool_league_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: pool_league
    ports:
      - "54329:5432"
    volumes:
      - pool_league_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 2s
      timeout: 5s
      retries: 10

volumes:
  pool_league_pg_data:
```

- [ ] **Step 6: Create `src/rating/constants.ts`**

```typescript
export const BASELINE_RATING = 1500;
export const INITIAL_RD = 350;
export const RD_FLOOR = 50;

export const RD_MIN_FOR_K = 50;
export const RD_MAX_FOR_K = 350;
export const K_MIN = 10;
export const K_MAX = 50;

export const INITIAL_VOLATILITY = 0.06;
export const GLICKO2_SCALE = 173.7178;
export const GLICKO2_TAU = 0.5;
export const GLICKO2_CONVERGENCE_EPSILON = 0.000001;

export const SEASON_CARRYOVER_REGRESSION = 0.75;
export const SEASON_CARRYOVER_RD_INCREASE = 50;

export const MIN_MATCHES_FOR_RANKING = 3;

export const FORM_WEIGHT_LAST5 = 0.65;
export const FORM_WEIGHT_LAST10 = 0.35;
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: installs without errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 8: Verify the TypeScript project compiles**

Run: `npx tsc --noEmit`
Expected: exits with no errors (no output).

- [ ] **Step 9: Verify the local Postgres container starts healthy**

Run: `npm run db:up` then `docker compose ps`
Expected: `pool_league_postgres` listed with status `Up` / `healthy`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore docker-compose.yml src/rating/constants.ts
git commit -m "chore: scaffold TS project, rating constants, and local postgres container"
```

---

### Task 2: Grade lookup

**Files:**
- Create: `src/rating/grade.ts`
- Test: `src/rating/grade.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D'` and
  `export function gradeForRating(rating: number): Grade` from `src/rating/grade.ts`.
  Used by Task 8 (weekly reconciliation output display) is out of scope here, but
  Phase 2/3 plans will import this directly.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/grade.test.ts
import { describe, it, expect } from 'vitest';
import { gradeForRating } from './grade';

describe('gradeForRating', () => {
  it('returns A+ at and above 2000', () => {
    expect(gradeForRating(2000)).toBe('A+');
    expect(gradeForRating(2500)).toBe('A+');
  });

  it('returns A from 1800 up to (not including) 2000', () => {
    expect(gradeForRating(1800)).toBe('A');
    expect(gradeForRating(1999.99)).toBe('A');
  });

  it('returns B+ from 1600 up to (not including) 1800', () => {
    expect(gradeForRating(1600)).toBe('B+');
    expect(gradeForRating(1799.99)).toBe('B+');
  });

  it('returns B from 1400 up to (not including) 1600', () => {
    expect(gradeForRating(1400)).toBe('B');
    expect(gradeForRating(1599.99)).toBe('B');
  });

  it('returns C+ from 1200 up to (not including) 1400', () => {
    expect(gradeForRating(1200)).toBe('C+');
    expect(gradeForRating(1399.99)).toBe('C+');
  });

  it('returns C from 1000 up to (not including) 1200', () => {
    expect(gradeForRating(1000)).toBe('C');
    expect(gradeForRating(1199.99)).toBe('C');
  });

  it('returns D below 1000', () => {
    expect(gradeForRating(999.99)).toBe('D');
    expect(gradeForRating(0)).toBe('D');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/grade.test.ts`
Expected: FAIL — `Cannot find module './grade'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/grade.ts
export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';

export function gradeForRating(rating: number): Grade {
  if (rating >= 2000) return 'A+';
  if (rating >= 1800) return 'A';
  if (rating >= 1600) return 'B+';
  if (rating >= 1400) return 'B';
  if (rating >= 1200) return 'C+';
  if (rating >= 1000) return 'C';
  return 'D';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/grade.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/grade.ts src/rating/grade.test.ts
git commit -m "feat: add grade lookup from rating"
```

---

### Task 3: Instant Elo nudge layer

**Files:**
- Create: `src/rating/elo.ts`
- Test: `src/rating/elo.test.ts`

**Interfaces:**
- Consumes: `RD_MIN_FOR_K, RD_MAX_FOR_K, K_MIN, K_MAX` from `src/rating/constants.ts`
- Produces: from `src/rating/elo.ts` —
  `export function expectedScore(ratingA: number, ratingB: number): number`,
  `export function kEffective(rd: number): number`,
  `export function movMultiplier(framesA: number, framesB: number): number`,
  `export interface InstantNudgeInput { ratingA: number; rdA: number; ratingB: number; rdB: number; framesA: number; framesB: number; }`,
  `export interface InstantNudgeOutput { expectedScoreA: number; actualScoreA: number; kEffectiveA: number; movMultiplier: number; deltaA: number; newRatingA: number; newRatingB: number; }`,
  `export function applyInstantNudge(input: InstantNudgeInput): InstantNudgeOutput`.
  Task 4 imports `expectedScore` directly (do not duplicate the formula).

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/elo.test.ts
import { describe, it, expect } from 'vitest';
import { expectedScore, kEffective, movMultiplier, applyInstantNudge } from './elo';

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('matches the spec worked example: 1700 vs 1500 gives ~76%', () => {
    expect(expectedScore(1700, 1500)).toBeCloseTo(0.7597469266, 6);
  });
});

describe('kEffective', () => {
  it('returns K_min at the RD floor', () => {
    expect(kEffective(50)).toBe(10);
  });

  it('returns K_max at the RD ceiling', () => {
    expect(kEffective(350)).toBe(50);
  });

  it('interpolates linearly at the midpoint', () => {
    expect(kEffective(200)).toBe(30);
  });
});

describe('movMultiplier', () => {
  it('returns 1.0 for the narrowest possible win', () => {
    expect(movMultiplier(5, 4)).toBe(1.0);
  });

  it('returns 1.5 for a whitewash', () => {
    expect(movMultiplier(5, 0)).toBe(1.5);
  });

  it('scales linearly between the extremes', () => {
    expect(movMultiplier(5, 2)).toBe(1.25);
  });

  it('returns 1.0 for a race-to-1 match (no wider margin is possible)', () => {
    expect(movMultiplier(1, 0)).toBe(1.0);
  });
});

describe('applyInstantNudge', () => {
  it('moves both ratings by the same magnitude, opposite direction, for an expected win', () => {
    const result = applyInstantNudge({
      ratingA: 1500, rdA: 350, ratingB: 1500, rdB: 350, framesA: 5, framesB: 4,
    });
    expect(result.expectedScoreA).toBeCloseTo(0.5, 10);
    expect(result.actualScoreA).toBe(1);
    expect(result.kEffectiveA).toBe(50);
    expect(result.movMultiplier).toBe(1.0);
    expect(result.deltaA).toBeCloseTo(25, 10);
    expect(result.newRatingA).toBeCloseTo(1525, 10);
    expect(result.newRatingB).toBeCloseTo(1475, 10);
  });

  it('scales an upset whitewash win by both K and the MoV multiplier', () => {
    const result = applyInstantNudge({
      ratingA: 1400, rdA: 200, ratingB: 1700, rdB: 200, framesA: 5, framesB: 0,
    });
    const expectedE = expectedScore(1400, 1700);
    const expectedDelta = 30 * 1.5 * (1 - expectedE); // kEffective(200)=30, movMultiplier(5,0)=1.5

    expect(result.expectedScoreA).toBeCloseTo(expectedE, 10);
    expect(result.kEffectiveA).toBe(30);
    expect(result.movMultiplier).toBe(1.5);
    expect(result.deltaA).toBeCloseTo(expectedDelta, 10);
    expect(result.newRatingA).toBeCloseTo(1400 + expectedDelta, 10);
    expect(result.newRatingB).toBeCloseTo(1700 - expectedDelta, 10);
  });

  it('gives actualScoreA = 0 when player A loses', () => {
    const result = applyInstantNudge({
      ratingA: 1500, rdA: 350, ratingB: 1500, rdB: 350, framesA: 2, framesB: 5,
    });
    expect(result.actualScoreA).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/elo.test.ts`
Expected: FAIL — `Cannot find module './elo'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/elo.ts
import { RD_MIN_FOR_K, RD_MAX_FOR_K, K_MIN, K_MAX } from './constants.js';

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, -(ratingA - ratingB) / 400));
}

export function kEffective(rd: number): number {
  const clamped = Math.min(RD_MAX_FOR_K, Math.max(RD_MIN_FOR_K, rd));
  const t = (clamped - RD_MIN_FOR_K) / (RD_MAX_FOR_K - RD_MIN_FOR_K);
  return K_MIN + (K_MAX - K_MIN) * t;
}

export function movMultiplier(framesA: number, framesB: number): number {
  const margin = Math.abs(framesA - framesB);
  const raceLength = Math.max(framesA, framesB);
  if (raceLength <= 1) return 1.0;
  return 1 + 0.5 * (margin - 1) / (raceLength - 1);
}

export interface InstantNudgeInput {
  ratingA: number;
  rdA: number;
  ratingB: number;
  rdB: number;
  framesA: number;
  framesB: number;
}

export interface InstantNudgeOutput {
  expectedScoreA: number;
  actualScoreA: number;
  kEffectiveA: number;
  movMultiplier: number;
  deltaA: number;
  newRatingA: number;
  newRatingB: number;
}

export function applyInstantNudge(input: InstantNudgeInput): InstantNudgeOutput {
  const { ratingA, rdA, ratingB, framesA, framesB } = input;
  const expectedScoreA = expectedScore(ratingA, ratingB);
  const actualScoreA = framesA > framesB ? 1 : 0;
  const kEffectiveA = kEffective(rdA);
  const mov = movMultiplier(framesA, framesB);
  const deltaA = kEffectiveA * mov * (actualScoreA - expectedScoreA);

  return {
    expectedScoreA,
    actualScoreA,
    kEffectiveA,
    movMultiplier: mov,
    deltaA,
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB - deltaA,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/elo.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/elo.ts src/rating/elo.test.ts
git commit -m "feat: add instant Elo nudge layer (expected score, K scaling, MoV multiplier)"
```

---

### Task 4: Odds engine

**Files:**
- Create: `src/rating/odds.ts`
- Test: `src/rating/odds.test.ts`

**Interfaces:**
- Consumes: `expectedScore` from `src/rating/elo.ts`
- Produces: `export function winProbability(ratingA: number, ratingB: number): number`,
  `export function impliedDecimalOdds(probability: number): number` from
  `src/rating/odds.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/odds.test.ts
import { describe, it, expect } from 'vitest';
import { winProbability, impliedDecimalOdds } from './odds';

describe('winProbability', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(winProbability(1500, 1500)).toBeCloseTo(0.5, 10);
  });

  it('matches the spec worked example: 1700 vs 1500', () => {
    expect(winProbability(1700, 1500)).toBeCloseTo(0.7597469266, 6);
  });
});

describe('impliedDecimalOdds', () => {
  it('matches the spec worked example', () => {
    expect(impliedDecimalOdds(winProbability(1700, 1500))).toBeCloseTo(1.3162277660, 6);
  });

  it('is exactly 2.0 for a 50% probability', () => {
    expect(impliedDecimalOdds(0.5)).toBeCloseTo(2.0, 10);
  });

  it('throws for a non-positive probability', () => {
    expect(() => impliedDecimalOdds(0)).toThrow();
    expect(() => impliedDecimalOdds(-0.1)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/odds.test.ts`
Expected: FAIL — `Cannot find module './odds'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/odds.ts
import { expectedScore } from './elo.js';

export function winProbability(ratingA: number, ratingB: number): number {
  return expectedScore(ratingA, ratingB);
}

export function impliedDecimalOdds(probability: number): number {
  if (probability <= 0) {
    throw new Error('probability must be greater than 0');
  }
  return 1 / probability;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/odds.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/odds.ts src/rating/odds.test.ts
git commit -m "feat: add statistical odds engine (win probability, implied decimal odds)"
```

---

### Task 5: Season carryover (soft reset)

**Files:**
- Create: `src/rating/seasonCarryover.ts`
- Test: `src/rating/seasonCarryover.test.ts`

**Interfaces:**
- Consumes: `BASELINE_RATING, SEASON_CARRYOVER_REGRESSION, SEASON_CARRYOVER_RD_INCREASE, INITIAL_RD` from `src/rating/constants.ts`
- Produces: `export interface CarryoverState { rating: number; rd: number; volatility: number; }`,
  `export function applySeasonCarryover(input: CarryoverState): CarryoverState` from
  `src/rating/seasonCarryover.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/seasonCarryover.test.ts
import { describe, it, expect } from 'vitest';
import { applySeasonCarryover } from './seasonCarryover';

describe('applySeasonCarryover', () => {
  it('regresses rating 75% of the way back toward 1500', () => {
    const result = applySeasonCarryover({ rating: 1900, rd: 100, volatility: 0.06 });
    expect(result.rating).toBeCloseTo(1500 + 0.75 * 400, 10); // 1800
  });

  it('regresses a below-baseline rating back up toward 1500', () => {
    const result = applySeasonCarryover({ rating: 1100, rd: 100, volatility: 0.06 });
    expect(result.rating).toBeCloseTo(1500 + 0.75 * -400, 10); // 1200
  });

  it('grows RD by 50, capped at the initial RD ceiling of 350', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 320, volatility: 0.06 });
    expect(result.rd).toBe(350);
  });

  it('grows RD by 50 without capping when below the ceiling', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 100, volatility: 0.06 });
    expect(result.rd).toBe(150);
  });

  it('leaves volatility unchanged', () => {
    const result = applySeasonCarryover({ rating: 1500, rd: 100, volatility: 0.073 });
    expect(result.volatility).toBe(0.073);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/seasonCarryover.test.ts`
Expected: FAIL — `Cannot find module './seasonCarryover'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/seasonCarryover.ts
import {
  BASELINE_RATING,
  SEASON_CARRYOVER_REGRESSION,
  SEASON_CARRYOVER_RD_INCREASE,
  INITIAL_RD,
} from './constants.js';

export interface CarryoverState {
  rating: number;
  rd: number;
  volatility: number;
}

export function applySeasonCarryover(input: CarryoverState): CarryoverState {
  return {
    rating: BASELINE_RATING + SEASON_CARRYOVER_REGRESSION * (input.rating - BASELINE_RATING),
    rd: Math.min(INITIAL_RD, input.rd + SEASON_CARRYOVER_RD_INCREASE),
    volatility: input.volatility,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/seasonCarryover.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/seasonCarryover.ts src/rating/seasonCarryover.test.ts
git commit -m "feat: add season carryover soft-reset formula"
```

---

### Task 6: Season points (FPL-inspired)

**Files:**
- Create: `src/rating/seasonPoints.ts`
- Test: `src/rating/seasonPoints.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `export interface SeasonPointsInput { won: boolean; framesFor: number; framesAgainst: number; ownRating: number; opponentRating: number; }`,
  `export function calculateSeasonPoints(input: SeasonPointsInput): number` from
  `src/rating/seasonPoints.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/seasonPoints.test.ts
import { describe, it, expect } from 'vitest';
import { calculateSeasonPoints } from './seasonPoints';

describe('calculateSeasonPoints', () => {
  it('awards base win points plus one point per frame won, no bonuses for a routine win', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 3, ownRating: 1500, opponentRating: 1450,
    });
    expect(points).toBe(3 + 5);
  });

  it('awards zero base points but still frame points for a competitive loss', () => {
    const points = calculateSeasonPoints({
      won: false, framesFor: 4, framesAgainst: 5, ownRating: 1500, opponentRating: 1600,
    });
    expect(points).toBe(0 + 4);
  });

  it('awards an upset bonus, capped at 5, for beating a much higher-rated opponent', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 2, ownRating: 1200, opponentRating: 1900,
    });
    // upset bonus = min(5, round(700/100)) = min(5, 7) = 5
    expect(points).toBe(3 + 5 + 5);
  });

  it('does not award an upset bonus when beating a lower-rated opponent', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 1, ownRating: 1700, opponentRating: 1400,
    });
    expect(points).toBe(3 + 5);
  });

  it('awards a whitewash bonus for winning by the maximum possible margin', () => {
    const points = calculateSeasonPoints({
      won: true, framesFor: 5, framesAgainst: 0, ownRating: 1500, opponentRating: 1400,
    });
    expect(points).toBe(3 + 5 + 2);
  });

  it('does not award a whitewash bonus on a loss even with framesAgainst of 0', () => {
    const points = calculateSeasonPoints({
      won: false, framesFor: 0, framesAgainst: 5, ownRating: 1500, opponentRating: 1600,
    });
    expect(points).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/seasonPoints.test.ts`
Expected: FAIL — `Cannot find module './seasonPoints'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/seasonPoints.ts
export interface SeasonPointsInput {
  won: boolean;
  framesFor: number;
  framesAgainst: number;
  ownRating: number;
  opponentRating: number;
}

export function calculateSeasonPoints(input: SeasonPointsInput): number {
  const { won, framesFor, framesAgainst, ownRating, opponentRating } = input;

  const base = won ? 3 : 0;
  const frameBonus = framesFor;
  const upsetBonus = won && opponentRating > ownRating
    ? Math.min(5, Math.round((opponentRating - ownRating) / 100))
    : 0;
  const whitewashBonus = won && framesAgainst === 0 ? 2 : 0;

  return base + frameBonus + upsetBonus + whitewashBonus;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/seasonPoints.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/seasonPoints.ts src/rating/seasonPoints.test.ts
git commit -m "feat: add FPL-inspired season points formula"
```

---

### Task 7: Player statistics

**Files:**
- Create: `src/rating/statistics.ts`
- Test: `src/rating/statistics.test.ts`

**Interfaces:**
- Consumes: `FORM_WEIGHT_LAST5, FORM_WEIGHT_LAST10` from `src/rating/constants.ts`
- Produces: `export function winPercentage(wins: number, losses: number): number`,
  `export function currentStreak(outcomesChronological: boolean[]): number`,
  `export function longestStreak(outcomesChronological: boolean[]): number`,
  `export function averageOpponentRating(opponentRatings: number[]): number`,
  `export function formPercentage(recentOutcomesChronological: boolean[]): number`,
  `export function formScore(last5: boolean[], last10: boolean[]): number` from
  `src/rating/statistics.ts`. `outcomesChronological` / `last5` / `last10` arrays
  are ordered oldest-to-newest, `true` = win.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/statistics.test.ts
import { describe, it, expect } from 'vitest';
import {
  winPercentage,
  currentStreak,
  longestStreak,
  averageOpponentRating,
  formPercentage,
  formScore,
} from './statistics';

describe('winPercentage', () => {
  it('computes a basic win percentage', () => {
    expect(winPercentage(7, 3)).toBe(70);
  });

  it('returns 0 when no matches have been played', () => {
    expect(winPercentage(0, 0)).toBe(0);
  });
});

describe('currentStreak', () => {
  it('returns a positive count for an active win streak', () => {
    expect(currentStreak([false, true, true, true])).toBe(3);
  });

  it('returns a negative count for an active loss streak', () => {
    expect(currentStreak([true, false, false])).toBe(-2);
  });

  it('returns 0 when there are no matches', () => {
    expect(currentStreak([])).toBe(0);
  });
});

describe('longestStreak', () => {
  it('finds the longest historical win streak', () => {
    expect(longestStreak([true, true, false, true, true, true, false])).toBe(3);
  });

  it('returns 0 when there are no wins', () => {
    expect(longestStreak([false, false])).toBe(0);
  });
});

describe('averageOpponentRating', () => {
  it('computes the mean opponent rating', () => {
    expect(averageOpponentRating([1400, 1600, 1500])).toBeCloseTo(1500, 10);
  });

  it('returns 0 when there are no matches', () => {
    expect(averageOpponentRating([])).toBe(0);
  });
});

describe('formPercentage', () => {
  it('computes win percentage over the given window', () => {
    expect(formPercentage([true, true, true, false, true])).toBe(80);
  });
});

describe('formScore', () => {
  it('blends last-5 and last-10 win percentage 65/35', () => {
    const last5 = [true, true, true, false, true]; // 4/5 = 80%
    const last10 = [true, true, true, false, true, false, true, false, true, false]; // 6/10 = 60%
    expect(formScore(last5, last10)).toBeCloseTo(0.65 * 80 + 0.35 * 60, 10); // 73
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/statistics.test.ts`
Expected: FAIL — `Cannot find module './statistics'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/statistics.ts
import { FORM_WEIGHT_LAST5, FORM_WEIGHT_LAST10 } from './constants.js';

export function winPercentage(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return (wins / total) * 100;
}

export function currentStreak(outcomesChronological: boolean[]): number {
  if (outcomesChronological.length === 0) return 0;
  const mostRecent = outcomesChronological[outcomesChronological.length - 1];
  let count = 0;
  for (let i = outcomesChronological.length - 1; i >= 0; i -= 1) {
    if (outcomesChronological[i] === mostRecent) {
      count += 1;
    } else {
      break;
    }
  }
  return mostRecent ? count : -count;
}

export function longestStreak(outcomesChronological: boolean[]): number {
  let longest = 0;
  let current = 0;
  for (const won of outcomesChronological) {
    if (won) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function averageOpponentRating(opponentRatings: number[]): number {
  if (opponentRatings.length === 0) return 0;
  const sum = opponentRatings.reduce((acc, r) => acc + r, 0);
  return sum / opponentRatings.length;
}

export function formPercentage(recentOutcomesChronological: boolean[]): number {
  const wins = recentOutcomesChronological.filter(Boolean).length;
  return winPercentage(wins, recentOutcomesChronological.length - wins);
}

export function formScore(last5: boolean[], last10: boolean[]): number {
  return FORM_WEIGHT_LAST5 * formPercentage(last5) + FORM_WEIGHT_LAST10 * formPercentage(last10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/statistics.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/statistics.ts src/rating/statistics.test.ts
git commit -m "feat: add player statistics formulas (win%, streaks, form score)"
```

---

### Task 8: Glicko-2 weekly reconciliation

**Files:**
- Create: `src/rating/glicko2.ts`
- Test: `src/rating/glicko2.test.ts`

**Interfaces:**
- Consumes: `GLICKO2_SCALE, GLICKO2_TAU, GLICKO2_CONVERGENCE_EPSILON, RD_FLOOR` from `src/rating/constants.ts`
- Produces: `export interface Glicko2PlayerState { rating: number; rd: number; volatility: number; }`,
  `export interface Glicko2Opponent { rating: number; rd: number; score: 0 | 1; }`,
  `export function reconcilePeriod(player: Glicko2PlayerState, opponents: Glicko2Opponent[]): Glicko2PlayerState`
  from `src/rating/glicko2.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/glicko2.test.ts
import { describe, it, expect } from 'vitest';
import { reconcilePeriod } from './glicko2';

describe('reconcilePeriod', () => {
  it("matches Glickman's published Glicko-2 worked example", () => {
    // Reference: Glickman, "Example of the Glicko-2 system"
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const opponents: { rating: number; rd: number; score: 0 | 1 }[] = [
      { rating: 1400, rd: 30, score: 1 },
      { rating: 1550, rd: 100, score: 0 },
      { rating: 1700, rd: 300, score: 0 },
    ];

    const result = reconcilePeriod(player, opponents);

    expect(result.rating).toBeCloseTo(1464.06, 1);
    expect(result.rd).toBeCloseTo(151.52, 1);
    expect(result.volatility).toBeCloseTo(0.05999, 4);
  });

  it('grows RD and leaves rating/volatility unchanged for a player with no games in the period', () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const result = reconcilePeriod(player, []);

    expect(result.rating).toBe(1500);
    expect(result.volatility).toBe(0.06);
    expect(result.rd).toBeGreaterThan(200);
  });

  it('increases rating for a player who beat a higher-rated opponent', () => {
    const player = { rating: 1500, rd: 100, volatility: 0.06 };
    const result = reconcilePeriod(player, [{ rating: 1700, rd: 100, score: 1 }]);
    expect(result.rating).toBeGreaterThan(1500);
  });

  it('shrinks RD for a player who is active relative to staying idle', () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const active = reconcilePeriod(player, [
      { rating: 1500, rd: 100, score: 1 },
      { rating: 1500, rd: 100, score: 0 },
    ]);
    const idle = reconcilePeriod(player, []);
    expect(active.rd).toBeLessThan(idle.rd);
  });

  it('never returns an RD below the spec floor of 50', () => {
    const player = { rating: 1500, rd: 50, volatility: 0.03 };
    const result = reconcilePeriod(player, [
      { rating: 1500, rd: 50, score: 1 },
      { rating: 1500, rd: 50, score: 0 },
      { rating: 1500, rd: 50, score: 1 },
    ]);
    expect(result.rd).toBeGreaterThanOrEqual(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/glicko2.test.ts`
Expected: FAIL — `Cannot find module './glicko2'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/glicko2.ts
import { GLICKO2_SCALE, GLICKO2_TAU, GLICKO2_CONVERGENCE_EPSILON, RD_FLOOR } from './constants.js';

export interface Glicko2PlayerState {
  rating: number;
  rd: number;
  volatility: number;
}

export interface Glicko2Opponent {
  rating: number;
  rd: number;
  score: 0 | 1;
}

function toScale(rating: number, rd: number): { mu: number; phi: number } {
  return { mu: (rating - 1500) / GLICKO2_SCALE, phi: rd / GLICKO2_SCALE };
}

function fromScale(mu: number, phi: number): { rating: number; rd: number } {
  return { rating: GLICKO2_SCALE * mu + 1500, rd: GLICKO2_SCALE * phi };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedValue(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function solveNewVolatility(delta: number, phi: number, v: number, sigma: number): number {
  const a = Math.log(sigma * sigma);
  const tau = GLICKO2_TAU;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - v - ex);
    const denominator = 2 * Math.pow(phi * phi + v + ex, 2);
    return numerator / denominator - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > GLICKO2_CONVERGENCE_EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

export function reconcilePeriod(
  player: Glicko2PlayerState,
  opponents: Glicko2Opponent[],
): Glicko2PlayerState {
  const { mu, phi } = toScale(player.rating, player.rd);

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + player.volatility * player.volatility);
    const { rd } = fromScale(mu, phiStar);
    return { rating: player.rating, rd: Math.max(RD_FLOOR, rd), volatility: player.volatility };
  }

  let vInverseSum = 0;
  let deltaSum = 0;
  for (const opponent of opponents) {
    const opponentScale = toScale(opponent.rating, opponent.rd);
    const gPhiJ = g(opponentScale.phi);
    const e = expectedValue(mu, opponentScale.mu, opponentScale.phi);
    vInverseSum += gPhiJ * gPhiJ * e * (1 - e);
    deltaSum += gPhiJ * (opponent.score - e);
  }

  const v = 1 / vInverseSum;
  const delta = v * deltaSum;

  const newVolatility = solveNewVolatility(delta, phi, v, player.volatility);

  const phiStar = Math.sqrt(phi * phi + newVolatility * newVolatility);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  const { rating, rd } = fromScale(newMu, newPhi);
  return { rating, rd: Math.max(RD_FLOOR, rd), volatility: newVolatility };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/glicko2.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/glicko2.ts src/rating/glicko2.test.ts
git commit -m "feat: add Glicko-2 weekly reconciliation, validated against the canonical worked example"
```

---

### Task 9: Ranking / leaderboard

**Files:**
- Create: `src/rating/ranking.ts`
- Test: `src/rating/ranking.test.ts`

**Interfaces:**
- Consumes: `MIN_MATCHES_FOR_RANKING` from `src/rating/constants.ts`
- Produces: `export interface RankablePlayer { playerId: string; rating: number; matchesPlayed: number; }`,
  `export interface RankedEntry { playerId: string; rating: number; rank: number; }`,
  `export function computeLeaderboard(players: RankablePlayer[], minMatches?: number): RankedEntry[]`
  from `src/rating/ranking.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/rating/ranking.test.ts
import { describe, it, expect } from 'vitest';
import { computeLeaderboard } from './ranking';

describe('computeLeaderboard', () => {
  it('ranks eligible players by rating descending, starting at 1', () => {
    const players = [
      { playerId: 'a', rating: 1600, matchesPlayed: 5 },
      { playerId: 'b', rating: 1800, matchesPlayed: 10 },
      { playerId: 'c', rating: 1700, matchesPlayed: 3 },
    ];
    expect(computeLeaderboard(players)).toEqual([
      { playerId: 'b', rating: 1800, rank: 1 },
      { playerId: 'c', rating: 1700, rank: 2 },
      { playerId: 'a', rating: 1600, rank: 3 },
    ]);
  });

  it('excludes players below the minimum matches threshold', () => {
    const players = [
      { playerId: 'a', rating: 2000, matchesPlayed: 1 },
      { playerId: 'b', rating: 1500, matchesPlayed: 3 },
    ];
    expect(computeLeaderboard(players)).toEqual([
      { playerId: 'b', rating: 1500, rank: 1 },
    ]);
  });

  it('honors a custom minimum matches override', () => {
    const players = [
      { playerId: 'a', rating: 2000, matchesPlayed: 1 },
    ];
    expect(computeLeaderboard(players, 1)).toEqual([
      { playerId: 'a', rating: 2000, rank: 1 },
    ]);
  });

  it('returns an empty array when no players are eligible', () => {
    const players = [{ playerId: 'a', rating: 2000, matchesPlayed: 0 }];
    expect(computeLeaderboard(players)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rating/ranking.test.ts`
Expected: FAIL — `Cannot find module './ranking'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/rating/ranking.ts
import { MIN_MATCHES_FOR_RANKING } from './constants.js';

export interface RankablePlayer {
  playerId: string;
  rating: number;
  matchesPlayed: number;
}

export interface RankedEntry {
  playerId: string;
  rating: number;
  rank: number;
}

export function computeLeaderboard(
  players: RankablePlayer[],
  minMatches: number = MIN_MATCHES_FOR_RANKING,
): RankedEntry[] {
  return players
    .filter((p) => p.matchesPlayed >= minMatches)
    .sort((a, b) => b.rating - a.rating)
    .map((p, index) => ({ playerId: p.playerId, rating: p.rating, rank: index + 1 }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rating/ranking.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rating/ranking.ts src/rating/ranking.test.ts
git commit -m "feat: add leaderboard ranking with minimum-matches eligibility"
```

---

### Task 10: Database schema migration + integration tests

**Files:**
- Create: `supabase/migrations/20260714000000_initial_schema.sql`
- Create: `src/db/applyMigrations.ts`
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this task is independent of `src/rating/*`)
- Produces: `export async function applyMigrations(client: Client): Promise<void>` from
  `src/db/applyMigrations.ts` (`Client` is `pg`'s `Client` type). Phase 2's backend
  plan will reuse this migration file unchanged when wiring up the Supabase local
  Docker stack.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260714000000_initial_schema.sql

create extension if not exists "pgcrypto";

create table players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text,
  joined_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table admin_users (
  id uuid primary key,
  display_name text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

create table player_season_ratings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  rating numeric not null default 1500,
  rd numeric not null default 350,
  volatility numeric not null default 0.06,
  matches_played integer not null default 0,
  is_provisional boolean not null default true,
  grade text not null default 'B' check (grade in ('A+', 'A', 'B+', 'B', 'C+', 'C', 'D')),
  season_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_id)
);

create index player_season_ratings_leaderboard_idx
  on player_season_ratings (season_id, rating desc);

create table matches (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  match_date date not null,
  player_a_id uuid not null references players(id),
  player_b_id uuid not null references players(id),
  frames_a integer not null check (frames_a >= 0),
  frames_b integer not null check (frames_b >= 0),
  winner_id uuid not null references players(id),
  entered_by uuid references admin_users(id),
  is_voided boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (player_a_id <> player_b_id),
  check (winner_id = player_a_id or winner_id = player_b_id),
  check (frames_a <> frames_b)
);

create index matches_season_idx on matches (season_id);

create table match_audit_log (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id),
  changed_by uuid references admin_users(id),
  change_type text not null check (change_type in ('created', 'updated', 'voided')),
  old_values jsonb,
  new_values jsonb,
  changed_at timestamptz not null default now()
);

create table rating_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  rating_before numeric not null,
  rd_before numeric not null,
  rating_after numeric not null,
  rd_after numeric not null,
  expected_score numeric,
  actual_score numeric,
  delta numeric not null,
  event_type text not null check (event_type in ('instant', 'weekly_reconciliation', 'season_carryover')),
  period_end_date date,
  created_at timestamptz not null default now()
);

create index rating_events_player_season_idx on rating_events (player_id, season_id);

create table weekly_rankings (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  week_ending date not null,
  player_id uuid not null references players(id),
  rating numeric not null,
  rd numeric not null,
  rank integer not null,
  grade text not null,
  win_pct numeric not null,
  form_score numeric not null,
  season_points integer not null,
  created_at timestamptz not null default now(),
  unique (season_id, week_ending, player_id)
);

create table player_statistics (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id),
  season_id uuid not null references seasons(id),
  wins integer not null default 0,
  losses integer not null default 0,
  win_pct numeric generated always as (
    case when (wins + losses) = 0 then 0
    else round((wins::numeric / (wins + losses)) * 100, 2) end
  ) stored,
  current_streak integer not null default 0,
  longest_streak integer not null default 0,
  frames_won integer not null default 0,
  frames_lost integer not null default 0,
  avg_opponent_rating numeric,
  form_5 numeric,
  form_10 numeric,
  form_score numeric,
  updated_at timestamptz not null default now(),
  unique (player_id, season_id)
);
```

- [ ] **Step 2: Write the migration runner**

```typescript
// src/db/applyMigrations.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export async function applyMigrations(client: Client): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    await client.query(sql);
  }
}
```

- [ ] **Step 3: Write the failing integration test**

```typescript
// src/db/schema.test.ts
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { applyMigrations } from './applyMigrations';

const ADMIN_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';

let client: Client;

beforeAll(async () => {
  const admin = new Client({ connectionString: ADMIN_CONNECTION_STRING });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS pool_league_test');
  await admin.query('CREATE DATABASE pool_league_test');
  await admin.end();

  const testConnectionString = ADMIN_CONNECTION_STRING.replace(/\/[^/]*$/, '/pool_league_test');
  client = new Client({ connectionString: testConnectionString });
  await client.connect();
  await applyMigrations(client);
}, 30000);

afterAll(async () => {
  await client.end();
});

describe('initial schema', () => {
  it('creates all required tables', async () => {
    const result = await client.query(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const tableNames = result.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toEqual(
      [
        'admin_users',
        'match_audit_log',
        'matches',
        'player_season_ratings',
        'player_statistics',
        'players',
        'rating_events',
        'seasons',
        'weekly_rankings',
      ].sort(),
    );
  });

  it('rejects a match where a player plays against themselves', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 1', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Solo Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $2, 5, 3, $2)`,
        [seasonId, playerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a match that ends in a tied frame score', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 2', '2026-01-01') returning id`,
    );
    const playerA = await client.query(`insert into players (full_name) values ('Player A') returning id`);
    const playerB = await client.query(`insert into players (full_name) values ('Player B') returning id`);

    await expect(
      client.query(
        `insert into matches (season_id, match_date, player_a_id, player_b_id, frames_a, frames_b, winner_id)
         values ($1, '2026-01-08', $2, $3, 4, 4, $2)`,
        [season.rows[0].id, playerA.rows[0].id, playerB.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('enforces one rating row per player per season', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 3', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Dup Player') returning id`,
    );
    const seasonId = season.rows[0].id;
    const playerId = player.rows[0].id;

    await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
      [playerId, seasonId],
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id) values ($1, $2)`,
        [playerId, seasonId],
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid grade value', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 4', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Grade Player') returning id`,
    );

    await expect(
      client.query(
        `insert into player_season_ratings (player_id, season_id, grade) values ($1, $2, 'Z')`,
        [player.rows[0].id, season.rows[0].id],
      ),
    ).rejects.toThrow();
  });

  it('defaults a new rating row to the baseline rating and matching grade', async () => {
    const season = await client.query(
      `insert into seasons (name, start_date) values ('Test Season 5', '2026-01-01') returning id`,
    );
    const player = await client.query(
      `insert into players (full_name) values ('Default Player') returning id`,
    );

    const row = await client.query(
      `insert into player_season_ratings (player_id, season_id) values ($1, $2) returning rating, grade, is_provisional`,
      [player.rows[0].id, season.rows[0].id],
    );

    expect(Number(row.rows[0].rating)).toBe(1500);
    expect(row.rows[0].grade).toBe('B');
    expect(row.rows[0].is_provisional).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run db:up` (wait for healthy, see Task 1 Step 9), then `npx vitest run src/db/schema.test.ts`
Expected: FAIL — connects fine, but fails on the first query because no tables
exist yet (`relation "seasons" does not exist`), since `applyMigrations` is called
but the migration directory logic hasn't been exercised against real tables until
this run.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS (6 tests) — the migration file from Step 1 is what makes this pass;
no further code changes needed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260714000000_initial_schema.sql src/db/applyMigrations.ts src/db/schema.test.ts
git commit -m "feat: add initial database schema migration with integration tests"
```

---

## Final verification

- [ ] Run the full suite: `npm run test:unit && npm run test:integration`
  Expected: all ~60 tests pass (grade 7, elo 12, odds 5, seasonCarryover 5,
  seasonPoints 6, statistics 10, glicko2 5, ranking 4, schema 6).
- [ ] Run `npx tsc --noEmit` — expected: no errors.
- [ ] Run `npm run db:down` to stop the local Postgres container when done.
