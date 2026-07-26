import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabaseClient';
import {
  ACTIVITY_STORAGE_KEY,
  IDLE_TIMEOUT_MS,
  WARNING_LEAD_MS,
  markActivityNow,
  msSinceLastActivity,
  setIdleSignoutReason,
} from '@/lib/idleSession';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const ACTIVITY_WRITE_THROTTLE_MS = 2_000;
const CHECK_INTERVAL_MS = 1_000;

interface IdleLogoutState {
  showWarning: boolean;
  secondsRemaining: number;
  stayActive: () => void;
}

export function useIdleLogout(): IdleLogoutState {
  const { session } = useAuth();
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  useEffect(() => {
    if (!session) {
      setElapsedMs(null);
      return;
    }

    let lastWriteAt = 0;

    function recordActivity() {
      const now = Date.now();
      if (now - lastWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWriteAt = now;
      markActivityNow();
      setElapsedMs(0);
    }

    function checkIdle() {
      const elapsed = msSinceLastActivity();
      if (elapsed === null) return;
      if (elapsed >= IDLE_TIMEOUT_MS) {
        setIdleSignoutReason();
        void supabase.auth.signOut();
        return;
      }
      setElapsedMs(elapsed);
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === ACTIVITY_STORAGE_KEY) {
        checkIdle();
      }
    }

    checkIdle();
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, recordActivity));
    const interval = setInterval(checkIdle, CHECK_INTERVAL_MS);
    window.addEventListener('focus', checkIdle);
    document.addEventListener('visibilitychange', checkIdle);
    window.addEventListener('storage', handleStorage);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, recordActivity));
      clearInterval(interval);
      window.removeEventListener('focus', checkIdle);
      document.removeEventListener('visibilitychange', checkIdle);
      window.removeEventListener('storage', handleStorage);
    };
  }, [session]);

  const showWarning = elapsedMs !== null && elapsedMs >= IDLE_TIMEOUT_MS - WARNING_LEAD_MS;
  const secondsRemaining =
    elapsedMs !== null ? Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - elapsedMs) / 1000)) : 0;

  function stayActive() {
    markActivityNow();
    setElapsedMs(0);
  }

  return { showWarning, secondsRemaining, stayActive };
}
