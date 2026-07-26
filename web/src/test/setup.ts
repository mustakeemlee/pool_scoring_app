import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;

// Node's built-in global `localStorage`/`sessionStorage` (an experimental
// Node feature) collides with jsdom's under this Vitest/Node combination,
// causing a bare `localStorage.clear()` in a test to throw
// `TypeError: localStorage.clear is not a function`. This in-memory
// polyfill replaces both globals so tests get a working Storage
// implementation regardless of that collision.
class StorageMock {
  private store: Record<string, string> = {};

  clear(): void {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] ?? null;
  }

  get length(): number {
    return Object.keys(this.store).length;
  }
}

// Replace window storage with our polyfill
Object.defineProperty(window, 'localStorage', {
  value: new StorageMock(),
  writable: true,
});

Object.defineProperty(window, 'sessionStorage', {
  value: new StorageMock(),
  writable: true,
});

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
