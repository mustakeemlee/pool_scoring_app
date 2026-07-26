// web/src/components/AccountMenu.tsx
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

export function AccountMenu() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const isAdmin = useIsAdmin(session?.user.id);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function handleLogOut() {
    setOpen(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate('/');
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!session) {
    return (
      <div className="flex items-center gap-1.5">
        <NavLink
          to="/login"
          className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          Log in
        </NavLink>
        <NavLink
          to="/signup"
          className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
        >
          Sign up
        </NavLink>
      </div>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
      >
        Account
      </button>
      {open && (
        <div className="card-surface absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-1 p-2">
          <NavLink
            to="/dashboard"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-foreground/10"
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => setOpen(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-foreground/10"
          >
            Settings
          </NavLink>
          {isAdmin.data === true && (
            <NavLink
              to="/admin/enter-match"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-foreground/10"
            >
              Admin
            </NavLink>
          )}
          <button
            type="button"
            onClick={() => void handleLogOut()}
            className="rounded-lg px-3 py-2 text-left text-sm font-medium text-destructive hover:bg-foreground/10"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
