import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  IDLE_TIMEOUT_MS,
  WARNING_LEAD_MS,
  ACTIVITY_STORAGE_KEY,
  markActivityNow,
  getLastActivity,
  msSinceLastActivity,
  isActivityStale,
  setIdleSignoutReason,
  consumeIdleSignoutReason,
} from './idleSession';

describe('idleSession', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes a 5 minute idle timeout and a 30 second warning lead', () => {
    expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(WARNING_LEAD_MS).toBe(30 * 1000);
  });

  it('returns null when nothing has been recorded yet', () => {
    expect(getLastActivity()).toBeNull();
    expect(msSinceLastActivity()).toBeNull();
  });

  it('markActivityNow records the current time under ACTIVITY_STORAGE_KEY', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(localStorage.getItem(ACTIVITY_STORAGE_KEY)).toBe('1000000');
    expect(getLastActivity()).toBe(1_000_000);
  });

  it('msSinceLastActivity computes elapsed time from a supplied "now"', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(msSinceLastActivity(1_000_000 + 4_000)).toBe(4_000);
  });

  it('isActivityStale is false when nothing has been recorded (brand-new login)', () => {
    expect(isActivityStale()).toBe(false);
  });

  it('isActivityStale flips from false to true exactly at the timeout', () => {
    vi.setSystemTime(1_000_000);
    markActivityNow();
    expect(isActivityStale(1_000_000 + IDLE_TIMEOUT_MS - 1)).toBe(false);
    expect(isActivityStale(1_000_000 + IDLE_TIMEOUT_MS)).toBe(true);
  });

  it('consumeIdleSignoutReason returns false repeatedly when nothing was set', () => {
    expect(consumeIdleSignoutReason()).toBe(false);
    expect(consumeIdleSignoutReason()).toBe(false);
  });

  it('consumeIdleSignoutReason returns true exactly once after setIdleSignoutReason', () => {
    setIdleSignoutReason();
    expect(consumeIdleSignoutReason()).toBe(true);
    expect(consumeIdleSignoutReason()).toBe(false);
  });
});
