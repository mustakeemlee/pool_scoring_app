# Light/Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real light theme alongside the existing dark theme, a one-click toggle in the top nav, system-preference-aware defaulting, and convert every place in the frontend that hardcodes a dark-mode-only color so the whole app renders correctly in both themes.

**Architecture:** Tailwind's `darkMode: ['class']` (already configured, currently unused) drives everything — a `.dark` class on `<html>` switches which CSS-variable block (`:root` vs `.dark`) is active. A React `ThemeProvider` (mirroring `useAuth.tsx`'s context-provider shape) resolves the effective theme (stored override > live system preference) and keeps `.dark` in sync; a small inline script in `index.html` sets the class synchronously before first paint to avoid a flash of the wrong theme.

**Tech Stack:** React 18 + TypeScript, Tailwind CSS (`darkMode: ['class']`), Vitest + `@testing-library/react`, lucide-react icons (already a dependency).

## Global Constraints

- `localStorage` key for the explicit override: `pool-app:theme`, values exactly `'light' | 'dark'`. Absence means "follow system preference."
- System-preference query: `window.matchMedia('(prefers-color-scheme: dark)')`.
- The toggle is a single icon button in `TopNav`, next to `AccountMenu` — clicking always flips to the opposite of the current effective theme (a two-state toggle, not a three-way light/dark/system selector).
- The gradient logo wordmark and the 1px `.fpl-gradient` header strip stay visually identical in both themes — never touch `.fpl-gradient`, `.fpl-gradient-soft`, `.fpl-gradient-text`, or `.fpl-glow-green` in `index.css`.
- `TopNav` becomes fully theme-aware — no persistently-dark nav bar regardless of theme.
- Grade badges (`GradeBadge.tsx`) and rank-medal colors (`Leaderboard.tsx`'s `RANK_STYLES[2]`/`RANK_STYLES[3]`, which sit on their own solid colored backgrounds) and the two `bg-black/80` modal backdrop scrims (`ui/dialog.tsx`, `ui/alert-dialog.tsx`) are intentionally theme-invariant — never touch them.
- Exact light-theme HSL token values (see Task 1) — do not improvise different values.
- Mechanical class-name swaps (converting a hardcoded color to its semantic-token equivalent, with no behavior change) do not need new dedicated tests — verify by re-running the existing test file for that component instead, per the design spec's testing section.

---

### Task 1: Light theme CSS tokens

**Files:**
- Modify: `web/src/index.css:1-28` (the `:root` block and the `@apply border-border` rule are untouched elsewhere in the file)

**Interfaces:**
- Consumes: nothing.
- Produces: a `.dark` selector block (used by every later task's rendered output, since `ThemeProvider` toggles this class) and a new `:root` block with light-theme values. `--radius` stays a single shared value (not theme-dependent).

There is no meaningful automated test for raw CSS custom-property values — Vitest/jsdom exercises component structure and class names, not computed colors. Verification for this task is: the existing full test suite still passes (pure token reorganization changes no class names, no JSX), confirmed in Step 3.

- [ ] **Step 1: Replace the `:root` block**

In `web/src/index.css`, replace lines 1–28 (everything from `@tailwind base;` through the closing `}` of the first `@layer base { :root { ... } }` block) with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Light theme: soft lavender-tinted background, white cards, same
       accent hues as dark mode recalibrated for contrast on a light bg */
    --background: 280 45% 97%;
    --foreground: 291 60% 14%;
    --card: 0 0% 100%;
    --card-foreground: 291 60% 14%;
    --primary: 152 85% 32%;
    --primary-foreground: 0 0% 100%;
    --secondary: 280 30% 93%;
    --secondary-foreground: 291 60% 14%;
    --muted: 280 25% 93%;
    --muted-foreground: 291 20% 40%;
    --accent: 183 85% 34%;
    --accent-foreground: 0 0% 100%;
    --destructive: 349 75% 45%;
    --destructive-foreground: 0 0% 100%;
    --border: 280 25% 85%;
    --input: 280 25% 85%;
    --ring: 152 85% 32%;
    --radius: 0.75rem;
  }

  .dark {
    /* FPL-inspired dark theme: deep purple base, electric green primary,
       cyan accent, magenta-to-cyan gradients */
    --background: 291 100% 11%;
    --foreground: 0 0% 100%;
    --card: 290 62% 16%;
    --card-foreground: 0 0% 100%;
    --primary: 152 100% 50%;
    --primary-foreground: 291 100% 11%;
    --secondary: 289 50% 22%;
    --secondary-foreground: 0 0% 100%;
    --muted: 289 45% 20%;
    --muted-foreground: 287 22% 74%;
    --accent: 183 98% 51%;
    --accent-foreground: 291 100% 11%;
    --destructive: 349 100% 64%;
    --destructive-foreground: 0 0% 100%;
    --border: 290 45% 26%;
    --input: 290 45% 26%;
    --ring: 152 100% 50%;
  }
}
```

- [ ] **Step 2: Fix `.card-surface`'s hardcoded border**

Still in `web/src/index.css`, find the `.card-surface` rule inside the `@layer utilities` block near the bottom of the file:

```css
  .card-surface {
    @apply rounded-xl border border-white/10 bg-card/80 backdrop-blur-sm;
  }
```

Replace it with:

```css
  .card-surface {
    @apply rounded-xl border border-border bg-card/80 backdrop-blur-sm;
  }
```

- [ ] **Step 3: Run the full test suite to confirm nothing broke**

Run (from `web/`): `npx vitest run`
Expected: PASS, same file/test counts as before this change (pure CSS — no class names or JSX changed).

- [ ] **Step 4: Commit**

```bash
git add web/src/index.css
git commit -m "feat: add light theme CSS tokens alongside the existing dark theme"
```

---

### Task 2: `ThemeProvider`/`useTheme` + anti-flash script + test polyfill

**Files:**
- Create: `web/src/hooks/useTheme.tsx`
- Test: `web/src/hooks/useTheme.test.tsx`
- Modify: `web/index.html`
- Modify: `web/src/test/setup.ts`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes (from Task 1): the `.dark` class convention (this task only ever adds/removes that one class — it does not read CSS values).
- Produces (used by Task 3): `ThemeProvider` (React component) and `useTheme(): { theme: 'light' | 'dark'; toggleTheme: () => void }`.

A note before you start: this codebase already hit a real bug once in a different feature from using a *non-pure* function (one with side effects, returning a different value each call) as a `useState` lazy initializer — React 18 `<StrictMode>` (the whole app is wrapped in it, `web/src/main.tsx`) double-invokes such initializers in dev, and the second call's result silently wins. The initializer used below (`getStoredTheme() ?? getSystemTheme()`) is **pure** — both helpers only *read* `localStorage`/`matchMedia`, never mutate anything, and return the same value on repeated calls — so it is not vulnerable to that same bug. This is called out explicitly so the task reviewer doesn't need to re-derive it from scratch.

- [ ] **Step 1: Write the failing test**

```tsx
// web/src/hooks/useTheme.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from './useTheme';

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let changeListener: ((event: { matches: boolean }) => void) | null = null;
  window.matchMedia = vi.fn().mockReturnValue({
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_event: string, cb: (event: { matches: boolean }) => void) => {
      changeListener = cb;
    },
    removeEventListener: () => {
      changeListener = null;
    },
  }) as unknown as typeof window.matchMedia;

  return {
    fireChange: (newMatches: boolean) => {
      matches = newMatches;
      changeListener?.({ matches: newMatches });
    },
  };
}

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <p>theme: {theme}</p>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
  });

  it('defaults to the system theme when nothing is stored (dark)', () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: dark')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to the system theme when nothing is stored (light)', () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: light')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('a stored override wins over the system preference', () => {
    mockMatchMedia(true);
    localStorage.setItem('pool-app:theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: light')).toBeInTheDocument();
  });

  it('toggleTheme flips the theme and persists the override', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: light')).toBeInTheDocument();

    await user.click(screen.getByText('toggle'));

    expect(screen.getByText('theme: dark')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('pool-app:theme')).toBe('dark');
  });

  it('updates live on a system-preference change while unoverridden', () => {
    const { fireChange } = mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: light')).toBeInTheDocument();

    act(() => {
      fireChange(true);
    });

    expect(screen.getByText('theme: dark')).toBeInTheDocument();
  });

  it('ignores a system-preference change once an explicit override exists', () => {
    const { fireChange } = mockMatchMedia(false);
    localStorage.setItem('pool-app:theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('theme: light')).toBeInTheDocument();

    act(() => {
      fireChange(true);
    });

    expect(screen.getByText('theme: light')).toBeInTheDocument();
  });

  it('throws when useTheme is called outside ThemeProvider', () => {
    function Bare() {
      useTheme();
      return null;
    }
    expect(() => render(<Bare />)).toThrow('useTheme must be used within a ThemeProvider');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/hooks/useTheme.test.tsx`
Expected: FAIL — `Cannot find module './useTheme'`.

- [ ] **Step 3: Add a default `matchMedia` stub to the shared test setup**

`window.matchMedia` isn't implemented by jsdom at all. Add a default stub so any test that doesn't care about theme (i.e. every test except `useTheme.test.tsx`, which fully overrides `window.matchMedia` itself per-test above) doesn't crash. In `web/src/test/setup.ts`, add this after the existing `sessionStorage` block at the end of the file:

```ts

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
```

This requires importing `vi` at the top of the file — add it to the existing imports. The file currently starts with:

```ts
import '@testing-library/jest-dom/vitest';
```

Change that line to:

```ts
import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Write the implementation**

```tsx
// web/src/hooks/useTheme.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'pool-app:theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemTheme(): Theme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
    function handleChange(event: MediaQueryListEvent) {
      if (getStoredTheme() !== null) return;
      setTheme(event.matches ? 'dark' : 'light');
    }
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/hooks/useTheme.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 6: Add the anti-flash inline script to `index.html`**

The current `web/index.html` is:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#37003C" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
      rel="stylesheet"
    />
    <title>Pool League</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Add the inline script right after the viewport meta tag, so it runs as early as possible, before first paint:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script>
      (function () {
        var stored = localStorage.getItem('pool-app:theme');
        var isDark =
          stored === 'dark' ||
          (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
    <meta name="theme-color" content="#37003C" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
      rel="stylesheet"
    />
    <title>Pool League</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Mount `ThemeProvider` in `main.tsx`**

The current `web/src/main.tsx` is:

```tsx
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

Replace it with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/hooks/useAuth';
import { ThemeProvider } from '@/hooks/useTheme';
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
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

- [ ] **Step 8: Run the full test suite to confirm nothing broke**

Run (from `web/`): `npx vitest run`
Expected: PASS. `main.tsx` itself isn't unit-tested, so this just confirms the new `matchMedia` stub in `setup.ts` didn't disturb any other test.

- [ ] **Step 9: Commit**

```bash
git add web/src/hooks/useTheme.tsx web/src/hooks/useTheme.test.tsx web/src/test/setup.ts web/index.html web/src/main.tsx
git commit -m "feat: add ThemeProvider with system-preference default and anti-flash boot script"
```

---

### Task 3: `ThemeToggle` + mount in `TopNav` + `TopNav`'s own theme-awareness

**Files:**
- Create: `web/src/components/ThemeToggle.tsx`
- Test: `web/src/components/ThemeToggle.test.tsx`
- Modify: `web/src/components/TopNav.tsx`
- Modify: `web/src/components/TopNav.test.tsx`
- Modify: `web/src/App.test.tsx`

**Interfaces:**
- Consumes (from Task 2): `useTheme(): { theme: 'light' | 'dark'; toggleTheme: () => void }`.
- Produces: `ThemeToggle` component, mounted in `TopNav` next to `AccountMenu`.

`TopNav` currently hardcodes its own background/border/hover colors and an active-link glow tied to the old dark-mode-only green, all independent of any theme system (`bg-fpl-dark/90`, `border-white/10`, `hover:bg-white/10`, `shadow-[0_0_16px_hsl(152_100%_50%/0.35)]`). Since this task already touches `TopNav.tsx` to mount the toggle, it also fixes those in the same pass — a `.dark`-independent icon button next to a hardcoded-dark nav bar would look broken in light mode otherwise.

Once `TopNav` calls `useTheme()`, both `TopNav.test.tsx` (which renders `<TopNav />` directly) and `App.test.tsx` (which renders `<App />`, which renders `<TopNav />` internally) need `useTheme` mocked — exactly the same pattern this codebase already uses for `useAuth`/`useIsAdmin` in both those files. Without this, both files' existing tests would start throwing `useTheme must be used within a ThemeProvider`.

- [ ] **Step 1: Write the failing test for `ThemeToggle`**

```tsx
// web/src/components/ThemeToggle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockUseTheme = vi.fn();
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => mockUseTheme() }));

import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  it('shows a button labeled to switch to light mode when currently dark', () => {
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('shows a button labeled to switch to dark mode when currently light', () => {
    mockUseTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('calls toggleTheme when clicked', async () => {
    const toggleTheme = vi.fn();
    mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme });
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(toggleTheme).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `web/`): `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: FAIL — `Cannot find module './ThemeToggle'`.

- [ ] **Step 3: Write the implementation**

```tsx
// web/src/components/ThemeToggle.tsx
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/ThemeToggle.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `TopNav.tsx`**

The current `web/src/components/TopNav.tsx` is:

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/AccountMenu';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
  { to: '/explore', label: 'Explore' },
];

export function TopNav() {
  const { session } = useAuth();

  return (
    <header className="sticky top-0 z-40">
      {/* Signature FPL gradient strip */}
      <div className="fpl-gradient h-1" />
      <nav className="border-b border-white/10 bg-fpl-dark/90 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <NavLink to={session ? '/' : '/login'} className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="text-lg font-extrabold tracking-tight">Pool League</span>
          </NavLink>
          <div className="flex items-center gap-1.5 text-sm">
            {session &&
              links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full px-4 py-1.5 font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-[0_0_16px_hsl(152_100%_50%/0.35)]'
                        : 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            <AccountMenu />
          </div>
        </div>
      </nav>
    </header>
  );
}
```

Replace it with:

```tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/AccountMenu';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
  { to: '/explore', label: 'Explore' },
];

export function TopNav() {
  const { session } = useAuth();

  return (
    <header className="sticky top-0 z-40">
      {/* Signature FPL gradient strip */}
      <div className="fpl-gradient h-1" />
      <nav className="border-b border-border bg-card/90 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <NavLink to={session ? '/' : '/login'} className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="text-lg font-extrabold tracking-tight">Pool League</span>
          </NavLink>
          <div className="flex items-center gap-1.5 text-sm">
            {session &&
              links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    cn(
                      'rounded-full px-4 py-1.5 font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.35)]'
                        : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </nav>
    </header>
  );
}
```

- [ ] **Step 6: Update `TopNav.test.tsx` to mock `useTheme`**

The current `web/src/components/TopNav.test.tsx` mocks `useAuth`/`useIsAdmin` at the top. Add a `useTheme` mock the same way. Change:

```tsx
const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
```

to:

```tsx
const mockUseAuth = vi.fn();
const mockUseIsAdmin = vi.fn();
const mockUseTheme = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
vi.mock('@/hooks/useIsAdmin', () => ({ useIsAdmin: () => mockUseIsAdmin() }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => mockUseTheme() }));
```

Then, in each of the file's two `it(...)` blocks, add a line setting up the mock's return value alongside the existing `mockUseAuth.mockReturnValue(...)`/`mockUseIsAdmin.mockReturnValue(...)` calls:

```tsx
mockUseTheme.mockReturnValue({ theme: 'dark', toggleTheme: vi.fn() });
```

- [ ] **Step 7: Update `App.test.tsx` to mock `useTheme`**

`App.test.tsx` currently mocks `useAuth`/`useIsAdmin`/`useActiveSeason`/`useLeaderboard` at the top of the file. Add the same `useTheme` mock:

```tsx
vi.mock('@/hooks/useIsAdmin', () => ({
  useIsAdmin: () => ({ data: undefined, isLoading: false, isError: false }),
}));
```

Add immediately after that block:

```tsx
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));
```

- [ ] **Step 8: Run the affected test files to verify they pass**

Run: `npx vitest run src/components/TopNav.test.tsx src/App.test.tsx`
Expected: PASS (2 + 2 = 4 tests, unchanged assertions).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/ThemeToggle.tsx web/src/components/ThemeToggle.test.tsx web/src/components/TopNav.tsx web/src/components/TopNav.test.tsx web/src/App.test.tsx
git commit -m "feat: add theme toggle and make TopNav fully theme-aware"
```

---

### Task 4: Nav-adjacent chrome — `AccountMenu` and `AdminSidebar`

**Files:**
- Modify: `web/src/components/AccountMenu.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: nothing new (pure class-name substitutions).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update `AccountMenu.tsx`**

Five hardcoded spots in this file. Each `hover:bg-white/10` becomes `hover:bg-foreground/10` (preserves the exact same subtle-tint-toward-foreground effect, which is white-on-dark today and becomes dark-on-light in light mode), and each `border-white/15` becomes `border-border`.

Change (line 41):
```tsx
          className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
```
to:
```tsx
          className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
```

Change (lines 47 and 60 — identical string, appears twice):
```tsx
          className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
```
to (both occurrences):
```tsx
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
```

Change (lines 69 and 76 and 84 — identical string, appears three times):
```tsx
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-white/10"
```
to (all three occurrences):
```tsx
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-foreground/10"
```

Change (line 92):
```tsx
            className="rounded-lg px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-white/10"
```
to:
```tsx
            className="rounded-lg px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-foreground/10"
```

- [ ] **Step 2: Update `AdminSidebar.tsx`**

Change:
```tsx
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-white/10',
```
to:
```tsx
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-foreground/10',
```

- [ ] **Step 3: Run the affected test files to verify they still pass**

Run: `npx vitest run src/components/AccountMenu.test.tsx src/components/AdminSidebar.test.tsx`
Expected: PASS, same assertions as before (these tests check text/roles/hrefs, not class names).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AccountMenu.tsx web/src/components/AdminSidebar.tsx
git commit -m "feat: make AccountMenu and AdminSidebar theme-aware"
```

---

### Task 5: Table/list chrome — `Leaderboard`, `PlayerAvatar`, `GradeDistribution`, `MatchHistory`, `MatchTable`

**Files:**
- Modify: `web/src/pages/Leaderboard.tsx`
- Modify: `web/src/components/PlayerAvatar.tsx`
- Modify: `web/src/pages/GradeDistribution.tsx`
- Modify: `web/src/pages/MatchHistory.tsx`
- Modify: `web/src/components/MatchTable.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new consumed by later tasks.

`Leaderboard.tsx`'s `RANK_STYLES[2]`/`RANK_STYLES[3]` (solid accent/magenta medal backgrounds) and `GradeBadge`/grade-badge colors are intentionally left untouched per the Global Constraints — only the borders, hover tints, and the rank-1 glow (which is tied to the theme's `--primary`, unlike ranks 2/3 which use their own fixed colors) change here.

- [ ] **Step 1: Update `Leaderboard.tsx`**

Change the rank-1 glow (still uses the theme's primary color, so it must track the theme like `TopNav`'s active-link glow did in Task 3):
```tsx
  1: 'bg-primary text-primary-foreground shadow-[0_0_14px_hsl(152_100%_50%/0.45)]',
```
to:
```tsx
  1: 'bg-primary text-primary-foreground shadow-[0_0_14px_hsl(var(--primary)/0.45)]',
```

Change the banner border:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-white/10 px-6 py-8">
```
to:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
```

Change the table header border:
```tsx
        <div className="text-muted-foreground grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]">
```
to:
```tsx
        <div className="text-muted-foreground grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]">
```

Change the row border/hover/top-3 tint:
```tsx
                className={cn(
                  'grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-white/5 px-4 py-3 transition-colors last:border-0 hover:bg-white/5 sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]',
                  entry.rank <= 3 && 'bg-white/[0.03]',
                )}
```
to:
```tsx
                className={cn(
                  'grid grid-cols-[3rem_1fr_4rem_5rem_5rem] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-foreground/5 sm:grid-cols-[3.5rem_1fr_5rem_6rem_6rem]',
                  entry.rank <= 3 && 'bg-foreground/[0.03]',
                )}
```

Change the fallback (non-medal) rank badge background:
```tsx
                    RANK_STYLES[entry.rank] ?? 'bg-white/10 text-foreground',
```
to:
```tsx
                    RANK_STYLES[entry.rank] ?? 'bg-foreground/10 text-foreground',
```

- [ ] **Step 2: Update `PlayerAvatar.tsx`**

Change:
```tsx
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-2 ring-white/15',
        SIZE_CLASSES[size],
        !showPhoto && 'bg-white/10',
        className,
      )}
```
to:
```tsx
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-2 ring-border',
        SIZE_CLASSES[size],
        !showPhoto && 'bg-muted',
        className,
      )}
```

- [ ] **Step 3: Update `GradeDistribution.tsx`**

Change the banner border:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-white/10 px-6 py-8">
```
to:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
```

Change the bar-chart track background:
```tsx
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-white/5">
```
to:
```tsx
            <div className="h-5 flex-1 overflow-hidden rounded-full bg-foreground/5">
```

- [ ] **Step 4: Update `MatchHistory.tsx`**

Change the banner border:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-white/10 px-6 py-8">
```
to:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
```

- [ ] **Step 5: Update `MatchTable.tsx`**

Change the table header border:
```tsx
          <tr className="text-muted-foreground border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider">
```
to:
```tsx
          <tr className="text-muted-foreground border-b border-border text-left text-xs font-semibold uppercase tracking-wider">
```

Change the row border/hover:
```tsx
              className={cn(
                'border-b border-white/5 transition-colors last:border-0 hover:bg-white/5',
                match.is_voided && 'opacity-50',
              )}
```
to:
```tsx
              className={cn(
                'border-b border-border transition-colors last:border-0 hover:bg-foreground/5',
                match.is_voided && 'opacity-50',
              )}
```

- [ ] **Step 6: Run the affected test files to verify they still pass**

Run: `npx vitest run src/pages/Leaderboard.test.tsx src/components/PlayerAvatar.test.tsx src/pages/GradeDistribution.test.tsx src/pages/MatchHistory.test.tsx`
Expected: PASS, same assertions as before.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Leaderboard.tsx web/src/components/PlayerAvatar.tsx web/src/pages/GradeDistribution.tsx web/src/pages/MatchHistory.tsx web/src/components/MatchTable.tsx
git commit -m "feat: make leaderboard, match, and grade-distribution chrome theme-aware"
```

---

### Task 6: Remaining pages — `Explore`, `PlayerProfile`, `Dashboard`, `ManagePlayers`

**Files:**
- Modify: `web/src/pages/Explore.tsx`
- Modify: `web/src/pages/PlayerProfile.tsx`
- Modify: `web/src/pages/Dashboard.tsx`
- Modify: `web/src/pages/admin/ManagePlayers.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this is the last content-conversion task.

- [ ] **Step 1: Update `Explore.tsx`**

Change the banner border:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-white/10 px-6 py-8">
```
to:
```tsx
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
```

Change the players-list row border and link hover (two occurrences of the border, one of the hover):
```tsx
                  <li key={player.id} className="border-b border-white/5 last:border-0">
                    <Link
                      to={`/players/${player.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-white/5"
                    >
```
to:
```tsx
                  <li key={player.id} className="border-b border-border last:border-0">
                    <Link
                      to={`/players/${player.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5"
                    >
```

Change the seasons-list row border and link hover:
```tsx
                    <li key={season.id} className="border-b border-white/5 last:border-0">
                      {season.status === 'active' ? (
                        <Link to="/" className="block hover:bg-white/5">
```
to:
```tsx
                    <li key={season.id} className="border-b border-border last:border-0">
                      {season.status === 'active' ? (
                        <Link to="/" className="block hover:bg-foreground/5">
```

- [ ] **Step 2: Update `PlayerProfile.tsx`**

Change the hero banner border:
```tsx
      <div className="fpl-gradient-soft mb-6 flex flex-col items-start gap-5 rounded-2xl border border-white/10 px-6 py-8 sm:flex-row sm:items-center">
```
to:
```tsx
      <div className="fpl-gradient-soft mb-6 flex flex-col items-start gap-5 rounded-2xl border border-border px-6 py-8 sm:flex-row sm:items-center">
```

Change the recent-matches table header border:
```tsx
              <tr className="text-muted-foreground border-b border-white/10 text-left text-xs font-semibold uppercase tracking-wider">
```
to:
```tsx
              <tr className="text-muted-foreground border-b border-border text-left text-xs font-semibold uppercase tracking-wider">
```

Change the recent-matches row border/hover:
```tsx
                  className={cn(
                    'border-b border-white/5 transition-colors last:border-0 hover:bg-white/5',
                    match.is_voided && 'opacity-50',
                  )}
```
to:
```tsx
                  className={cn(
                    'border-b border-border transition-colors last:border-0 hover:bg-foreground/5',
                    match.is_voided && 'opacity-50',
                  )}
```

- [ ] **Step 3: Update `Dashboard.tsx`**

Change the top-5 leaderboard row border:
```tsx
            <li key={entry.player_id} className="flex items-center justify-between border-b border-white/5 px-4 py-3 last:border-0">
```
to:
```tsx
            <li key={entry.player_id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
```

- [ ] **Step 4: Update `web/src/pages/admin/ManagePlayers.tsx`**

Change the player-photo row border:
```tsx
    <li className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
```
to:
```tsx
    <li className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
```

Change the pending-claims row border:
```tsx
          <li key={claim.id} className="flex items-center gap-4 border-b border-white/5 px-4 py-3 last:border-0">
```
to:
```tsx
          <li key={claim.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-0">
```

- [ ] **Step 5: Run the affected test files to verify they still pass**

Run: `npx vitest run src/pages/Explore.test.tsx src/pages/PlayerProfile.test.tsx src/pages/Dashboard.test.tsx src/pages/admin/ManagePlayers.test.tsx`
Expected: PASS, same assertions as before.

- [ ] **Step 6: Run the full test suite and the TypeScript build once, as the final check for this feature**

Run: `npx vitest run` (from `web/`)
Expected: PASS, all files.

Run: `npx tsc -b` (from `web/`)
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/Explore.tsx web/src/pages/PlayerProfile.tsx web/src/pages/Dashboard.tsx web/src/pages/admin/ManagePlayers.tsx
git commit -m "feat: make Explore, PlayerProfile, Dashboard, and ManagePlayers theme-aware"
```

---

## Self-Review Notes

- **Spec coverage:** light theme token values (Task 1), `ThemeProvider`/system-preference default/live update/override persistence (Task 2), anti-flash script (Task 2), toggle in `TopNav` (Task 3), `TopNav` full theme-awareness (Task 3), the 17-file hardcoded-color audit with explicit per-file disposition — convert vs. intentionally-leave-alone (Tasks 3–6, with `GradeBadge.tsx`/`GradeBadge.test.tsx`/`Leaderboard.tsx`'s medal colors/`ui/dialog.tsx`/`ui/alert-dialog.tsx` correctly left untouched per the Global Constraints) — all covered.
- **Placeholder scan:** none found — every step shows the exact before/after code.
- **Type/name consistency checked:** `useTheme()`'s return shape (`theme`, `toggleTheme`) matches exactly between Task 2's implementation/tests and Task 3's `ThemeToggle` usage/tests. The `localStorage` key (`pool-app:theme`) and `matchMedia` query string are identical across Task 2's hook, its test, and the `index.html` inline script in the same task.
- **One extra spot found during planning, beyond the original 17-file grep** (which only searched for `text-white`/`bg-white`/`border-white`/`bg-black`): `GradeBadge.tsx` also uses `text-black` for four grades (`A`, `B+`, `B`, `C+`) — confirmed this is the identical "solid colored badge, contrasting text" pattern as the `text-white` grades already carved out of scope, so it's included in that same "intentionally left alone" disposition rather than treated as a gap.
