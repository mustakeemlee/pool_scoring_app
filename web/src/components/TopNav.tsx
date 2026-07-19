import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-40">
      {/* Signature FPL gradient strip */}
      <div className="fpl-gradient h-1" />
      <nav className="border-b border-white/10 bg-fpl-dark/90 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <NavLink to="/" className="flex items-center gap-2.5">
            <span aria-hidden className="fpl-gradient flex h-9 w-9 items-center justify-center rounded-xl text-lg shadow-lg">
              🎱
            </span>
            <span aria-hidden className="text-lg font-extrabold tracking-tight">
              Pool League
            </span>
            <span className="sr-only">🎱 Pool League</span>
          </NavLink>
          <div className="flex items-center gap-1.5 text-sm">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-1.5 font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-[0_0_16px_hsl(152_100%_50%/0.35)]'
                      : 'text-muted-foreground hover:bg-white/10 hover:text-foreground',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
            <NavLink
              to="/admin/login"
              className="ml-2 rounded-full border border-white/15 px-4 py-1.5 font-medium text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              Admin login
            </NavLink>
          </div>
        </div>
      </nav>
    </header>
  );
}
