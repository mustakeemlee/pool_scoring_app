// web/src/hooks/useAuth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { getLastActivity, isActivityStale, markActivityNow, setIdleSignoutReason } from '@/lib/idleSession';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    function acceptSession(newSession: Session | null, isSignIn: boolean) {
      // A fresh sign-in is itself activity, so it must mark a new baseline
      // before the staleness check below runs — otherwise a leftover
      // pre-idle-logout timestamp immediately signs the new session back
      // out, looping the login page forever.
      if (newSession && isSignIn) {
        markActivityNow();
        setSession(newSession);
        return;
      }
      if (newSession && isActivityStale()) {
        setIdleSignoutReason();
        void supabase.auth.signOut();
        setSession(null);
        return;
      }
      if (newSession && getLastActivity() === null) {
        markActivityNow();
      }
      setSession(newSession);
    }

    supabase.auth.getSession().then(({ data }) => {
      acceptSession(data.session, false);
      setIsLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      acceptSession(newSession, event === 'SIGNED_IN');
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
