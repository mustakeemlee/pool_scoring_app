# Light/Dark Mode — Design

Status: Approved by user, 2026-07-26

## 1. Purpose

Today the web frontend has exactly one visual theme: a deep-purple "FPL-inspired
dark" look, defined unconditionally in `web/src/index.css`'s `:root` block.
Tailwind's `darkMode: ['class']` is already configured in `tailwind.config.ts`
but nothing uses it — there is no `.dark` class anywhere and no light theme
exists at all. This spec adds a real light theme, a toggle to switch between
them, and a mechanism to default sensibly for a first-time visitor.

## 2. Scope decisions locked in during brainstorming

- **Default behavior**: on first visit (no stored preference), the app follows
  the OS/browser's `prefers-color-scheme`, live — if the user changes their OS
  setting mid-session and has never overridden in-app, the app updates without
  a reload. As soon as the user clicks the toggle, that becomes an explicit,
  permanent-until-changed override stored in `localStorage['pool-app:theme']`
  (`'light' | 'dark'`), which then always wins over the system setting.
- **Toggle placement**: a single icon button in `TopNav`, always visible,
  right next to the account menu. One click flips to the opposite of whatever
  theme is currently showing (a simple two-state toggle, not a three-way
  light/dark/system selector — appropriate for a single always-visible icon
  button rather than a settings-page control).
- **Light theme visual direction**: "Soft Lavender Tint" — a very light
  purple-tinted page background with white cards popping on top, keeping the
  exact same accent hues (green/cyan/magenta/red) as dark mode, recalibrated
  for contrast on a light background. Chosen over a fully neutral white
  background specifically to keep a hint of the app's purple brand identity
  carried over from dark mode. Reviewed as a live mockup against the current
  dark theme and a neutral-white alternative before this was picked.
- **The top nav bar switches with the theme.** `TopNav.tsx` currently hardcodes
  a fixed dark-purple bar (`bg-fpl-dark/90`) regardless of any theme setting.
  That hardcoding is removed — the nav bar becomes fully theme-aware like the
  rest of the app, so light mode is a complete, consistent light experience
  with no persistently-dark chrome.
- **The gradient logo wordmark and the 1px `.fpl-gradient` header strip stay
  visually identical in both themes** — these are the one deliberately
  theme-invariant brand element, not part of the audit below.
- **No flash of the wrong theme on load.** This is a client-rendered Vite SPA
  with no server-side rendering, so React only applies the theme after the
  bundle loads and runs. A small inline script in `web/index.html`, executed
  before the React bundle, synchronously reads `localStorage`/system
  preference and sets `.dark` on `<html>` immediately — avoiding a visible
  flicker between a default theme and the visitor's actual theme on first
  paint.
- **Existing hardcoded-color audit.** A repo scan found 17 files using raw
  `text-white`/`bg-white`/`bg-black`/`border-white` classes (plus `TopNav.tsx`'s
  `bg-fpl-dark`) instead of semantic tokens (`bg-background`, `text-foreground`,
  `border-border`, etc.) — code that implicitly assumed the app is always
  dark. Each gets audited individually: anything that assumes a dark page
  background gets converted to a semantic token so it renders correctly in
  both themes; anything intentionally theme-invariant (e.g. white text sitting
  on its own colored badge background, or the gradient banner/logo above) is
  left alone. This is a per-file judgment call made during implementation, not
  a blanket find-and-replace.
- **Out of scope**: a three-way light/dark/system selector UI; per-account
  server-persisted theme preference (this is `localStorage`-only, per-browser,
  consistent with how this app already handles the idle-session activity
  timestamp); redesigning the gradient banner/logo treatment itself; any
  change to component *layout*, only color tokens.

## 3. Architecture

```
┌─────────────────────────────┐
│   web/index.html              │  inline script (runs before the React
│   (small addition)             │  bundle): reads localStorage['pool-app:theme']
│                               │  or matchMedia('(prefers-color-scheme: dark)'),
│                               │  sets/removes .dark on <html> synchronously
└─────────────────────────────┘

┌─────────────────────────────┐
│   web/src/hooks/useTheme.tsx  │  ThemeProvider (context) + useTheme()
│   (new)                       │  - resolves effective theme (override >
│                               │    live system preference)
│                               │  - listens to the matchMedia change event
│                               │    while unoverridden
│                               │  - keeps <html>'s .dark class in sync
│                               │  - exposes { theme, toggleTheme }
└──────────────┬──────────────┘
               │ used by
┌──────────────▼──────────────┐
│  web/src/components/          │  icon button (sun/moon via lucide-react,
│  ThemeToggle.tsx (new)        │  already a dependency), mounted in TopNav
└─────────────────────────────┘

┌─────────────────────────────┐
│  web/src/index.css            │  tokens reorganized: existing values move
│  (modified)                    │  under `.dark { ... }` unchanged; a new
│                               │  `:root { ... }` block holds the light
│                               │  (Soft Lavender Tint) values
└─────────────────────────────┘
```

**Light theme token values** (HSL triples, matching the existing
`index.css` format), alongside the unchanged dark values for reference:

| Token | Dark (unchanged, moves to `.dark`) | Light (new, `:root`) |
|---|---|---|
| `--background` | `291 100% 11%` | `280 45% 97%` |
| `--foreground` | `0 0% 100%` | `291 60% 14%` |
| `--card` | `290 62% 16%` | `0 0% 100%` |
| `--card-foreground` | `0 0% 100%` | `291 60% 14%` |
| `--primary` | `152 100% 50%` | `152 85% 32%` |
| `--primary-foreground` | `291 100% 11%` | `0 0% 100%` |
| `--secondary` | `289 50% 22%` | `280 30% 93%` |
| `--secondary-foreground` | `0 0% 100%` | `291 60% 14%` |
| `--muted` | `289 45% 20%` | `280 25% 93%` |
| `--muted-foreground` | `287 22% 74%` | `291 20% 40%` |
| `--accent` | `183 98% 51%` | `183 85% 34%` |
| `--accent-foreground` | `291 100% 11%` | `0 0% 100%` |
| `--destructive` | `349 100% 64%` | `349 75% 45%` |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 100%` |
| `--border` | `290 45% 26%` | `280 25% 85%` |
| `--input` | `290 45% 26%` | `280 25% 85%` |
| `--ring` | `152 100% 50%` | `152 85% 32%` |
| `--radius` | `0.75rem` | `0.75rem` (unchanged, not theme-dependent) |

Primary/accent/destructive are deepened in light mode (lower lightness, same
hue) versus their vivid dark-mode values, since the original values are tuned
for high contrast against a near-black background and would be low-contrast
text/icon colors against a light one; they stay visually "the same color
family" while being legible on white/lavender.

**New/changed files:**
- `web/src/hooks/useTheme.tsx` — `ThemeProvider` + `useTheme()`, mirroring
  `useAuth.tsx`'s existing context-provider shape and conventions.
- `web/src/components/ThemeToggle.tsx` — the icon button; mounted in
  `web/src/components/TopNav.tsx` next to `AccountMenu`.
- `web/index.html` — the anti-flash inline script.
- `web/src/index.css` — token reorganization described above.
- `web/src/App.tsx` or `web/src/main.tsx` — mount `<ThemeProvider>` (final
  placement decided in the implementation plan, alongside the existing
  `AuthProvider`/`QueryClientProvider` nesting).
- Targeted edits to the 17 files (16 plus `TopNav.tsx`) identified in the
  hardcoded-color audit — exact list and per-file disposition (convert vs.
  leave alone) enumerated in the implementation plan, not here, since it
  requires reading each file's actual context to judge correctly.

## 4. Data flow

1. **Page load** → `index.html`'s inline script runs before any React code →
   reads `localStorage['pool-app:theme']`; if absent, reads
   `matchMedia('(prefers-color-scheme: dark)').matches` → sets/removes `.dark`
   on `document.documentElement` synchronously, before first paint.
2. **`ThemeProvider` mounts** → re-derives the same effective theme (for
   React state, so `useTheme()` consumers like `ThemeToggle` can read/react to
   it) → registers a `matchMedia` `change` listener that updates the applied
   theme live, but *only* while there is no stored override.
3. **User clicks `ThemeToggle`** → `toggleTheme()` flips to the opposite of
   the current effective theme → writes it to
   `localStorage['pool-app:theme']` → updates `.dark` on `<html>` → this is
   now a permanent override; the `matchMedia` listener stops affecting the
   applied theme (it may still fire, but the override always wins).

## 5. Error handling

- `localStorage`/`matchMedia` access assumes a normal browser environment —
  consistent with how this app already treats `localStorage` elsewhere (no
  special-case handling for environments without them).
- No network calls are involved; there is nothing to retry or surface as an
  error.

## 6. Testing

Vitest + `@testing-library/react`, plus a `matchMedia` mock added to
`web/src/test/setup.ts` (jsdom does not implement it):
- No stored preference, system reports dark → effective theme is dark.
- No stored preference, system reports light → effective theme is light.
- A stored override always wins over the system preference, in both
  directions.
- Clicking `ThemeToggle` flips the theme and persists the new override.
- While unoverridden, a simulated system-preference `change` event updates the
  effective theme live; once overridden, the same event has no effect.
- A representative sample of the audited components render with the correct
  semantic-token classes (spot-checks, not all 17 files need dedicated new
  tests if the change is a mechanical class-name swap with no new logic).
