import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/AccountMenu';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
  { to: '/explore', label: 'Explore' },
];

export function TopNav() {
  const { session } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40">
      {/* Signature FPL gradient strip */}
      <div className="fpl-gradient h-1" />
      <nav className="border-b border-border bg-card/90 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <NavLink to={session ? '/dashboard' : '/login'} className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="hidden text-lg font-extrabold tracking-tight sm:inline">PoolIQ</span>
          </NavLink>
          <div className="flex items-center gap-1 text-sm sm:gap-1.5">
            {session && (
              <div className="hidden items-center gap-1.5 md:flex">
                {links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      cn(
                        'rounded-full px-4 py-1.5 font-medium transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.35)]'
                          : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                      )
                    }
                  >
                    {link.label}
                  </NavLink>
                ))}
              </div>
            )}
            <ThemeToggle />
            <AccountMenu />
            {session && (
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={mobileOpen}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground md:hidden"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
        {session && mobileOpen && (
          <div className="border-t border-border md:hidden">
            <div className="container flex flex-col gap-1 py-3 text-sm">
              {links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'rounded-lg px-4 py-2.5 font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
                    )
                  }
                >
                  {link.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
