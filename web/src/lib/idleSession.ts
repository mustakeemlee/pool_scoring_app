export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const WARNING_LEAD_MS = 30 * 1000;

export const ACTIVITY_STORAGE_KEY = 'pool-app:last-activity';
const SIGNOUT_REASON_KEY = 'pool-app:signout-reason';

export function markActivityNow(): void {
  localStorage.setItem(ACTIVITY_STORAGE_KEY, String(Date.now()));
}

export function getLastActivity(): number | null {
  const value = localStorage.getItem(ACTIVITY_STORAGE_KEY);
  return value === null ? null : Number(value);
}

export function msSinceLastActivity(now: number = Date.now()): number | null {
  const last = getLastActivity();
  return last === null ? null : now - last;
}

export function isActivityStale(now: number = Date.now()): boolean {
  const elapsed = msSinceLastActivity(now);
  return elapsed !== null && elapsed >= IDLE_TIMEOUT_MS;
}

export function setIdleSignoutReason(): void {
  sessionStorage.setItem(SIGNOUT_REASON_KEY, 'idle');
}

export function consumeIdleSignoutReason(): boolean {
  const value = sessionStorage.getItem(SIGNOUT_REASON_KEY);
  if (value !== null) {
    sessionStorage.removeItem(SIGNOUT_REASON_KEY);
  }
  return value === 'idle';
}
