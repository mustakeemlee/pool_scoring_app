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
