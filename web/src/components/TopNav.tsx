import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
];

export function TopNav() {
  return (
    <nav className="border-b">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-semibold">🎱 Pool League</span>
        <div className="flex items-center gap-4 text-sm">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                cn('text-muted-foreground hover:text-foreground', isActive && 'text-foreground font-medium')
              }
            >
              {link.label}
            </NavLink>
          ))}
          <NavLink to="/admin/login" className="text-muted-foreground hover:text-foreground">
            Admin login
          </NavLink>
        </div>
      </div>
    </nav>
  );
}
