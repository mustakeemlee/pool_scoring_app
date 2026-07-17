# Pool League Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React/TypeScript/Tailwind dashboard on top of Phase 1's rating engine and Phase 2's Edge Function API — public leaderboard/stats pages plus an admin-gated weekly workflow (enter match, correct match, close week, start season).

**Architecture:** A single Vite + React SPA in a new top-level `web/` directory (own `package.json`, separate from the backend's tooling). Public pages read PostgREST views/tables directly via the Supabase JS client (`anon` key, RLS-gated), wrapped in TanStack Query. Admin pages additionally call the four Edge Functions for writes, gated behind a client-side auth guard backed by Supabase Auth + an `admin_users` self-read check.

**Tech Stack:** Vite, React 18, TypeScript, React Router v6, TanStack Query v5, Tailwind CSS, shadcn/ui (Radix-based), Recharts, Vitest + React Testing Library.

## Global Constraints

- Frontend lives entirely under `web/`, with its own `package.json` — never add frontend dependencies to the repo root `package.json`.
- Local dev server only this phase (`npm run dev` in `web/`). No Dockerfile, no cloud deploy, no hosted Supabase project.
- Layout: top nav on every page. An additional sidebar appears only inside `/admin/*` routes.
- No self-service admin signup. Forgot-password uses `supabase.auth.resetPasswordForEmail` + `supabase.auth.updateUser` — no custom backend endpoint.
- `AdminRouteGuard` must check BOTH a valid Supabase session AND a matching `admin_users` row (`select * from admin_users where id = auth.uid()`) — a session alone is not sufficient to show admin UI.
- The odds widget shows `winProbability` as a percentage only. Never surface `impliedDecimalOdds` in the UI (this is explicitly not a betting feature — see Phase 1 spec §1 purpose statement).
- Client-side form validation must mirror known DB constraints before submitting to an Edge Function — specifically `frames_a !== frames_b` (schema: `supabase/migrations/20260714000000_initial_schema.sql:66`).
- On a failed Edge Function call, display the response body's `error` field verbatim in the toast — never re-word or swallow it.
- No E2E test suite this phase. Vitest + React Testing Library cover component-level logic (validation, data-shaping, the route guard). Every task's manual verification step must actually be run against `npm run seed`'s data via the dev server, not skipped.
- Grade type is exactly `'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D'` (schema: `supabase/migrations/20260714000000_initial_schema.sql:41`) — never invent additional bands.
- `leaderboard_view` and `grade_distribution_view` already filter to `matches_played >= 3` server-side (`supabase/migrations/20260714030000_views.sql`) — the frontend must not re-apply or duplicate that filter.

---

### Task 1: Scaffold the Vite + React + TypeScript + Tailwind + shadcn/ui project

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/tsconfig.node.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.js`
- Create: `web/components.json`
- Create: `web/src/index.css`
- Create: `web/src/lib/utils.ts`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/App.test.tsx`
- Create: `web/src/test/setup.ts`
- Create: `web/scripts/generate-env.mjs`
- Create: `web/.gitignore`

**Interfaces:**
- Produces: `cn(...)` utility from `web/src/lib/utils.ts`, used by every shadcn/ui component added in later tasks.
- Produces: `web/.env.local` (generated, gitignored) providing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` that Task 2's Supabase client reads.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "pool-league-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "node scripts/generate-env.mjs && vite",
    "build": "node scripts/generate-env.mjs && tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "env:generate": "node scripts/generate-env.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "@tanstack/react-query": "^5.56.2",
    "@supabase/supabase-js": "^2.45.4",
    "recharts": "^2.12.7",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.2",
    "lucide-react": "^0.441.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-alert-dialog": "^1.1.1",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-select": "^2.1.1",
    "sonner": "^1.5.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.15",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.3",
    "vitest": "^2.0.5",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^25.0.0",
    "tailwindcss": "^3.4.10",
    "tailwindcss-animate": "^1.0.7",
    "postcss": "^8.4.41",
    "autoprefixer": "^10.4.20"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd web && npm install`
Expected: installs cleanly, creates `web/package-lock.json` and `web/node_modules/`.

- [ ] **Step 3: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `web/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
```

- [ ] **Step 6: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pool League Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `web/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
```

- [ ] **Step 8: Create `web/postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 9: Create `web/components.json`** (shadcn/ui config, consumed by `npx shadcn add` in later tasks)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 10: Create `web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 11: Create `web/src/lib/utils.ts`**

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 12: Create `web/src/test/setup.ts`**

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 13: Create `web/src/App.tsx`**

```tsx
export function App() {
  return (
    <div className="container py-8">
      <h1 className="text-2xl font-bold">Pool League Dashboard</h1>
    </div>
  );
}
```

- [ ] **Step 14: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 15: Write the failing smoke test — `web/src/App.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the dashboard heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Pool League Dashboard' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 16: Run the test to verify it fails**

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: FAIL — `Cannot find module './App'` or similar, since `App.tsx`/`main.tsx`/config files don't fully resolve together until this step. (If Steps 1–14 were followed exactly, this may actually already PASS — in that case, skip to Step 18. The point of this step is to confirm the toolchain itself works, not to force an artificial RED.)

- [ ] **Step 17: Run the test to verify it passes**

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 18: Create the env-generation script — `web/scripts/generate-env.mjs`**

```javascript
// web/scripts/generate-env.mjs
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const webDir = path.resolve(__dirname, '..');

const output = execSync('npx supabase status -o env', { encoding: 'utf-8', cwd: repoRoot });
const env = {};
for (const line of output.split('\n')) {
  const match = line.match(/^(\w+)="?(.*?)"?$/);
  if (match) env[match[1]] = match[2];
}

if (!env.API_URL || !env.ANON_KEY) {
  console.error('Could not read API_URL/ANON_KEY from `supabase status -o env`. Is `supabase start` running?');
  process.exit(1);
}

const content = `VITE_SUPABASE_URL=${env.API_URL}\nVITE_SUPABASE_ANON_KEY=${env.ANON_KEY}\n`;
writeFileSync(path.join(webDir, '.env.local'), content);
console.log('Wrote web/.env.local');
```

- [ ] **Step 19: Create `web/.gitignore`**

```
node_modules/
dist/
.env.local
```

- [ ] **Step 20: Verify the env script against the running local stack**

Ensure `npx supabase start` has been run from the repo root (see `supabase/functions/README.md` for the known OneDrive file-watcher flake if `functions serve` misbehaves — not relevant to this step, which only needs Postgres/Auth/REST up).

Run: `cd web && npm run env:generate`
Expected: prints `Wrote web/.env.local`, and `web/.env.local` contains two `VITE_SUPABASE_*` lines with real values (not empty).

- [ ] **Step 21: Manual verification**

Run: `cd web && npm run dev`
Expected: Vite prints a local URL (e.g. `http://localhost:5173`). Open it in a browser — confirms "Pool League Dashboard" heading renders, Tailwind's base styles are applied (system font, no unstyled flash). Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 22: Commit**

```bash
cd web && git add -A
cd .. && git add web/
git commit -m "feat: scaffold Vite + React + TypeScript + Tailwind frontend project"
```

---

### Task 2: Supabase client, TanStack Query, shared types, base shadcn/ui components

**Files:**
- Create: `web/src/lib/types.ts`
- Create: `web/src/lib/supabaseClient.ts`
- Create: `web/src/lib/supabaseClient.test.ts`
- Create: `web/src/lib/queryKeys.ts`
- Modify: `web/src/main.tsx`
- Create: `web/src/components/ui/button.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/card.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/badge.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/table.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/input.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/label.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/dialog.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/alert-dialog.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/select.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/sonner.tsx` (generated by shadcn CLI)
- Create: `web/src/components/ui/skeleton.tsx` (generated by shadcn CLI)

**Interfaces:**
- Consumes: `web/.env.local`'s `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (Task 1).
- Produces: `supabase` client instance (`web/src/lib/supabaseClient.ts`), the `queryKeys` object (`web/src/lib/queryKeys.ts`), and every domain type in `web/src/lib/types.ts` — every later task's hooks and components import from these two files rather than redefining shapes.

- [ ] **Step 1: Create the shared domain types — `web/src/lib/types.ts`**

```typescript
// web/src/lib/types.ts

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';

export interface LeaderboardEntry {
  player_id: string;
  full_name: string;
  season_id: string;
  rating: number;
  grade: Grade;
  season_points: number;
  rank: number;
}

export interface GradeDistributionEntry {
  season_id: string;
  grade: Grade;
  player_count: number;
}

export interface PlayerSeasonRating {
  id: string;
  player_id: string;
  season_id: string;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  is_provisional: boolean;
  grade: Grade;
  season_points: number;
}

export interface PlayerStatistics {
  id: string;
  player_id: string;
  season_id: string;
  wins: number;
  losses: number;
  win_pct: number;
  current_streak: number;
  longest_streak: number;
  frames_won: number;
  frames_lost: number;
  avg_opponent_rating: number | null;
  form_5: number | null;
  form_10: number | null;
  form_score: number | null;
}

export type RatingEventType = 'instant' | 'weekly_reconciliation' | 'season_carryover';

export interface RatingEvent {
  id: string;
  match_id: string | null;
  player_id: string;
  season_id: string;
  rating_before: number;
  rating_after: number;
  delta: number;
  event_type: RatingEventType;
  created_at: string;
}

export interface PlayerSummary {
  id: string;
  full_name: string;
}

export interface MatchRow {
  id: string;
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
  winner_id: string;
  is_voided: boolean;
  is_period_closed: boolean;
  player_a: PlayerSummary;
  player_b: PlayerSummary;
}

export interface Season {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: 'draft' | 'active' | 'completed';
}
```

- [ ] **Step 2: Create the Supabase client — `web/src/lib/supabaseClient.ts`**

```typescript
// web/src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Run `npm run env:generate` (requires `supabase start`).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 3: Write the failing test — `web/src/lib/supabaseClient.test.ts`**

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('supabaseClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  it('constructs a client when env vars are present', async () => {
    const { supabase } = await import('./supabaseClient');
    expect(supabase).toBeDefined();
    expect(supabase.supabaseUrl).toBe('http://127.0.0.1:54321');
  });

  it('throws a clear error when env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    await expect(import('./supabaseClient')).rejects.toThrow(/Missing VITE_SUPABASE_URL/);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/supabaseClient.test.ts`
Expected: FAIL — `Cannot find module './supabaseClient'` (file doesn't exist yet if you're doing a strict RED check; if Step 2 was already written, this instead validates the throw-on-missing-env branch — either way, confirm the second test fails without Step 2's guard clause by temporarily commenting it out, then restore it).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/supabaseClient.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Create the query key factory — `web/src/lib/queryKeys.ts`**

```typescript
// web/src/lib/queryKeys.ts
export const queryKeys = {
  leaderboard: (seasonId: string) => ['leaderboard', seasonId] as const,
  gradeDistribution: (seasonId: string) => ['gradeDistribution', seasonId] as const,
  playerProfile: (playerId: string, seasonId: string) => ['playerProfile', playerId, seasonId] as const,
  matchHistory: (seasonId: string) => ['matchHistory', seasonId] as const,
  openMatches: (seasonId: string) => ['openMatches', seasonId] as const,
  seasons: () => ['seasons'] as const,
  activeSeason: () => ['activeSeason'] as const,
};
```

- [ ] **Step 7: Wire `QueryClientProvider` and the toast `<Toaster />` into `web/src/main.tsx`**

```tsx
// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { Toaster } from '@/components/ui/sonner';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Add base shadcn/ui components**

Run (from `web/`, non-interactive since `components.json` already exists from Task 1):

```bash
cd web && npx shadcn@latest add button card badge table input label dialog alert-dialog select sonner skeleton --yes
```

Expected: creates the eleven files listed under **Files** above, plus updates `web/src/index.css` if the CLI appends any additional CSS variables (review the diff — it should be additive only, not remove the base variables from Task 1 Step 10).

- [ ] **Step 9: Manual verification**

Run: `cd web && npm run dev`
Expected: still boots cleanly (this task added a `QueryClientProvider` wrapper and a `<Toaster />` but `App.tsx` itself is unchanged, so the same heading renders). Confirm no console errors about missing Radix/shadcn dependencies.

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (3 tests: the Task 1 smoke test + 2 from this task)

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat: add Supabase client, TanStack Query, shared types, base shadcn/ui components"
```

---

### Task 3: React Router shell, TopNav, public route stubs

**Files:**
- Create: `web/src/components/TopNav.tsx`
- Create: `web/src/components/TopNav.test.tsx`
- Create: `web/src/pages/Leaderboard.tsx`
- Create: `web/src/pages/PlayerProfile.tsx`
- Create: `web/src/pages/GradeDistribution.tsx`
- Create: `web/src/pages/MatchHistory.tsx`
- Create: `web/src/pages/NotFound.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

**Interfaces:**
- Produces: the four public page components (stub bodies for now — Tasks 6, 8, 9, 10 replace their contents with real implementations, same file, same default export name, same route).

- [ ] **Step 1: Create stub page components**

```tsx
// web/src/pages/Leaderboard.tsx
export function LeaderboardPage() {
  return <p>Leaderboard — coming soon</p>;
}
```

```tsx
// web/src/pages/PlayerProfile.tsx
export function PlayerProfilePage() {
  return <p>Player profile — coming soon</p>;
}
```

```tsx
// web/src/pages/GradeDistribution.tsx
export function GradeDistributionPage() {
  return <p>Grade distribution — coming soon</p>;
}
```

```tsx
// web/src/pages/MatchHistory.tsx
export function MatchHistoryPage() {
  return <p>Match history — coming soon</p>;
}
```

```tsx
// web/src/pages/NotFound.tsx
export function NotFoundPage() {
  return <p>Page not found.</p>;
}
```

- [ ] **Step 2: Create `web/src/components/TopNav.tsx`**

```tsx
// web/src/components/TopNav.tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
];

export function TopNav() {
  return (
    <nav className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-semibold">🎱 Pool League</span>
        <div className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground font-medium')
              }
            >
              {link.label}
            </NavLink>
          ))}
          <NavLink to="/admin/login" className="text-muted-foreground hover:text-foreground">
            Admin login
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Write the failing test — `web/src/components/TopNav.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopNav } from './TopNav';

describe('TopNav', () => {
  it('renders links to every public page plus admin login', () => {
    render(
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/grades');
    expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/matches');
    expect(screen.getByRole('link', { name: 'Admin login' })).toHaveAttribute('href', '/admin/login');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/TopNav.test.tsx`
Expected: FAIL — `Cannot find module './TopNav'`

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/TopNav.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 6: Wire up the router — modify `web/src/App.tsx`**

```tsx
// web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { NotFoundPage } from '@/pages/NotFound';

export function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <main className="container py-8">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/grades" element={<GradeDistributionPage />} />
          <Route path="/matches" element={<MatchHistoryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

- [ ] **Step 7: Update the App smoke test to match the new heading-free shell — modify `web/src/App.test.tsx`**

```tsx
// web/src/App.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the top nav and the leaderboard page at the root route', () => {
    render(<App />);
    expect(screen.getByText('🎱 Pool League')).toBeInTheDocument();
    expect(screen.getByText('Leaderboard — coming soon')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (5 tests total: App, 2×supabaseClient, TopNav, and the updated App test replaces the old one — confirm the count matches what's actually in the suite rather than assuming)

- [ ] **Step 9: Manual verification**

Run: `cd web && npm run dev`. Visit `/`, `/grades`, `/matches`, `/players/anything`, and a nonsense path like `/xyz`.
Expected: each route renders its stub text and the nav; `/xyz` renders "Page not found."; clicking nav links updates the active-link styling.

- [ ] **Step 10: Commit**

```bash
git add web/
git commit -m "feat: add React Router shell, TopNav, public route stubs"
```

---

### Task 4: `GradeBadge` component

**Files:**
- Create: `web/src/components/GradeBadge.tsx`
- Create: `web/src/components/GradeBadge.test.tsx`

**Interfaces:**
- Consumes: `Grade` type (`web/src/lib/types.ts`, Task 2).
- Produces: `<GradeBadge grade={Grade} />` — consumed by `Leaderboard` (Task 6), `PlayerProfile` (Task 8), and `GradeDistribution` (Task 10).

- [ ] **Step 1: Write the failing test — `web/src/components/GradeBadge.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeBadge } from './GradeBadge';
import type { Grade } from '@/lib/types';

describe('GradeBadge', () => {
  it.each<[Grade, string]>([
    ['A+', 'bg-green-700'],
    ['A', 'bg-green-600'],
    ['B+', 'bg-lime-600'],
    ['B', 'bg-yellow-500'],
    ['C+', 'bg-orange-500'],
    ['C', 'bg-orange-700'],
    ['D', 'bg-red-700'],
  ])('renders %s with the %s background class', (grade, expectedClass) => {
    render(<GradeBadge grade={grade} />);
    const badge = screen.getByText(grade);
    expect(badge.className).toContain(expectedClass);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/GradeBadge.test.tsx`
Expected: FAIL — `Cannot find module './GradeBadge'`

- [ ] **Step 3: Create `web/src/components/GradeBadge.tsx`**

```tsx
// web/src/components/GradeBadge.tsx
import { cn } from '@/lib/utils';
import type { Grade } from '@/lib/types';

const GRADE_COLORS: Record<Grade, string> = {
  'A+': 'bg-green-700',
  A: 'bg-green-600',
  'B+': 'bg-lime-600',
  B: 'bg-yellow-500',
  'C+': 'bg-orange-500',
  C: 'bg-orange-700',
  D: 'bg-red-700',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white',
        GRADE_COLORS[grade],
      )}
    >
      {grade}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/GradeBadge.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: add GradeBadge component"
```

---

### Task 5: `MatchTable` component

**Files:**
- Create: `web/src/components/MatchTable.tsx`
- Create: `web/src/components/MatchTable.test.tsx`

**Interfaces:**
- Consumes: `MatchRow` type (`web/src/lib/types.ts`, Task 2), shadcn `Table` primitives (Task 2).
- Produces: `<MatchTable matches={MatchRow[]} />` — a league-wide match list (date, both players, score). Consumed by `MatchHistory` (Task 9). `PlayerProfile` (Task 8) does NOT use this component — it needs a per-player "opponent / result / rating delta" shape that's different enough to warrant its own render logic rather than forcing one component to cover both shapes.

- [ ] **Step 1: Write the failing test — `web/src/components/MatchTable.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchTable } from './MatchTable';
import type { MatchRow } from '@/lib/types';

const matches: MatchRow[] = [
  {
    id: 'm1',
    season_id: 's1',
    match_date: '2026-01-22',
    player_a_id: 'p1',
    player_b_id: 'p2',
    frames_a: 5,
    frames_b: 2,
    winner_id: 'p1',
    is_voided: false,
    is_period_closed: true,
    player_a: { id: 'p1', full_name: 'Alex Testplayer' },
    player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
  },
  {
    id: 'm2',
    season_id: 's1',
    match_date: '2026-01-15',
    player_a_id: 'p3',
    player_b_id: 'p4',
    frames_a: 3,
    frames_b: 5,
    winner_id: 'p4',
    is_voided: true,
    is_period_closed: false,
    player_a: { id: 'p3', full_name: 'Sam Testplayer' },
    player_b: { id: 'p4', full_name: 'Casey Testplayer' },
  },
];

describe('MatchTable', () => {
  it('renders one row per match with date, players, and score', () => {
    render(<MatchTable matches={matches} />);
    expect(screen.getByText('2026-01-22')).toBeInTheDocument();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
  });

  it('marks voided matches so they are visually distinguishable', () => {
    render(<MatchTable matches={matches} />);
    const voidedRow = screen.getByText('Sam Testplayer').closest('tr');
    expect(voidedRow).not.toBeNull();
    expect(voidedRow).toHaveTextContent('voided');
    expect(voidedRow?.className).toContain('opacity-50');
  });

  it('renders an empty state when there are no matches', () => {
    render(<MatchTable matches={[]} />);
    expect(screen.getByText('No matches yet.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/MatchTable.test.tsx`
Expected: FAIL — `Cannot find module './MatchTable'`

- [ ] **Step 3: Create `web/src/components/MatchTable.tsx`**

```tsx
// web/src/components/MatchTable.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { MatchRow } from '@/lib/types';

export function MatchTable({ matches }: { matches: MatchRow[] }) {
  if (matches.length === 0) {
    return <p className="text-muted-foreground text-sm">No matches yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Player A</TableHead>
          <TableHead>Player B</TableHead>
          <TableHead>Score</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {matches.map((match) => (
          <TableRow key={match.id} className={cn(match.is_voided && 'opacity-50')}>
            <TableCell>{match.match_date}</TableCell>
            <TableCell className={cn(match.winner_id === match.player_a_id && 'font-semibold')}>
              {match.player_a.full_name}
            </TableCell>
            <TableCell className={cn(match.winner_id === match.player_b_id && 'font-semibold')}>
              {match.player_b.full_name}
            </TableCell>
            <TableCell>
              {match.frames_a}–{match.frames_b}
              {match.is_voided && <span className="ml-2 text-xs italic">(voided)</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/MatchTable.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: add MatchTable component"
```

---

### Task 6: `useActiveSeason` + `useLeaderboard` hooks, real `Leaderboard` page

**Files:**
- Create: `web/src/hooks/useActiveSeason.ts`
- Create: `web/src/hooks/useActiveSeason.test.ts`
- Create: `web/src/hooks/useLeaderboard.ts`
- Create: `web/src/hooks/useLeaderboard.test.ts`
- Modify: `web/src/pages/Leaderboard.tsx`
- Create: `web/src/pages/Leaderboard.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 2), `queryKeys` (Task 2), `Season`/`LeaderboardEntry` types (Task 2), `GradeBadge` (Task 4).
- Produces: `useActiveSeason(): UseQueryResult<Season>` — consumed by every later page/hook that needs "the current season" (`PlayerProfile`, `MatchHistory`, `GradeDistribution`, and all four admin pages). `useLeaderboard(seasonId: string | undefined): UseQueryResult<LeaderboardEntry[]>`.

**Note on scope vs. the approved mockup:** the brainstorming mockup showed an extra greyed-out row for players below the 3-match ranking threshold. `leaderboard_view` (Phase 2, `supabase/migrations/20260714030000_views.sql`) already excludes those players server-side (`where matches_played >= 3`), and the Global Constraints for this plan forbid re-deriving that filter client-side. Showing them would require a second, unspecified query against `player_season_ratings` unioned in — out of scope for this task. The page shows exactly what `leaderboard_view` returns.

- [ ] **Step 1: Write the failing test — `web/src/hooks/useActiveSeason.test.ts`**

```typescript
// web/src/hooks/useActiveSeason.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockSingle = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockSingle,
        }),
      }),
    }),
  },
}));

import { useActiveSeason } from './useActiveSeason';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useActiveSeason', () => {
  beforeEach(() => {
    mockSingle.mockReset();
  });

  it('returns the season with status=active', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
      error: null,
    });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('s1');
    expect(result.current.data?.status).toBe('active');
  });

  it('surfaces a query error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'no active season' } });

    const { result } = renderHook(() => useActiveSeason(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useActiveSeason.test.ts`
Expected: FAIL — `Cannot find module './useActiveSeason'`

- [ ] **Step 3: Create `web/src/hooks/useActiveSeason.ts`**

```typescript
// web/src/hooks/useActiveSeason.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

export function useActiveSeason() {
  return useQuery({
    queryKey: queryKeys.activeSeason(),
    queryFn: async (): Promise<Season> => {
      const { data, error } = await supabase.from('seasons').select('*').eq('status', 'active').single();
      if (error) throw error;
      return data as Season;
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useActiveSeason.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/hooks/useLeaderboard.test.ts`**

```typescript
// web/src/hooks/useLeaderboard.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: mockOrder,
        }),
      }),
    }),
  },
}));

import { useLeaderboard } from './useLeaderboard';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useLeaderboard', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('returns ranked entries for the given season', async () => {
    mockOrder.mockResolvedValue({
      data: [{ player_id: 'p1', full_name: 'Alex', season_id: 's1', rating: 1768, grade: 'A+', season_points: 142, rank: 1 }],
      error: null,
    });

    const { result } = renderHook(() => useLeaderboard('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].rank).toBe(1);
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useLeaderboard(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useLeaderboard.test.ts`
Expected: FAIL — `Cannot find module './useLeaderboard'`

- [ ] **Step 7: Create `web/src/hooks/useLeaderboard.ts`**

```typescript
// web/src/hooks/useLeaderboard.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { LeaderboardEntry } from '@/lib/types';

export function useLeaderboard(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.leaderboard(seasonId ?? ''),
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const { data, error } = await supabase
        .from('leaderboard_view')
        .select('*')
        .eq('season_id', seasonId as string)
        .order('rank', { ascending: true });
      if (error) throw error;
      return data as LeaderboardEntry[];
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useLeaderboard.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test — `web/src/pages/Leaderboard.test.tsx`**

```tsx
// web/src/pages/Leaderboard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

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
  it('renders a row per leaderboard entry with a link to the player profile', () => {
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Alex Testplayer/ });
    expect(link).toHaveAttribute('href', '/players/p1');
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/Leaderboard.test.tsx`
Expected: FAIL — the stub page from Task 3 renders "Leaderboard — coming soon", not a table.

- [ ] **Step 11: Replace the stub — modify `web/src/pages/Leaderboard.tsx`**

```tsx
// web/src/pages/Leaderboard.tsx
import { Link } from 'react-router-dom';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useLeaderboard } from '@/hooks/useLeaderboard';

export function LeaderboardPage() {
  const activeSeason = useActiveSeason();
  const leaderboard = useLeaderboard(activeSeason.data?.id);

  if (activeSeason.isLoading || leaderboard.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || leaderboard.isError) {
    return <p className="text-destructive">Couldn't load the leaderboard. Try refreshing.</p>;
  }

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Leaderboard</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Player</TableHead>
            <TableHead>Grade</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Season Pts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leaderboard.data?.map((entry) => (
            <TableRow key={entry.player_id}>
              <TableCell>{entry.rank}</TableCell>
              <TableCell>
                <Link to={`/players/${entry.player_id}`} className="hover:underline">
                  {entry.full_name}
                </Link>
              </TableCell>
              <TableCell>
                <GradeBadge grade={entry.grade} />
              </TableCell>
              <TableCell>{entry.rating}</TableCell>
              <TableCell>{entry.season_points}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/Leaderboard.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 13: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 14: Manual verification**

From the repo root: `npx supabase start` (if not already running), then `npm run seed` to populate real data. From `web/`: `npm run dev`, visit `/`.
Expected: real leaderboard data from the seed script renders — 30 players, varied ratings, correct grade badge colors, ranked 1 through N, player names link to `/players/:id` (404s until Task 8, that's expected for now).

- [ ] **Step 15: Commit**

```bash
git add web/
git commit -m "feat: add useActiveSeason/useLeaderboard hooks and real Leaderboard page"
```

---

### Task 7: Rating-history data-shaping + `RatingChart` component

**Files:**
- Create: `web/src/lib/ratingHistory.ts`
- Create: `web/src/lib/ratingHistory.test.ts`
- Create: `web/src/components/RatingChart.tsx`
- Create: `web/src/components/RatingChart.test.tsx`
- Modify: `web/src/test/setup.ts`

**Interfaces:**
- Consumes: `RatingEvent` type (`web/src/lib/types.ts`, Task 2).
- Produces: `toRatingHistoryPoints(events: RatingEvent[]): RatingHistoryPoint[]` and `<RatingChart points={RatingHistoryPoint[]} />` — consumed by `PlayerProfile` (Task 8).

- [ ] **Step 1: Write the failing test — `web/src/lib/ratingHistory.test.ts`**

```typescript
// web/src/lib/ratingHistory.test.ts
import { describe, it, expect } from 'vitest';
import { toRatingHistoryPoints } from './ratingHistory';
import type { RatingEvent } from './types';

function event(overrides: Partial<RatingEvent>): RatingEvent {
  return {
    id: 'e1',
    match_id: 'm1',
    player_id: 'p1',
    season_id: 's1',
    rating_before: 1500,
    rating_after: 1500,
    delta: 0,
    event_type: 'instant',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('toRatingHistoryPoints', () => {
  it('maps each event to a { date, rating } point using rating_after', () => {
    const points = toRatingHistoryPoints([event({ created_at: '2026-01-08T10:00:00Z', rating_after: 1514.2 })]);
    expect(points).toEqual([{ date: '2026-01-08', rating: 1514.2 }]);
  });

  it('sorts points chronologically regardless of input order', () => {
    const points = toRatingHistoryPoints([
      event({ created_at: '2026-01-15T10:00:00Z', rating_after: 1530 }),
      event({ created_at: '2026-01-08T10:00:00Z', rating_after: 1514 }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('returns an empty array for no events', () => {
    expect(toRatingHistoryPoints([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/ratingHistory.test.ts`
Expected: FAIL — `Cannot find module './ratingHistory'`

- [ ] **Step 3: Create `web/src/lib/ratingHistory.ts`**

```typescript
// web/src/lib/ratingHistory.ts
import type { RatingEvent } from './types';

export interface RatingHistoryPoint {
  date: string;
  rating: number;
}

export function toRatingHistoryPoints(events: RatingEvent[]): RatingHistoryPoint[] {
  return events
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((event) => ({
      date: event.created_at.slice(0, 10),
      rating: event.rating_after,
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/ratingHistory.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add a `ResizeObserver` mock for Recharts — modify `web/src/test/setup.ts`**

Recharts' `ResponsiveContainer` requires `ResizeObserver`, which jsdom doesn't implement.

```typescript
// web/src/test/setup.ts
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;
```

- [ ] **Step 6: Write the failing test — `web/src/components/RatingChart.test.tsx`**

```tsx
// web/src/components/RatingChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingChart } from './RatingChart';

describe('RatingChart', () => {
  it('renders the chart container when points are provided', () => {
    render(<RatingChart points={[{ date: '2026-01-08', rating: 1514 }]} />);
    expect(screen.getByTestId('rating-chart')).toBeInTheDocument();
  });

  it('renders an empty state when there are no points', () => {
    render(<RatingChart points={[]} />);
    expect(screen.getByText('No rating history yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('rating-chart')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/RatingChart.test.tsx`
Expected: FAIL — `Cannot find module './RatingChart'`

- [ ] **Step 8: Create `web/src/components/RatingChart.tsx`**

```tsx
// web/src/components/RatingChart.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { RatingHistoryPoint } from '@/lib/ratingHistory';

export function RatingChart({ points }: { points: RatingHistoryPoint[] }) {
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No rating history yet.</p>;
  }

  return (
    <div data-testid="rating-chart" style={{ width: '100%', height: 200 }}>
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

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/RatingChart.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat: add rating-history data-shaping and RatingChart component"
```

---

### Task 8: `usePlayerProfile` hook, match data-shaping, real `PlayerProfile` page

**Files:**
- Create: `web/src/lib/playerProfileMatches.ts`
- Create: `web/src/lib/playerProfileMatches.test.ts`
- Create: `web/src/hooks/usePlayerProfile.ts`
- Create: `web/src/hooks/usePlayerProfile.test.ts`
- Modify: `web/src/pages/PlayerProfile.tsx`
- Create: `web/src/pages/PlayerProfile.test.tsx`

**Interfaces:**
- Consumes: `PlayerSeasonRating`/`PlayerStatistics`/`RatingEvent`/`MatchRow`/`PlayerSummary` types (Task 2), `GradeBadge` (Task 4), `toRatingHistoryPoints`/`RatingChart` (Task 7), `useActiveSeason` (Task 6).
- Produces: `toPlayerProfileMatches(playerId, matches, ratingEvents): PlayerProfileMatch[]`, `usePlayerProfile(playerId, seasonId): UseQueryResult<PlayerProfileData>`.

- [ ] **Step 1: Write the failing test — `web/src/lib/playerProfileMatches.test.ts`**

```typescript
// web/src/lib/playerProfileMatches.test.ts
import { describe, it, expect } from 'vitest';
import { toPlayerProfileMatches } from './playerProfileMatches';
import type { MatchRow, RatingEvent } from './types';

const match: MatchRow = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-01-22',
  player_a_id: 'p1',
  player_b_id: 'p2',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  is_period_closed: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer' },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
};

const instantEvent: RatingEvent = {
  id: 'e1',
  match_id: 'm1',
  player_id: 'p1',
  season_id: 's1',
  rating_before: 1754,
  rating_after: 1768.2,
  delta: 14.2,
  event_type: 'instant',
  created_at: '2026-01-22T18:00:00Z',
};

describe('toPlayerProfileMatches', () => {
  it('resolves the opponent as the other player when the target is player A', () => {
    const [result] = toPlayerProfileMatches('p1', [match], [instantEvent]);
    expect(result.opponent_id).toBe('p2');
    expect(result.opponent_name).toBe('Jordan Testplayer');
    expect(result.frames_for).toBe(5);
    expect(result.frames_against).toBe(2);
    expect(result.won).toBe(true);
  });

  it('resolves the opponent as player A when the target is player B, and flips frames/won', () => {
    const [result] = toPlayerProfileMatches('p2', [match], [instantEvent]);
    expect(result.opponent_id).toBe('p1');
    expect(result.opponent_name).toBe('Alex Testplayer');
    expect(result.frames_for).toBe(2);
    expect(result.frames_against).toBe(5);
    expect(result.won).toBe(false);
  });

  it('attaches the instant rating_events delta for the matching match_id', () => {
    const [result] = toPlayerProfileMatches('p1', [match], [instantEvent]);
    expect(result.rating_delta).toBe(14.2);
  });

  it('leaves rating_delta null when no instant event exists for that match', () => {
    const [result] = toPlayerProfileMatches('p1', [match], []);
    expect(result.rating_delta).toBeNull();
  });

  it('sorts matches most-recent-first', () => {
    const older: MatchRow = { ...match, id: 'm0', match_date: '2026-01-15' };
    const results = toPlayerProfileMatches('p1', [older, match], []);
    expect(results.map((r) => r.id)).toEqual(['m1', 'm0']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/playerProfileMatches.test.ts`
Expected: FAIL — `Cannot find module './playerProfileMatches'`

- [ ] **Step 3: Create `web/src/lib/playerProfileMatches.ts`**

```typescript
// web/src/lib/playerProfileMatches.ts
import type { MatchRow, RatingEvent } from './types';

export interface PlayerProfileMatch {
  id: string;
  match_date: string;
  opponent_id: string;
  opponent_name: string;
  frames_for: number;
  frames_against: number;
  won: boolean;
  is_voided: boolean;
  rating_delta: number | null;
}

export function toPlayerProfileMatches(
  playerId: string,
  matches: MatchRow[],
  ratingEvents: RatingEvent[],
): PlayerProfileMatch[] {
  const deltaByMatchId = new Map<string, number>();
  for (const event of ratingEvents) {
    if (event.event_type === 'instant' && event.match_id) {
      deltaByMatchId.set(event.match_id, event.delta);
    }
  }

  return matches
    .slice()
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
    .map((match) => {
      const isPlayerA = match.player_a_id === playerId;
      const opponent = isPlayerA ? match.player_b : match.player_a;
      return {
        id: match.id,
        match_date: match.match_date,
        opponent_id: isPlayerA ? match.player_b_id : match.player_a_id,
        opponent_name: opponent.full_name,
        frames_for: isPlayerA ? match.frames_a : match.frames_b,
        frames_against: isPlayerA ? match.frames_b : match.frames_a,
        won: match.winner_id === playerId,
        is_voided: match.is_voided,
        rating_delta: deltaByMatchId.get(match.id) ?? null,
      };
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/playerProfileMatches.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing test — `web/src/hooks/usePlayerProfile.test.ts`**

```typescript
// web/src/hooks/usePlayerProfile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const playerResult = { data: { id: 'p1', full_name: 'Alex Testplayer' }, error: null };
const ratingResult = {
  data: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
  error: null,
};
const statsResult = { data: null, error: null };
const eventsResult = { data: [], error: null };
const matchesResult = { data: [], error: null };

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve(playerResult) }) }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(ratingResult) }) }) }) };
      }
      if (table === 'player_statistics') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(statsResult) }) }) }) };
      }
      if (table === 'rating_events') {
        return { select: () => ({ eq: () => ({ eq: () => Promise.resolve(eventsResult) }) }) };
      }
      if (table === 'matches') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                or: () => ({
                  order: () => ({
                    limit: () => Promise.resolve(matchesResult),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

import { usePlayerProfile } from './usePlayerProfile';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayerProfile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('combines player, rating, statistics, events, and matches into one result', async () => {
    const { result } = renderHook(() => usePlayerProfile('p1', 's1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.player.full_name).toBe('Alex Testplayer');
    expect(result.current.data?.seasonRating.grade).toBe('A+');
    expect(result.current.data?.statistics).toBeNull();
    expect(result.current.data?.ratingEvents).toEqual([]);
    expect(result.current.data?.matches).toEqual([]);
  });

  it('does not run when playerId or seasonId is undefined', () => {
    const { result } = renderHook(() => usePlayerProfile(undefined, 's1'), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/usePlayerProfile.test.ts`
Expected: FAIL — `Cannot find module './usePlayerProfile'`

- [ ] **Step 7: Create `web/src/hooks/usePlayerProfile.ts`**

```typescript
// web/src/hooks/usePlayerProfile.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { PlayerSeasonRating, PlayerStatistics, RatingEvent, MatchRow, PlayerSummary } from '@/lib/types';

export interface PlayerProfileData {
  player: PlayerSummary;
  seasonRating: PlayerSeasonRating;
  statistics: PlayerStatistics | null;
  ratingEvents: RatingEvent[];
  matches: MatchRow[];
}

export function usePlayerProfile(playerId: string | undefined, seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.playerProfile(playerId ?? '', seasonId ?? ''),
    queryFn: async (): Promise<PlayerProfileData> => {
      const [playerRes, ratingRes, statsRes, eventsRes, matchesRes] = await Promise.all([
        supabase.from('players').select('id, full_name').eq('id', playerId as string).single(),
        supabase
          .from('player_season_ratings')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .single(),
        supabase
          .from('player_statistics')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string)
          .maybeSingle(),
        supabase
          .from('rating_events')
          .select('*')
          .eq('player_id', playerId as string)
          .eq('season_id', seasonId as string),
        supabase
          .from('matches')
          .select('*, player_a:player_a_id(id, full_name), player_b:player_b_id(id, full_name)')
          .eq('season_id', seasonId as string)
          .eq('is_voided', false)
          .or(`player_a_id.eq.${playerId},player_b_id.eq.${playerId}`)
          .order('match_date', { ascending: false })
          .limit(20),
      ]);

      if (playerRes.error) throw playerRes.error;
      if (ratingRes.error) throw ratingRes.error;
      if (statsRes.error) throw statsRes.error;
      if (eventsRes.error) throw eventsRes.error;
      if (matchesRes.error) throw matchesRes.error;

      return {
        player: playerRes.data as PlayerSummary,
        seasonRating: ratingRes.data as PlayerSeasonRating,
        statistics: statsRes.data as PlayerStatistics | null,
        ratingEvents: eventsRes.data as RatingEvent[],
        matches: matchesRes.data as unknown as MatchRow[],
      };
    },
    enabled: playerId !== undefined && seasonId !== undefined,
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/usePlayerProfile.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test — `web/src/pages/PlayerProfile.test.tsx`**

```tsx
// web/src/pages/PlayerProfile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/usePlayerProfile', () => ({
  usePlayerProfile: () => ({
    data: {
      player: { id: 'p1', full_name: 'Alex Testplayer' },
      seasonRating: { id: 'r1', player_id: 'p1', season_id: 's1', rating: 1768, rd: 210, volatility: 0.06, matches_played: 5, is_provisional: false, grade: 'A+', season_points: 142 },
      statistics: { id: 'st1', player_id: 'p1', season_id: 's1', wins: 4, losses: 1, win_pct: 80, current_streak: 3, longest_streak: 3, frames_won: 20, frames_lost: 8, avg_opponent_rating: 1500, form_5: 80, form_10: 80, form_score: 82 },
      ratingEvents: [],
      matches: [],
    },
    isLoading: false,
    isError: false,
  }),
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
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('1768')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('W3')).toBeInTheDocument();
    expect(screen.getByText('142')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/PlayerProfile.test.tsx`
Expected: FAIL — the stub page from Task 3 renders "Player profile — coming soon".

- [ ] **Step 11: Replace the stub — modify `web/src/pages/PlayerProfile.tsx`**

```tsx
// web/src/pages/PlayerProfile.tsx
import { useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { RatingChart } from '@/components/RatingChart';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { toRatingHistoryPoints } from '@/lib/ratingHistory';
import { toPlayerProfileMatches } from '@/lib/playerProfileMatches';

function streakLabel(streak: number): string {
  if (streak === 0) return '—';
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

export function PlayerProfilePage() {
  const { playerId } = useParams<{ playerId: string }>();
  const activeSeason = useActiveSeason();
  const profile = usePlayerProfile(playerId, activeSeason.data?.id);

  if (activeSeason.isLoading || profile.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || profile.isError || !profile.data) {
    return <p className="text-destructive">Couldn't load this player. Try refreshing.</p>;
  }

  const { player, seasonRating, statistics, ratingEvents, matches } = profile.data;
  const chartPoints = toRatingHistoryPoints(ratingEvents);
  const recentMatches = toPlayerProfileMatches(player.id, matches, ratingEvents);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">{player.full_name}</h1>
          <p className="text-muted-foreground text-sm">{activeSeason.data.name}</p>
        </div>
        <GradeBadge grade={seasonRating.grade} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">Rating</p>
          <p className="text-lg font-bold">{seasonRating.rating}</p>
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
          <p className="text-lg font-bold">{seasonRating.season_points}</p>
        </div>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Rating history</h2>
      <div className="mb-6">
        <RatingChart points={chartPoints} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase text-muted-foreground">Recent matches</h2>
      {recentMatches.length === 0 ? (
        <p className="text-muted-foreground text-sm">No matches yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Date</th>
              <th className="py-2">Opponent</th>
              <th className="py-2">Score</th>
              <th className="py-2">Result</th>
              <th className="py-2">Δ Rating</th>
            </tr>
          </thead>
          <tbody>
            {recentMatches.map((match) => (
              <tr key={match.id} className={match.is_voided ? 'opacity-50' : undefined}>
                <td className="py-2">{match.match_date}</td>
                <td className="py-2">{match.opponent_name}</td>
                <td className="py-2">
                  {match.frames_for}–{match.frames_against}
                </td>
                <td className={`py-2 ${match.won ? 'text-green-600' : ''}`}>{match.won ? 'Win' : 'Loss'}</td>
                <td className={`py-2 ${match.rating_delta !== null && match.rating_delta > 0 ? 'text-green-600' : ''}`}>
                  {match.rating_delta !== null ? match.rating_delta.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/PlayerProfile.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 13: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 14: Manual verification**

With the dev server running and seeded data present, click a player name from the Leaderboard page.
Expected: profile loads with real stat values, a populated rating chart, and a recent-matches table with correct opponent names/scores/results/deltas.

- [ ] **Step 15: Commit**

```bash
git add web/
git commit -m "feat: add usePlayerProfile hook and real PlayerProfile page"
```

---

### Task 9: `useMatchHistory` hook, real `MatchHistory` page

**Files:**
- Create: `web/src/hooks/useMatchHistory.ts`
- Create: `web/src/hooks/useMatchHistory.test.ts`
- Modify: `web/src/pages/MatchHistory.tsx`
- Create: `web/src/pages/MatchHistory.test.tsx`

**Interfaces:**
- Consumes: `MatchRow` type (Task 2), `MatchTable` (Task 5), `useActiveSeason` (Task 6).
- Produces: `useMatchHistory(seasonId): UseQueryResult<MatchRow[]>`.

- [ ] **Step 1: Write the failing test — `web/src/hooks/useMatchHistory.test.ts`**

```typescript
// web/src/hooks/useMatchHistory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: mockOrder,
        }),
      }),
    }),
  },
}));

import { useMatchHistory } from './useMatchHistory';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useMatchHistory', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns every match for the season, newest first', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 'm1', match_date: '2026-01-22', player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } }],
      error: null,
    });

    const { result } = renderHook(() => useMatchHistory('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockOrder).toHaveBeenCalledWith('match_date', { ascending: false });
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useMatchHistory(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useMatchHistory.test.ts`
Expected: FAIL — `Cannot find module './useMatchHistory'`

- [ ] **Step 3: Create `web/src/hooks/useMatchHistory.ts`**

```typescript
// web/src/hooks/useMatchHistory.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { MatchRow } from '@/lib/types';

export function useMatchHistory(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.matchHistory(seasonId ?? ''),
    queryFn: async (): Promise<MatchRow[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, player_a:player_a_id(id, full_name), player_b:player_b_id(id, full_name)')
        .eq('season_id', seasonId as string)
        .order('match_date', { ascending: false });
      if (error) throw error;
      return data as unknown as MatchRow[];
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useMatchHistory.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/pages/MatchHistory.test.tsx`**

```tsx
// web/src/pages/MatchHistory.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

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
  it('renders the match table with league-wide results', () => {
    renderPage();
    expect(screen.getByText('Alex Testplayer')).toBeInTheDocument();
    expect(screen.getByText('Jordan Testplayer')).toBeInTheDocument();
    expect(screen.getByText('5–2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx`
Expected: FAIL — the stub page from Task 3 renders "Match history — coming soon".

- [ ] **Step 7: Replace the stub — modify `web/src/pages/MatchHistory.tsx`**

```tsx
// web/src/pages/MatchHistory.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { MatchTable } from '@/components/MatchTable';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useMatchHistory } from '@/hooks/useMatchHistory';

export function MatchHistoryPage() {
  const activeSeason = useActiveSeason();
  const matchHistory = useMatchHistory(activeSeason.data?.id);

  if (activeSeason.isLoading || matchHistory.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || matchHistory.isError) {
    return <p className="text-destructive">Couldn't load match history. Try refreshing.</p>;
  }

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Match History</h1>
      <MatchTable matches={matchHistory.data ?? []} />
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/MatchHistory.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 9: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 10: Manual verification**

Visit `/matches` with the dev server running against seeded data.
Expected: every seeded match renders, newest first, winners bolded.

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat: add useMatchHistory hook and real MatchHistory page"
```

---

### Task 10: Grade-distribution data-shaping, `useGradeDistribution` hook, real `GradeDistribution` page

**Files:**
- Create: `web/src/lib/gradeDistribution.ts`
- Create: `web/src/lib/gradeDistribution.test.ts`
- Create: `web/src/hooks/useGradeDistribution.ts`
- Create: `web/src/hooks/useGradeDistribution.test.ts`
- Modify: `web/src/pages/GradeDistribution.tsx`
- Create: `web/src/pages/GradeDistribution.test.tsx`

**Interfaces:**
- Consumes: `Grade`/`GradeDistributionEntry` types (Task 2), `GradeBadge` (Task 4), `useActiveSeason` (Task 6).
- Produces: `toFullGradeDistribution(entries): GradeDistributionRow[]` (fills in every grade band, defaulting missing ones to 0, in fixed A+→D order), `useGradeDistribution(seasonId): UseQueryResult<GradeDistributionEntry[]>`.

- [ ] **Step 1: Write the failing test — `web/src/lib/gradeDistribution.test.ts`**

```typescript
// web/src/lib/gradeDistribution.test.ts
import { describe, it, expect } from 'vitest';
import { toFullGradeDistribution } from './gradeDistribution';
import type { GradeDistributionEntry } from './types';

describe('toFullGradeDistribution', () => {
  it('fills in all 7 grade bands in A+ -> D order, defaulting missing ones to 0', () => {
    const entries: GradeDistributionEntry[] = [
      { season_id: 's1', grade: 'B', player_count: 5 },
      { season_id: 's1', grade: 'A+', player_count: 2 },
    ];
    const result = toFullGradeDistribution(entries);
    expect(result.map((r) => r.grade)).toEqual(['A+', 'A', 'B+', 'B', 'C+', 'C', 'D']);
    expect(result.find((r) => r.grade === 'A+')?.player_count).toBe(2);
    expect(result.find((r) => r.grade === 'B')?.player_count).toBe(5);
    expect(result.find((r) => r.grade === 'D')?.player_count).toBe(0);
  });

  it('returns all-zero rows for an empty input', () => {
    const result = toFullGradeDistribution([]);
    expect(result.every((r) => r.player_count === 0)).toBe(true);
    expect(result).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/gradeDistribution.test.ts`
Expected: FAIL — `Cannot find module './gradeDistribution'`

- [ ] **Step 3: Create `web/src/lib/gradeDistribution.ts`**

```typescript
// web/src/lib/gradeDistribution.ts
import type { Grade, GradeDistributionEntry } from './types';

const GRADE_ORDER: Grade[] = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D'];

export interface GradeDistributionRow {
  grade: Grade;
  player_count: number;
}

export function toFullGradeDistribution(entries: GradeDistributionEntry[]): GradeDistributionRow[] {
  const countByGrade = new Map(entries.map((entry) => [entry.grade, entry.player_count]));
  return GRADE_ORDER.map((grade) => ({ grade, player_count: countByGrade.get(grade) ?? 0 }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/gradeDistribution.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/hooks/useGradeDistribution.test.ts`**

```typescript
// web/src/hooks/useGradeDistribution.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockEq = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: mockEq,
      }),
    }),
  },
}));

import { useGradeDistribution } from './useGradeDistribution';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useGradeDistribution', () => {
  beforeEach(() => mockEq.mockReset());

  it('returns the raw distribution rows for the season', async () => {
    mockEq.mockResolvedValue({ data: [{ season_id: 's1', grade: 'A+', player_count: 2 }], error: null });

    const { result } = renderHook(() => useGradeDistribution('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ season_id: 's1', grade: 'A+', player_count: 2 }]);
  });

  it('does not run the query when seasonId is undefined', () => {
    const { result } = renderHook(() => useGradeDistribution(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useGradeDistribution.test.ts`
Expected: FAIL — `Cannot find module './useGradeDistribution'`

- [ ] **Step 7: Create `web/src/hooks/useGradeDistribution.ts`**

```typescript
// web/src/hooks/useGradeDistribution.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { GradeDistributionEntry } from '@/lib/types';

export function useGradeDistribution(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.gradeDistribution(seasonId ?? ''),
    queryFn: async (): Promise<GradeDistributionEntry[]> => {
      const { data, error } = await supabase
        .from('grade_distribution_view')
        .select('*')
        .eq('season_id', seasonId as string);
      if (error) throw error;
      return data as GradeDistributionEntry[];
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useGradeDistribution.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test — `web/src/pages/GradeDistribution.test.tsx`**

```tsx
// web/src/pages/GradeDistribution.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

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

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GradeDistributionPage />
    </QueryClientProvider>,
  );
}

describe('GradeDistributionPage', () => {
  it('renders a row for every grade band, including zero-count ones', () => {
    renderPage();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: FAIL — the stub page from Task 3 renders "Grade distribution — coming soon".

- [ ] **Step 11: Replace the stub — modify `web/src/pages/GradeDistribution.tsx`**

```tsx
// web/src/pages/GradeDistribution.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { GradeBadge } from '@/components/GradeBadge';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useGradeDistribution } from '@/hooks/useGradeDistribution';
import { toFullGradeDistribution } from '@/lib/gradeDistribution';

export function GradeDistributionPage() {
  const activeSeason = useActiveSeason();
  const distribution = useGradeDistribution(activeSeason.data?.id);

  if (activeSeason.isLoading || distribution.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || distribution.isError) {
    return <p className="text-destructive">Couldn't load grade distribution. Try refreshing.</p>;
  }

  const rows = toFullGradeDistribution(distribution.data ?? []);
  const maxCount = Math.max(1, ...rows.map((r) => r.player_count));

  return (
    <div>
      <p className="text-muted-foreground text-sm">{activeSeason.data?.name}</p>
      <h1 className="mb-4 text-xl font-bold">Grade Distribution</h1>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.grade} className="flex items-center gap-3">
            <div className="w-10">
              <GradeBadge grade={row.grade} />
            </div>
            <div className="bg-muted h-4 flex-1 overflow-hidden rounded">
              <div
                className="h-full bg-primary"
                style={{ width: `${(row.player_count / maxCount) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-sm">{row.player_count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/GradeDistribution.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 13: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 14: Manual verification**

Visit `/grades` with the dev server running against seeded data.
Expected: all 7 grade bands render with proportional bars, zero-count bands still visible with an empty bar.

- [ ] **Step 15: Commit**

```bash
git add web/
git commit -m "feat: add grade-distribution data-shaping, hook, and real GradeDistribution page"
```

---

### Task 11: `useAuth`, `useIsAdmin`, `AdminRouteGuard`, `AdminLayout`/`AdminSidebar`, router wiring

**Files:**
- Create: `web/src/hooks/useAuth.tsx`
- Create: `web/src/hooks/useAuth.test.tsx`
- Create: `web/src/hooks/useIsAdmin.ts`
- Create: `web/src/hooks/useIsAdmin.test.ts`
- Create: `web/src/components/AdminRouteGuard.tsx`
- Create: `web/src/components/AdminRouteGuard.test.tsx`
- Create: `web/src/components/AdminSidebar.tsx`
- Create: `web/src/components/AdminLayout.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 2).
- Produces: `AuthProvider` (wraps the app in `main.tsx`), `useAuth(): { session: Session | null; isLoading: boolean }`, `useIsAdmin(userId): UseQueryResult<boolean>`, `<AdminRouteGuard />` (a route element using `<Outlet />`) — consumed by every admin page task (12, 14, 15, 16, 17).

- [ ] **Step 1: Write the failing test — `web/src/hooks/useAuth.test.tsx`**

```tsx
// web/src/hooks/useAuth.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: (cb: unknown) => mockOnAuthStateChange(cb),
    },
  },
}));

import { AuthProvider, useAuth } from './useAuth';

function Probe() {
  const { session, isLoading } = useAuth();
  if (isLoading) return <p>loading</p>;
  return <p>{session ? `signed in as ${session.user.email}` : 'signed out'}</p>;
}

describe('useAuth', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockOnAuthStateChange.mockReset();
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  });

  it('resolves the initial session from supabase.auth.getSession', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { email: 'admin@example.com' } } } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('signed in as admin@example.com')).toBeInTheDocument());
  });

  it('reflects a null session as signed out', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument());
  });

  it('throws when useAuth is called outside AuthProvider', () => {
    function Bare() {
      useAuth();
      return null;
    }
    expect(() => render(<Bare />)).toThrow('useAuth must be used within an AuthProvider');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useAuth.test.tsx`
Expected: FAIL — `Cannot find module './useAuth'`

- [ ] **Step 3: Create `web/src/hooks/useAuth.tsx`**

```tsx
// web/src/hooks/useAuth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, isLoading }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useAuth.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test — `web/src/hooks/useIsAdmin.test.ts`**

```typescript
// web/src/hooks/useIsAdmin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockMaybeSingle = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  },
}));

import { useIsAdmin } from './useIsAdmin';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useIsAdmin', () => {
  beforeEach(() => mockMaybeSingle.mockReset());

  it('resolves true when an admin_users row exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'u1' }, error: null });
    const { result } = renderHook(() => useIsAdmin('u1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(true);
  });

  it('resolves false when no admin_users row exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useIsAdmin('u2'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(false);
  });

  it('does not run when userId is undefined', () => {
    const { result } = renderHook(() => useIsAdmin(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useIsAdmin.test.ts`
Expected: FAIL — `Cannot find module './useIsAdmin'`

- [ ] **Step 7: Create `web/src/hooks/useIsAdmin.ts`**

```typescript
// web/src/hooks/useIsAdmin.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export function useIsAdmin(userId: string | undefined) {
  return useQuery({
    queryKey: ['isAdmin', userId ?? ''],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('admin_users')
        .select('id')
        .eq('id', userId as string)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },
    enabled: userId !== undefined,
  });
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useIsAdmin.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Write the failing test — `web/src/components/AdminRouteGuard.test.tsx`**

```tsx
// web/src/components/AdminRouteGuard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));

import { AdminRouteGuard } from './AdminRouteGuard';

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/admin/enter-match']}>
      <Routes>
        <Route path="/admin/login" element={<p>login page</p>} />
        <Route element={<AdminRouteGuard />}>
          <Route path="/admin/enter-match" element={<p>enter match page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRouteGuard', () => {
  it('redirects to /admin/login when there is no session', () => {
    mockUseAuth.mockReturnValue({ session: null, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows a not-authorized message for a signed-in non-admin', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: false, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText(/not authorized/i)).toBeInTheDocument();
  });

  it('renders the nested route for a signed-in admin', () => {
    mockUseAuth.mockReturnValue({ session: { user: { id: 'u1' } }, isLoading: false });
    mockUseIsAdmin.mockReturnValue({ data: true, isLoading: false, isError: false });
    renderGuarded();
    expect(screen.getByText('enter match page')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/AdminRouteGuard.test.tsx`
Expected: FAIL — `Cannot find module './AdminRouteGuard'`

- [ ] **Step 11: Create `web/src/components/AdminRouteGuard.tsx`**

```tsx
// web/src/components/AdminRouteGuard.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

export function AdminRouteGuard() {
  const { session, isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin(session?.user.id);

  if (authLoading || (session && isAdmin.isLoading)) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  if (isAdmin.isError || isAdmin.data === false) {
    return <p className="text-destructive">This account is not authorized as an admin.</p>;
  }

  return <Outlet />;
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/AdminRouteGuard.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 13: Create `web/src/components/AdminSidebar.tsx`** (no dedicated test — pure navigation markup, exercised by manual verification and indirectly by any page test that renders inside `AdminLayout`)

```tsx
// web/src/components/AdminSidebar.tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';

const links = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
];

export function AdminSidebar() {
  return (
    <aside className="w-48 shrink-0">
      <p className="text-muted-foreground mb-2 text-xs uppercase">Admin</p>
      <nav className="flex flex-col gap-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn('rounded px-2 py-1 text-sm hover:bg-muted', isActive && 'bg-muted font-medium')
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        className="text-muted-foreground hover:text-foreground mt-4 text-sm"
      >
        Logout
      </button>
    </aside>
  );
}
```

- [ ] **Step 14: Create `web/src/components/AdminLayout.tsx`**

```tsx
// web/src/components/AdminLayout.tsx
import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

export function AdminLayout() {
  return (
    <div className="flex gap-6">
      <AdminSidebar />
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 15: Wrap the app in `AuthProvider` — modify `web/src/main.tsx`**

```tsx
// web/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/hooks/useAuth';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 16: Wire the admin route subtree — modify `web/src/App.tsx`**

Login/forgot-password/reset-password pages don't exist until Task 12 — reference them now so the router is complete, then Task 12 creates the files.

```tsx
// web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { AdminRouteGuard } from '@/components/AdminRouteGuard';
import { AdminLayout } from '@/components/AdminLayout';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { NotFoundPage } from '@/pages/NotFound';
import { LoginPage } from '@/pages/admin/Login';
import { ForgotPasswordPage } from '@/pages/admin/ForgotPassword';
import { ResetPasswordPage } from '@/pages/admin/ResetPassword';

export function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <main className="container py-8">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/grades" element={<GradeDistributionPage />} />
          <Route path="/matches" element={<MatchHistoryPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/admin/reset-password" element={<ResetPasswordPage />} />
          <Route element={<AdminRouteGuard />}>
            <Route element={<AdminLayout />}>
              {/* Tasks 14-17 add the four admin action routes here */}
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
```

- [ ] **Step 17: Create minimal stub admin auth pages so the app compiles** (Task 12 replaces these with the real implementation)

```tsx
// web/src/pages/admin/Login.tsx
export function LoginPage() {
  return <p>Admin login — coming soon</p>;
}
```

```tsx
// web/src/pages/admin/ForgotPassword.tsx
export function ForgotPasswordPage() {
  return <p>Forgot password — coming soon</p>;
}
```

```tsx
// web/src/pages/admin/ResetPassword.tsx
export function ResetPasswordPage() {
  return <p>Reset password — coming soon</p>;
}
```

- [ ] **Step 18: Update the App smoke test's imports — modify `web/src/App.test.tsx`**

The existing test only asserts on the root route's content, which is unaffected by this task, but `App.tsx` now imports three new page modules — rerun it to confirm nothing broke:

Run: `cd web && npx vitest run src/App.test.tsx`
Expected: PASS (1 test, unchanged assertions)

- [ ] **Step 19: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 20: Manual verification**

Run: `cd web && npm run dev`. Visit `/admin/enter-match` while signed out.
Expected: redirected to `/admin/login` (stub page for now). Visit `/admin/login` directly — renders the stub without redirecting (public route).

- [ ] **Step 21: Commit**

```bash
git add web/
git commit -m "feat: add auth context, admin route guard, admin layout/sidebar, router wiring"
```

---

### Task 12: Real Login, Forgot Password, and Reset Password pages

**Files:**
- Modify: `web/src/pages/admin/Login.tsx`
- Create: `web/src/pages/admin/Login.test.tsx`
- Modify: `web/src/pages/admin/ForgotPassword.tsx`
- Create: `web/src/pages/admin/ForgotPassword.test.tsx`
- Modify: `web/src/pages/admin/ResetPassword.tsx`
- Create: `web/src/pages/admin/ResetPassword.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 2), shadcn `Input`/`Label`/`Button` (Task 2).

- [ ] **Step 1: Write the failing test — `web/src/pages/admin/Login.test.tsx`**

```tsx
// web/src/pages/admin/Login.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (args: unknown) => mockSignIn(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { LoginPage } from './Login';

describe('LoginPage', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockNavigate.mockReset();
  });

  it('signs in and navigates to the admin home on success', async () => {
    mockSignIn.mockResolvedValue({ data: { user: {}, session: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'hunter2' }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/admin/enter-match');
  });

  it('shows the error message verbatim on a failed login', async () => {
    mockSignIn.mockResolvedValue({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(screen.getByText('Invalid login credentials')).toBeInTheDocument());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('links to the forgot-password page', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/admin/forgot-password',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/Login.test.tsx`
Expected: FAIL — the current stub has no form/labels/button.

- [ ] **Step 3: Replace the stub — modify `web/src/pages/admin/Login.tsx`**

```tsx
// web/src/pages/admin/Login.tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    navigate('/admin/enter-match');
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-xl font-bold">Admin Login</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
        <Link to="/admin/forgot-password" className="text-muted-foreground text-sm hover:underline">
          Forgot password?
        </Link>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/Login.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test — `web/src/pages/admin/ForgotPassword.test.tsx`**

```tsx
// web/src/pages/admin/ForgotPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockReset = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { resetPasswordForEmail: (email: string, opts: unknown) => mockReset(email, opts) } },
}));

import { ForgotPasswordPage } from './ForgotPassword';

describe('ForgotPasswordPage', () => {
  beforeEach(() => mockReset.mockReset());

  it('sends a reset email with a redirect to /admin/reset-password', async () => {
    mockReset.mockResolvedValue({ data: {}, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith('admin@example.com', {
        redirectTo: `${window.location.origin}/admin/reset-password`,
      }),
    );
    expect(screen.getByText(/check your email/i)).toBeInTheDocument();
  });

  it('shows the error message verbatim on failure', async () => {
    mockReset.mockResolvedValue({ data: null, error: { message: 'Unable to validate email address' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(screen.getByText('Unable to validate email address')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/ForgotPassword.test.tsx`
Expected: FAIL — the current stub has no form.

- [ ] **Step 7: Replace the stub — modify `web/src/pages/admin/ForgotPassword.tsx`**

```tsx
// web/src/pages/admin/ForgotPassword.tsx
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password`,
    });
    setIsSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="mb-4 text-xl font-bold">Forgot Password</h1>
        <p className="text-sm">Check your email for a password reset link.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-xl font-bold">Forgot Password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/ForgotPassword.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test — `web/src/pages/admin/ResetPassword.test.tsx`**

```tsx
// web/src/pages/admin/ResetPassword.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockUpdateUser = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { updateUser: (args: unknown) => mockUpdateUser(args) } },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ResetPasswordPage } from './ResetPassword';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mockUpdateUser.mockReset();
    mockNavigate.mockReset();
  });

  it('rejects mismatched password confirmation without calling the API', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'different123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('updates the password and navigates to login on success', async () => {
    mockUpdateUser.mockResolvedValue({ data: { user: {} }, error: null });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'newpass123' }));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/login');
  });

  it('shows the error message verbatim on failure', async () => {
    mockUpdateUser.mockResolvedValue({ data: null, error: { message: 'Auth session missing' } });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(screen.getByText('Auth session missing')).toBeInTheDocument());
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/ResetPassword.test.tsx`
Expected: FAIL — the current stub has no form.

- [ ] **Step 11: Replace the stub — modify `web/src/pages/admin/ResetPassword.tsx`**

```tsx
// web/src/pages/admin/ResetPassword.tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setIsSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate('/admin/login');
  }

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-xl font-bold">Reset Password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Set new password'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/ResetPassword.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 13: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 14: Manual verification**

Using the seed script's admin account (or an admin you provision via `npx supabase status` → Studio URL → Authentication), log in at `/admin/login`.
Expected: successful login redirects to `/admin/enter-match` (still a 404/blank until Task 14, that's expected for now) and the sidebar/logout button from Task 11 appear. Test a wrong password shows the inline error. Test the forgot-password flow and confirm the email appears in Mailpit (`INBUCKET_URL`/`MAILPIT_URL` from `supabase status`).

- [ ] **Step 15: Commit**

```bash
git add web/
git commit -m "feat: add real Login, ForgotPassword, and ResetPassword pages"
```

---

### Task 13: `edgeFunctions.ts` fetch wrappers, `OddsWidget` component

**Files:**
- Create: `web/src/lib/edgeFunctions.ts`
- Create: `web/src/lib/edgeFunctions.test.ts`
- Modify: `web/vite.config.ts`
- Create: `web/src/components/OddsWidget.tsx`
- Create: `web/src/components/OddsWidget.test.tsx`

**Interfaces:**
- Consumes: `supabase` client (Task 2), `winProbability` from the repo root's `src/rating/odds.ts` (Phase 1 — imported directly by relative path per design spec §4, not duplicated).
- Produces: `enterMatch`, `correctMatch`, `closeWeek`, `startSeason` functions and their `*Body`/`*Response` types — consumed by Tasks 14–17's admin pages. `<OddsWidget playerARating playerBRating playerAName playerBName />` — consumed by Task 14's `EnterMatch` page.

- [ ] **Step 1: Allow Vite's dev server to serve files from the repo root — modify `web/vite.config.ts`**

```typescript
// web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '.')],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
```

- [ ] **Step 2: Write the failing test — `web/src/lib/edgeFunctions.test.ts`**

```typescript
// web/src/lib/edgeFunctions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSession = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: () => mockGetSession() } },
}));

import { enterMatch, correctMatch } from './edgeFunctions';

describe('edgeFunctions', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
  });

  it('sends a POST with the bearer token and JSON body for enterMatch', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ match_id: 'm1' }),
    });

    const result = await enterMatch({
      season_id: 's1',
      match_date: '2026-01-22',
      player_a_id: 'p1',
      player_b_id: 'p2',
      frames_a: 5,
      frames_b: 2,
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:54321/functions/v1/enter-match',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
    expect(result).toEqual({ match_id: 'm1' });
  });

  it('throws the response body error verbatim on failure', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok123' } } });
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Cannot correct a match whose week has already closed' }),
    });

    await expect(
      correctMatch({ match_id: 'm1', frames_a: 5, frames_b: 3 }),
    ).rejects.toThrow('Cannot correct a match whose week has already closed');
  });

  it('throws when there is no active session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(
      enterMatch({ season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2 }),
    ).rejects.toThrow('Not signed in.');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run src/lib/edgeFunctions.test.ts`
Expected: FAIL — `Cannot find module './edgeFunctions'`

- [ ] **Step 4: Create `web/src/lib/edgeFunctions.ts`**

```typescript
// web/src/lib/edgeFunctions.ts
import { supabase } from './supabaseClient';

export interface EdgeFunctionError extends Error {
  status: number;
}

async function callEdgeFunction<TBody extends object, TResponse>(
  functionName: string,
  method: 'POST' | 'PATCH',
  body: TBody,
): Promise<TResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error('Not signed in.');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error ?? 'Request failed') as EdgeFunctionError;
    error.status = response.status;
    throw error;
  }
  return json as TResponse;
}

export interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
}
export interface EnterMatchResponse {
  match_id: string;
}
export function enterMatch(body: EnterMatchBody) {
  return callEdgeFunction<EnterMatchBody, EnterMatchResponse>('enter-match', 'POST', body);
}

export interface CorrectMatchBody {
  match_id: string;
  match_date?: string;
  frames_a?: number;
  frames_b?: number;
}
export interface CorrectMatchResponse {
  corrected_match_id: string;
}
export function correctMatch(body: CorrectMatchBody) {
  return callEdgeFunction<CorrectMatchBody, CorrectMatchResponse>('correct-match', 'PATCH', body);
}

export interface CloseWeekBody {
  season_id: string;
  week_ending: string;
}
export interface CloseWeekResponse {
  closed_matches: number;
  players_reconciled: number;
}
export function closeWeek(body: CloseWeekBody) {
  return callEdgeFunction<CloseWeekBody, CloseWeekResponse>('close-week', 'POST', body);
}

export interface StartSeasonBody {
  previous_season_id?: string;
  new_season_name: string;
  start_date: string;
}
export interface StartSeasonResponse {
  season_id: string;
}
export function startSeason(body: StartSeasonBody) {
  return callEdgeFunction<StartSeasonBody, StartSeasonResponse>('start-season', 'POST', body);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd web && npx vitest run src/lib/edgeFunctions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test — `web/src/components/OddsWidget.test.tsx`**

```tsx
// web/src/components/OddsWidget.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OddsWidget } from './OddsWidget';

describe('OddsWidget', () => {
  it('shows a 50/50 split for equal ratings', () => {
    render(<OddsWidget playerARating={1500} playerBRating={1500} playerAName="Alex" playerBName="Jordan" />);
    const percentages = screen.getAllByText('50%');
    expect(percentages).toHaveLength(2);
  });

  it('shows the rating-favored player with a higher percentage', () => {
    // 200-point gap: winProbability(1600, 1400) = 1 / (1 + 10^(-200/400)) ≈ 0.7597
    render(<OddsWidget playerARating={1600} playerBRating={1400} playerAName="Alex" playerBName="Jordan" />);
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
  });

  it('never renders decimal odds, only percentages', () => {
    render(<OddsWidget playerARating={1600} playerBRating={1400} playerAName="Alex" playerBName="Jordan" />);
    expect(screen.queryByText(/[0-9]\.[0-9]+x/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/OddsWidget.test.tsx`
Expected: FAIL — `Cannot find module './OddsWidget'`

- [ ] **Step 8: Create `web/src/components/OddsWidget.tsx`**

Imports `winProbability` directly from the repo root's Phase 1 rating engine by relative path — per design spec §4, this is intentionally a direct import, not a duplicated/synced copy (unlike the Deno Edge Functions in `supabase/functions/_shared/rating/`, Vite/Node have no module-format barrier here).

```tsx
// web/src/components/OddsWidget.tsx
import { winProbability } from '../../../src/rating/odds';

interface OddsWidgetProps {
  playerARating: number;
  playerBRating: number;
  playerAName: string;
  playerBName: string;
}

export function OddsWidget({ playerARating, playerBRating, playerAName, playerBName }: OddsWidgetProps) {
  const probabilityA = winProbability(playerARating, playerBRating);
  const probabilityB = 1 - probabilityA;

  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="text-muted-foreground mb-1 text-xs uppercase">Predicted odds</p>
      <div className="flex justify-between">
        <span>{playerAName || 'Player A'}</span>
        <span className="font-semibold">{Math.round(probabilityA * 100)}%</span>
      </div>
      <div className="flex justify-between">
        <span>{playerBName || 'Player B'}</span>
        <span className="font-semibold">{Math.round(probabilityB * 100)}%</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/OddsWidget.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat: add edge function fetch wrappers and OddsWidget component"
```

---

### Task 14: `usePlayers` hook, real `EnterMatch` admin page

**Files:**
- Create: `web/src/hooks/usePlayers.ts`
- Create: `web/src/hooks/usePlayers.test.ts`
- Create: `web/src/pages/admin/EnterMatch.tsx` (route wired now, replacing the empty placeholder comment left in Task 11 Step 16)
- Create: `web/src/pages/admin/EnterMatch.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useActiveSeason` (Task 6), `enterMatch` (Task 13), `OddsWidget` (Task 13), `queryKeys` (Task 2).
- Produces: `usePlayers(seasonId): UseQueryResult<PlayerOption[]>` (`{ id, full_name, rating }` — `rating` defaults to 1500 for a player with no row yet in this season).

**Note on scope vs. the approved mockup:** the mockup called for a searchable/autocomplete player picker. This task uses a plain native `<select>` instead — functionally complete for any league size (scrolls, doesn't filter-by-typing) and far simpler to build and test reliably than a Radix-based combobox (which needs jsdom polyfills for pointer-capture/portal behavior that add real complexity for a single form). A searchable combobox is a reasonable future enhancement once the roster is large enough that scrolling is genuinely painful, not a blocker for v1.

- [ ] **Step 1: Write the failing test — `web/src/hooks/usePlayers.test.ts`**

```typescript
// web/src/hooks/usePlayers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockPlayersOrder = vi.fn();
const mockRatingsEq = vi.fn();

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'players') {
        return { select: () => ({ eq: () => ({ order: mockPlayersOrder }) }) };
      }
      if (table === 'player_season_ratings') {
        return { select: () => ({ eq: mockRatingsEq }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { usePlayers } from './usePlayers';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePlayers', () => {
  beforeEach(() => {
    mockPlayersOrder.mockReset();
    mockRatingsEq.mockReset();
  });

  it('merges players with their current-season rating, defaulting missing ones to 1500', async () => {
    mockPlayersOrder.mockResolvedValue({
      data: [
        { id: 'p1', full_name: 'Alex Testplayer' },
        { id: 'p2', full_name: 'Brand New Player' },
      ],
      error: null,
    });
    mockRatingsEq.mockResolvedValue({ data: [{ player_id: 'p1', rating: 1768 }], error: null });

    const { result } = renderHook(() => usePlayers('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'p1', full_name: 'Alex Testplayer', rating: 1768 },
      { id: 'p2', full_name: 'Brand New Player', rating: 1500 },
    ]);
  });

  it('does not run when seasonId is undefined', () => {
    const { result } = renderHook(() => usePlayers(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/usePlayers.test.ts`
Expected: FAIL — `Cannot find module './usePlayers'`

- [ ] **Step 3: Create `web/src/hooks/usePlayers.ts`**

```typescript
// web/src/hooks/usePlayers.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

export interface PlayerOption {
  id: string;
  full_name: string;
  rating: number;
}

export function usePlayers(seasonId: string | undefined) {
  return useQuery({
    queryKey: ['players', seasonId ?? ''],
    queryFn: async (): Promise<PlayerOption[]> => {
      const [playersRes, ratingsRes] = await Promise.all([
        supabase.from('players').select('id, full_name').eq('is_active', true).order('full_name', { ascending: true }),
        supabase.from('player_season_ratings').select('player_id, rating').eq('season_id', seasonId as string),
      ]);
      if (playersRes.error) throw playersRes.error;
      if (ratingsRes.error) throw ratingsRes.error;

      const ratingByPlayerId = new Map(
        (ratingsRes.data as { player_id: string; rating: number }[]).map((r) => [r.player_id, r.rating]),
      );
      return (playersRes.data as { id: string; full_name: string }[]).map((player) => ({
        id: player.id,
        full_name: player.full_name,
        rating: ratingByPlayerId.get(player.id) ?? 1500,
      }));
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/usePlayers.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/pages/admin/EnterMatch.test.tsx`**

```tsx
// web/src/pages/admin/EnterMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({ data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' } }),
}));

vi.mock('@/hooks/usePlayers', () => ({
  usePlayers: () => ({
    data: [
      { id: 'p1', full_name: 'Alex Testplayer', rating: 1600 },
      { id: 'p2', full_name: 'Jordan Testplayer', rating: 1400 },
    ],
  }),
}));

const mockEnterMatch = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ enterMatch: (body: unknown) => mockEnterMatch(body) }));

import { EnterMatchPage } from './EnterMatch';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <EnterMatchPage />
    </QueryClientProvider>,
  );
}

describe('EnterMatchPage', () => {
  beforeEach(() => {
    mockEnterMatch.mockReset();
    mockToastSuccess.mockReset();
  });

  it('shows the predicted-odds widget once both players are selected', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    expect(screen.getByText('Predicted odds')).toBeInTheDocument();
  });

  it('rejects a tied frame score client-side without calling enterMatch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '4');
    await user.type(screen.getByLabelText('Frames B'), '4');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    expect(screen.getByText('Frame scores cannot be tied.')).toBeInTheDocument();
    expect(mockEnterMatch).not.toHaveBeenCalled();
  });

  it('submits a valid match, shows a success toast, and resets the form', async () => {
    mockEnterMatch.mockResolvedValue({ match_id: 'm1' });
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(mockEnterMatch).toHaveBeenCalledWith(
        expect.objectContaining({ season_id: 's1', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2 }),
      ),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('Alex Testplayer wins 5–2'));
    await waitFor(() => expect((screen.getByLabelText('Frames A') as HTMLInputElement).value).toBe(''));
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockEnterMatch.mockRejectedValue(new Error('new row for relation "matches" violates check constraint'));
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('Player A'), 'Alex Testplayer');
    await user.selectOptions(screen.getByLabelText('Player B'), 'Jordan Testplayer');
    await user.type(screen.getByLabelText('Frames A'), '5');
    await user.type(screen.getByLabelText('Frames B'), '2');
    await user.click(screen.getByRole('button', { name: 'Submit Match' }));

    await waitFor(() =>
      expect(screen.getByText('new row for relation "matches" violates check constraint')).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/EnterMatch.test.tsx`
Expected: FAIL — `Cannot find module './EnterMatch'`

- [ ] **Step 7: Create `web/src/pages/admin/EnterMatch.tsx`**

```tsx
// web/src/pages/admin/EnterMatch.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OddsWidget } from '@/components/OddsWidget';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { enterMatch } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function EnterMatchPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);

  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [framesA, setFramesA] = useState('');
  const [framesB, setFramesB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const playerA = players.data?.find((p) => p.id === playerAId);
  const playerB = players.data?.find((p) => p.id === playerBId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!playerAId || !playerBId) {
      setError('Select both players.');
      return;
    }
    if (playerAId === playerBId) {
      setError('Player A and Player B must be different.');
      return;
    }

    const parsedFramesA = Number(framesA);
    const parsedFramesB = Number(framesB);
    if (Number.isNaN(parsedFramesA) || Number.isNaN(parsedFramesB)) {
      setError('Frames must be numbers.');
      return;
    }
    if (parsedFramesA === parsedFramesB) {
      setError('Frame scores cannot be tied.');
      return;
    }
    if (!activeSeason.data) {
      setError('No active season.');
      return;
    }

    setIsSubmitting(true);
    try {
      await enterMatch({
        season_id: activeSeason.data.id,
        match_date: matchDate,
        player_a_id: playerAId,
        player_b_id: playerBId,
        frames_a: parsedFramesA,
        frames_b: parsedFramesB,
      });

      const winnerName = parsedFramesA > parsedFramesB ? playerA?.full_name : playerB?.full_name;
      const winnerFrames = Math.max(parsedFramesA, parsedFramesB);
      const loserFrames = Math.min(parsedFramesA, parsedFramesB);
      toast.success(`${winnerName} wins ${winnerFrames}–${loserFrames}`);

      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerAId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(playerBId, activeSeason.data.id) });
      queryClient.invalidateQueries({ queryKey: ['players', activeSeason.data.id] });

      setPlayerAId('');
      setPlayerBId('');
      setFramesA('');
      setFramesB('');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to record match.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Enter Match Result</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="matchDate">Match date</Label>
          <Input
            id="matchDate"
            type="date"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            required
          />
        </div>

        <div>
          <Label htmlFor="playerA">Player A</Label>
          <select
            id="playerA"
            value={playerAId}
            onChange={(e) => setPlayerAId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player A</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="playerB">Player B</Label>
          <select
            id="playerB"
            value={playerBId}
            onChange={(e) => setPlayerBId(e.target.value)}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            required
          >
            <option value="">Select player B</option>
            {players.data?.map((player) => (
              <option key={player.id} value={player.id}>
                {player.full_name}
              </option>
            ))}
          </select>
        </div>

        {playerA && playerB && (
          <OddsWidget
            playerARating={playerA.rating}
            playerBRating={playerB.rating}
            playerAName={playerA.full_name}
            playerBName={playerB.full_name}
          />
        )}

        <div className="flex items-end gap-3">
          <div>
            <Label htmlFor="framesA">Frames A</Label>
            <Input
              id="framesA"
              type="number"
              min={0}
              value={framesA}
              onChange={(e) => setFramesA(e.target.value)}
              required
            />
          </div>
          <span className="pb-2">–</span>
          <div>
            <Label htmlFor="framesB">Frames B</Label>
            <Input
              id="framesB"
              type="number"
              min={0}
              value={framesB}
              onChange={(e) => setFramesB(e.target.value)}
              required
            />
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Submitting…' : 'Submit Match'}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/EnterMatch.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 9: Wire the route — modify `web/src/App.tsx`**

Replace the `{/* Tasks 14-17 add the four admin action routes here */}` comment inside the nested `<Route element={<AdminLayout />}>` block with:

```tsx
              <Route path="/admin/enter-match" element={<EnterMatchPage />} />
```

Add the import alongside the other page imports:

```tsx
import { EnterMatchPage } from '@/pages/admin/EnterMatch';
```

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 11: Manual verification**

Signed in as an admin, visit `/admin/enter-match`. Select two players, watch the odds widget appear and update, submit a match.
Expected: success toast with the correct winner/score, the leaderboard and the two players' profiles reflect the new rating immediately after navigating to them (cache invalidation working), form resets.

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat: add usePlayers hook and real EnterMatch admin page"
```

---

### Task 15: `useOpenMatches` hook, real `CorrectMatch` admin page

**Files:**
- Create: `web/src/hooks/useOpenMatches.ts`
- Create: `web/src/hooks/useOpenMatches.test.ts`
- Create: `web/src/pages/admin/CorrectMatch.tsx`
- Create: `web/src/pages/admin/CorrectMatch.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `MatchRow` type (Task 2), `useActiveSeason` (Task 6), `correctMatch` (Task 13), `queryKeys` (Task 2).
- Produces: `useOpenMatches(seasonId): UseQueryResult<MatchRow[]>` (matches with `is_period_closed = false` and `is_voided = false` for the season).

- [ ] **Step 1: Write the failing test — `web/src/hooks/useOpenMatches.test.ts`**

```typescript
// web/src/hooks/useOpenMatches.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: mockOrder,
          }),
        }),
      }),
    }),
  },
}));

import { useOpenMatches } from './useOpenMatches';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useOpenMatches', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns open, non-voided matches for the season', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 'm1', match_date: '2026-01-22', player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } }],
      error: null,
    });
    const { result } = renderHook(() => useOpenMatches('s1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it('does not run when seasonId is undefined', () => {
    const { result } = renderHook(() => useOpenMatches(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useOpenMatches.test.ts`
Expected: FAIL — `Cannot find module './useOpenMatches'`

- [ ] **Step 3: Create `web/src/hooks/useOpenMatches.ts`**

```typescript
// web/src/hooks/useOpenMatches.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { MatchRow } from '@/lib/types';

export function useOpenMatches(seasonId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.openMatches(seasonId ?? ''),
    queryFn: async (): Promise<MatchRow[]> => {
      const { data, error } = await supabase
        .from('matches')
        .select('*, player_a:player_a_id(id, full_name), player_b:player_b_id(id, full_name)')
        .eq('season_id', seasonId as string)
        .eq('is_period_closed', false)
        .eq('is_voided', false)
        .order('match_date', { ascending: false });
      if (error) throw error;
      return data as unknown as MatchRow[];
    },
    enabled: seasonId !== undefined,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useOpenMatches.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/pages/admin/CorrectMatch.test.tsx`**

```tsx
// web/src/pages/admin/CorrectMatch.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

const openMatch = {
  id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2',
  frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer' }, player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
};

vi.mock('@/hooks/useOpenMatches', () => ({
  useOpenMatches: () => ({ data: [openMatch], isLoading: false, isError: false }),
}));

const mockCorrectMatch = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ correctMatch: (body: unknown) => mockCorrectMatch(body) }));

import { CorrectMatchPage } from './CorrectMatch';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CorrectMatchPage />
    </QueryClientProvider>,
  );
}

describe('CorrectMatchPage', () => {
  beforeEach(() => {
    mockCorrectMatch.mockReset();
    mockToastSuccess.mockReset();
  });

  it('lists open matches and pre-fills the edit form with the selected match\'s current score', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText(/Alex Testplayer 5–2 Jordan Testplayer/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    expect((screen.getByLabelText('Frames A') as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText('Frames B') as HTMLInputElement).value).toBe('2');
  });

  it('rejects a tied frame score client-side without calling correctMatch', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.clear(screen.getByLabelText('Frames B'));
    await user.type(screen.getByLabelText('Frames B'), '5');
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    expect(screen.getByText('Frame scores cannot be tied.')).toBeInTheDocument();
    expect(mockCorrectMatch).not.toHaveBeenCalled();
  });

  it('submits a valid correction, shows a success toast, and returns to the list', async () => {
    mockCorrectMatch.mockResolvedValue({ corrected_match_id: 'm2' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.clear(screen.getByLabelText('Frames B'));
    await user.type(screen.getByLabelText('Frames B'), '3');
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() =>
      expect(mockCorrectMatch).toHaveBeenCalledWith({ match_id: 'm1', frames_a: 5, frames_b: 3 }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Match corrected.');
    await waitFor(() => expect(screen.queryByLabelText('Frames A')).not.toBeInTheDocument());
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockCorrectMatch.mockRejectedValue(new Error('Cannot correct a match whose week has already closed'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Correct' }));
    await user.click(screen.getByRole('button', { name: 'Save Correction' }));

    await waitFor(() =>
      expect(screen.getByText('Cannot correct a match whose week has already closed')).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/CorrectMatch.test.tsx`
Expected: FAIL — `Cannot find module './CorrectMatch'`

- [ ] **Step 7: Create `web/src/pages/admin/CorrectMatch.tsx`**

```tsx
// web/src/pages/admin/CorrectMatch.tsx
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useOpenMatches } from '@/hooks/useOpenMatches';
import { correctMatch } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';
import type { MatchRow } from '@/lib/types';

export function CorrectMatchPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const openMatches = useOpenMatches(activeSeason.data?.id);

  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [framesA, setFramesA] = useState('');
  const [framesB, setFramesB] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function selectMatch(match: MatchRow) {
    setSelectedMatch(match);
    setFramesA(String(match.frames_a));
    setFramesB(String(match.frames_b));
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedMatch) return;
    setError(null);

    const parsedFramesA = Number(framesA);
    const parsedFramesB = Number(framesB);
    if (Number.isNaN(parsedFramesA) || Number.isNaN(parsedFramesB)) {
      setError('Frames must be numbers.');
      return;
    }
    if (parsedFramesA === parsedFramesB) {
      setError('Frame scores cannot be tied.');
      return;
    }

    setIsSubmitting(true);
    try {
      await correctMatch({ match_id: selectedMatch.id, frames_a: parsedFramesA, frames_b: parsedFramesB });
      toast.success('Match corrected.');

      if (activeSeason.data) {
        const seasonId = activeSeason.data.id;
        queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(selectedMatch.player_a_id, seasonId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.playerProfile(selectedMatch.player_b_id, seasonId) });
      }

      setSelectedMatch(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to correct match.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (activeSeason.isLoading || openMatches.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || openMatches.isError) {
    return <p className="text-destructive">Couldn't load open matches. Try refreshing.</p>;
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Correct a Match</h1>
      {!selectedMatch ? (
        <div className="flex flex-col gap-2">
          {(openMatches.data ?? []).length === 0 && (
            <p className="text-muted-foreground text-sm">No open matches this week.</p>
          )}
          {openMatches.data?.map((match) => (
            <div key={match.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>
                {match.match_date}: {match.player_a.full_name} {match.frames_a}–{match.frames_b}{' '}
                {match.player_b.full_name}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => selectMatch(match)}>
                Correct
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-4">
          <p className="text-sm">
            {selectedMatch.player_a.full_name} vs {selectedMatch.player_b.full_name} — {selectedMatch.match_date}
          </p>
          <div className="flex items-end gap-3">
            <div>
              <Label htmlFor="correctFramesA">Frames A</Label>
              <Input
                id="correctFramesA"
                type="number"
                min={0}
                value={framesA}
                onChange={(e) => setFramesA(e.target.value)}
                required
              />
            </div>
            <span className="pb-2">–</span>
            <div>
              <Label htmlFor="correctFramesB">Frames B</Label>
              <Input
                id="correctFramesB"
                type="number"
                min={0}
                value={framesB}
                onChange={(e) => setFramesB(e.target.value)}
                required
              />
            </div>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Correction'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSelectedMatch(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/CorrectMatch.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 9: Wire the route — modify `web/src/App.tsx`**

Add a second route line inside the same nested `<Route element={<AdminLayout />}>` block from Task 14:

```tsx
              <Route path="/admin/correct-match" element={<CorrectMatchPage />} />
```

Add the import:

```tsx
import { CorrectMatchPage } from '@/pages/admin/CorrectMatch';
```

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 11: Manual verification**

Enter a match via `/admin/enter-match`, then visit `/admin/correct-match`. Confirm it appears in the open-matches list, click Correct, change the score, save.
Expected: success toast, the match disappears from the "needs correction" flow back to the list view with its new score, and the player's profile/leaderboard reflect the corrected rating.

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat: add useOpenMatches hook and real CorrectMatch admin page"
```

---

### Task 16: `ConfirmDialog` component, real `CloseWeek` admin page

**Files:**
- Create: `web/src/components/ConfirmDialog.tsx`
- Create: `web/src/components/ConfirmDialog.test.tsx`
- Create: `web/src/pages/admin/CloseWeek.tsx`
- Create: `web/src/pages/admin/CloseWeek.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: shadcn `AlertDialog`/`Button` (Task 2), `useOpenMatches` (Task 15), `closeWeek` (Task 13).
- Produces: `<ConfirmDialog trigger title description confirmLabel onConfirm isConfirming />` — also consumed by Task 17's `StartSeason` page.

- [ ] **Step 1: Write the failing test — `web/src/components/ConfirmDialog.test.tsx`**

```tsx
// web/src/components/ConfirmDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('shows the title/description only after the trigger is clicked, then calls onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button type="button">Open</button>}
        title="Close the week ending 2026-01-22?"
        description="This locks 14 match(es) and runs Glicko-2 reconciliation for 8 player(s). This cannot be undone."
        confirmLabel="Confirm Close Week"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByText('Close the week ending 2026-01-22?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Close the week ending 2026-01-22?')).toBeInTheDocument();
    expect(
      screen.getByText('This locks 14 match(es) and runs Glicko-2 reconciliation for 8 player(s). This cannot be undone.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not call onConfirm when Cancel is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button type="button">Open</button>}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: FAIL — `Cannot find module './ConfirmDialog'`

- [ ] **Step 3: Create `web/src/components/ConfirmDialog.tsx`**

```tsx
// web/src/components/ConfirmDialog.tsx
import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ConfirmDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  isConfirming?: boolean;
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  isConfirming,
}: ConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test — `web/src/pages/admin/CloseWeek.test.tsx`**

```tsx
// web/src/pages/admin/CloseWeek.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useOpenMatches', () => ({
  useOpenMatches: () => ({
    data: [
      { id: 'm1', season_id: 's1', match_date: '2026-01-22', player_a_id: 'p1', player_b_id: 'p2', frames_a: 5, frames_b: 2, winner_id: 'p1', is_voided: false, is_period_closed: false, player_a: { id: 'p1', full_name: 'Alex' }, player_b: { id: 'p2', full_name: 'Jordan' } },
    ],
    isLoading: false,
    isError: false,
  }),
}));

const mockCloseWeek = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ closeWeek: (body: unknown) => mockCloseWeek(body) }));

import { CloseWeekPage } from './CloseWeek';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CloseWeekPage />
    </QueryClientProvider>,
  );
}

describe('CloseWeekPage', () => {
  beforeEach(() => {
    mockCloseWeek.mockReset();
    mockToastSuccess.mockReset();
  });

  it('shows the blast radius (match/player count) before confirming', () => {
    renderPage();
    expect(screen.getByText('1')).toBeInTheDocument(); // match count
    expect(screen.getByText('2')).toBeInTheDocument(); // player count
  });

  it('calls closeWeek only after the confirm dialog is accepted', async () => {
    mockCloseWeek.mockResolvedValue({ closed_matches: 1, players_reconciled: 2 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Close Week' }));
    expect(mockCloseWeek).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));

    await waitFor(() =>
      expect(mockCloseWeek).toHaveBeenCalledWith({ season_id: 's1', week_ending: expect.any(String) }),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith('Closed 1 matches for 2 players.');
  });

  it('shows the edge function error message verbatim on failure', async () => {
    mockCloseWeek.mockRejectedValue(new Error('Failed to load open matches: connection refused'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Close Week' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));

    await waitFor(() =>
      expect(screen.getByText('Failed to load open matches: connection refused')).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/CloseWeek.test.tsx`
Expected: FAIL — `Cannot find module './CloseWeek'`

- [ ] **Step 7: Create `web/src/pages/admin/CloseWeek.tsx`**

```tsx
// web/src/pages/admin/CloseWeek.tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { useOpenMatches } from '@/hooks/useOpenMatches';
import { closeWeek, type CloseWeekResponse } from '@/lib/edgeFunctions';
import { queryKeys } from '@/lib/queryKeys';

export function CloseWeekPage() {
  const queryClient = useQueryClient();
  const activeSeason = useActiveSeason();
  const openMatches = useOpenMatches(activeSeason.data?.id);

  const [weekEnding, setWeekEnding] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [result, setResult] = useState<CloseWeekResponse | null>(null);

  const matchesInWeek = (openMatches.data ?? []).filter((match) => match.match_date <= weekEnding);
  const playerCount = new Set(matchesInWeek.flatMap((match) => [match.player_a_id, match.player_b_id])).size;

  async function handleConfirm() {
    if (!activeSeason.data) return;
    setError(null);
    setIsClosing(true);
    try {
      const response = await closeWeek({ season_id: activeSeason.data.id, week_ending: weekEnding });
      setResult(response);
      toast.success(`Closed ${response.closed_matches} matches for ${response.players_reconciled} players.`);

      const seasonId = activeSeason.data.id;
      queryClient.invalidateQueries({ queryKey: queryKeys.openMatches(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.gradeDistribution(seasonId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.matchHistory(seasonId) });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to close the week.');
    } finally {
      setIsClosing(false);
    }
  }

  if (activeSeason.isLoading || openMatches.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (activeSeason.isError || openMatches.isError) {
    return <p className="text-destructive">Couldn't load open matches. Try refreshing.</p>;
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-4 text-xl font-bold">Close Week</h1>
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="weekEnding">Week ending</Label>
          <Input id="weekEnding" type="date" value={weekEnding} onChange={(e) => setWeekEnding(e.target.value)} />
        </div>
        <p className="text-sm">
          This will close <strong>{matchesInWeek.length}</strong> match(es) for <strong>{playerCount}</strong>{' '}
          player(s).
        </p>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <ConfirmDialog
          trigger={
            <Button type="button" disabled={matchesInWeek.length === 0 || isClosing}>
              Close Week
            </Button>
          }
          title={`Close the week ending ${weekEnding}?`}
          description={`This locks ${matchesInWeek.length} match(es) and runs Glicko-2 reconciliation for ${playerCount} player(s). This cannot be undone.`}
          confirmLabel="Confirm Close Week"
          onConfirm={handleConfirm}
          isConfirming={isClosing}
        />
        {result && (
          <p className="text-sm">
            Closed {result.closed_matches} matches, reconciled {result.players_reconciled} players.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/CloseWeek.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 9: Wire the route — modify `web/src/App.tsx`**

Add a third route line inside the same nested `<Route element={<AdminLayout />}>` block:

```tsx
              <Route path="/admin/close-week" element={<CloseWeekPage />} />
```

Add the import:

```tsx
import { CloseWeekPage } from '@/pages/admin/CloseWeek';
```

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (all tests so far)

- [ ] **Step 11: Manual verification**

With at least one open match present (enter one via `/admin/enter-match` if needed), visit `/admin/close-week`, confirm the blast-radius text matches reality, close the week.
Expected: success toast with the real counts, the leaderboard/grade distribution reflect the Glicko-2 reconciled ratings, and the closed match no longer appears in `/admin/correct-match`'s open list.

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat: add ConfirmDialog component and real CloseWeek admin page"
```

---

### Task 17: `useSeasons` hook, real `StartSeason` admin page

**Files:**
- Create: `web/src/hooks/useSeasons.ts`
- Create: `web/src/hooks/useSeasons.test.ts`
- Create: `web/src/pages/admin/StartSeason.tsx`
- Create: `web/src/pages/admin/StartSeason.test.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `Season` type (Task 2), `ConfirmDialog` (Task 16), `startSeason` (Task 13), `queryKeys` (Task 2).
- Produces: `useSeasons(): UseQueryResult<Season[]>` — every season, newest first (used to populate the "carry over ratings from" picker).

- [ ] **Step 1: Write the failing test — `web/src/hooks/useSeasons.test.ts`**

```typescript
// web/src/hooks/useSeasons.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const mockOrder = vi.fn();
vi.mock('@/lib/supabaseClient', () => ({
  supabase: { from: () => ({ select: () => ({ order: mockOrder }) }) },
}));

import { useSeasons } from './useSeasons';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useSeasons', () => {
  beforeEach(() => mockOrder.mockReset());

  it('returns every season, newest first', async () => {
    mockOrder.mockResolvedValue({
      data: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
      error: null,
    });
    const { result } = renderHook(() => useSeasons(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(mockOrder).toHaveBeenCalledWith('start_date', { ascending: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run src/hooks/useSeasons.test.ts`
Expected: FAIL — `Cannot find module './useSeasons'`

- [ ] **Step 3: Create `web/src/hooks/useSeasons.ts`**

```typescript
// web/src/hooks/useSeasons.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { queryKeys } from '@/lib/queryKeys';
import type { Season } from '@/lib/types';

export function useSeasons() {
  return useQuery({
    queryKey: queryKeys.seasons(),
    queryFn: async (): Promise<Season[]> => {
      const { data, error } = await supabase.from('seasons').select('*').order('start_date', { ascending: false });
      if (error) throw error;
      return data as Season[];
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest run src/hooks/useSeasons.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing test — `web/src/pages/admin/StartSeason.test.tsx`**

```tsx
// web/src/pages/admin/StartSeason.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockToastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (msg: string) => mockToastSuccess(msg) } }));

vi.mock('@/hooks/useSeasons', () => ({
  useSeasons: () => ({
    data: [{ id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' }],
    isLoading: false,
    isError: false,
  }),
}));

const mockStartSeason = vi.fn();
vi.mock('@/lib/edgeFunctions', () => ({ startSeason: (body: unknown) => mockStartSeason(body) }));

import { StartSeasonPage } from './StartSeason';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <StartSeasonPage />
    </QueryClientProvider>,
  );
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

    await waitFor(() => expect(screen.getByText('duplicate key value violates unique constraint')).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd web && npx vitest run src/pages/admin/StartSeason.test.tsx`
Expected: FAIL — `Cannot find module './StartSeason'`

- [ ] **Step 7: Create `web/src/pages/admin/StartSeason.tsx`**

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

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd web && npx vitest run src/pages/admin/StartSeason.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 9: Wire the route — modify `web/src/App.tsx`**

Add the fourth and final route line inside the same nested `<Route element={<AdminLayout />}>` block:

```tsx
              <Route path="/admin/start-season" element={<StartSeasonPage />} />
```

Add the import:

```tsx
import { StartSeasonPage } from '@/pages/admin/StartSeason';
```

At this point every route referenced anywhere in `App.tsx` has a real implementation — no stub pages remain except `NotFoundPage` (intentionally permanent).

- [ ] **Step 10: Run the full test suite**

Run: `cd web && npx vitest run`
Expected: PASS (every test written across all 17 tasks)

- [ ] **Step 11: Manual verification**

Visit `/admin/start-season`. Create a new season without carryover, confirm it becomes selectable elsewhere. Create a second one WITH carryover from the first, confirm.
Expected: success toasts, the new season's players show soft-reset ratings when carryover was used, and `/` (Leaderboard) now reflects whichever season is `active` after each run (only one should be `active` at a time — confirms Phase 2's whole-branch-review fix that marks the previous season `completed`).

- [ ] **Step 12: Commit**

```bash
git add web/
git commit -m "feat: add useSeasons hook and real StartSeason admin page"
```

---

### Task 18: Full end-to-end manual verification pass

**Files:** none (no code changes) — this task is a structured click-through of the entire app against real seeded data, the equivalent of Phase 1/2's "Final verification" checklist. Per this plan's testing philosophy (design spec §7), no automated E2E suite exists, so this pass is how the whole app gets verified together, not just its parts in isolation.

- [ ] **Step 1: Fresh backend state**

From the repo root:

```bash
npx supabase db reset
npm run seed
```

Expected: seed script prints `Seeded season <uuid> with 30 players across 3 closed weeks.`

- [ ] **Step 2: Provision (or confirm) an admin account**

If the seed script's admin user isn't known to you, create one via Supabase Studio (`STUDIO_URL` from `npx supabase status`) → Authentication → Add user, then insert a matching row into `admin_users` via the SQL editor:

```sql
insert into admin_users (id, display_name, role) values ('<the auth user''s UUID>', 'Test Admin', 'admin');
```

- [ ] **Step 3: Start the frontend**

```bash
cd web && npm run dev
```

Expected: Vite prints a local URL.

- [ ] **Step 4: Public pages (signed out)**

Visit `/`. Expected: real leaderboard data, 30 players (minus any below the 3-match ranking threshold), varied ratings/grades, ranked correctly.

Click a player name. Expected: `/players/:id` loads their real profile — stat cards, a populated rating chart, recent matches with correct opponents/scores/deltas.

Visit `/grades`. Expected: all 7 grade bands render, proportional bars, correct counts summing to the ranked player total.

Visit `/matches`. Expected: every seeded match appears, newest first.

Visit `/admin/enter-match` while signed out. Expected: redirected to `/admin/login`.

- [ ] **Step 5: Admin auth**

At `/admin/login`, try a wrong password. Expected: inline error, no navigation.

Log in with the real admin credentials. Expected: redirected to `/admin/enter-match`, sidebar with all four admin links plus Logout appears.

Click Logout, then try visiting `/admin/enter-match` again. Expected: redirected back to `/admin/login` (session cleared).

Log back in. At `/admin/forgot-password`, submit the admin's email. Expected: "check your email" message; the email appears in Mailpit (`MAILPIT_URL`); clicking its link lands on `/admin/reset-password`; setting a new password there redirects to `/admin/login`; the new password works.

- [ ] **Step 6: Full weekly workflow, end to end**

At `/admin/enter-match`: select two real players, watch the predicted-odds widget update as you change the selection, submit a 5–3 result.
Expected: success toast naming the correct winner/score. Immediately visit both players' profiles and the leaderboard — ratings/stats reflect the new match without a manual page refresh being required to see fresh data (TanStack Query cache invalidation).

At `/admin/correct-match`: find the match just entered, correct its score to 5–4.
Expected: success toast; the corrected score shows up on both players' profiles and in `/matches`.

At `/admin/close-week`: confirm the displayed match/player count matches what you'd expect from this session's entries, close the week.
Expected: success toast with real counts; `/grades` and `/` reflect the Glicko-2-reconciled ratings; the closed match no longer appears in `/admin/correct-match`'s list; attempting to correct it via a direct API call would now 400 (not necessary to test manually — Phase 2's own test suite already covers this at the API layer).

At `/admin/start-season`: create a new season carrying over from the currently active one.
Expected: success toast; `/` now shows the new season's soft-reset ratings as the active leaderboard; the old season's matches/history remain reachable (not deleted) but are no longer the "active" one shown by default.

- [ ] **Step 7: Run the full automated suite one last time**

```bash
cd web && npx vitest run
```

Expected: every test across all 17 preceding tasks passes.

Also confirm the backend suite is untouched by this phase:

```bash
cd .. && npm run test:unit && npm run test:integration && npm run test:api
```

Expected: unaffected, same pass count as at the end of Phase 2.

- [ ] **Step 8: Commit** (only if Step 6 surfaced any fixes — otherwise this task has no code changes to commit)

If any bugs were found and fixed during this pass, commit them now with a message describing what was found, e.g.:

```bash
git add web/
git commit -m "fix: <description of what the end-to-end pass caught>"
```

---

## Final verification

- [ ] Ensure `npx supabase start` is running (repo root).
- [ ] Run `npm run test:unit && npm run test:integration && npm run test:api` (repo root) — expected: unchanged from Phase 2's final count, this phase touches nothing under `src/` or `supabase/`.
- [ ] Ensure `npx supabase functions serve` is running if any admin-page manual check needs it.
- [ ] Run `cd web && npx vitest run` — expected: all frontend tests pass (component/hook/page tests from Tasks 1–17).
- [ ] Run `cd web && npx tsc -b` — expected: no type errors.
- [ ] Complete Task 18's full manual click-through against `npm run seed`'s data.
- [ ] Run `npx supabase stop` (repo root) to stop the local stack when done.

