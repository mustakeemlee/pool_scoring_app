// web/src/components/AdminSidebar.tsx
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const links = [
  { to: '/admin/enter-match', label: 'Enter Match' },
  { to: '/admin/create-fixture', label: 'Schedule Fixture' },
  { to: '/admin/correct-match', label: 'Correct a Match' },
  { to: '/admin/close-week', label: 'Close Week' },
  { to: '/admin/start-season', label: 'Start Season' },
  { to: '/admin/players', label: 'Players' },
];

export function AdminSidebar() {
  return (
    <aside className="card-surface h-fit w-52 shrink-0 p-4">
      <p className="text-accent mb-3 text-xs font-bold uppercase tracking-widest">Admin</p>
      <nav className="flex flex-col gap-1">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-foreground/10',
                isActive && 'bg-primary text-primary-foreground hover:bg-primary',
              )
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
