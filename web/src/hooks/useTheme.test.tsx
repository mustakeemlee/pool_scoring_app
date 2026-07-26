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
