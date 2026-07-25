import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { AccountMenu } from '@/components/AccountMenu';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/hooks/useAuth';

const links = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/', label: 'Leaderboard', end: true },
  { to: '/grades', label: 'Grades' },
  { to: '/matches', label: 'Matches' },
  { to: '/explore', label: 'Explore' },
];

export function TopNav() {
  const { session } = useAuth();

  return (
    <header className="sticky top-0 z-40">
      {/* Signature FPL gradient strip */}
      <div className="fpl-gradient h-1" />
      <nav className="border-b border-white/10 bg-fpl-dark/90 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <NavLink to={session ? '/' : '/login'} className="flex items-center gap-2.5">
            <Logo size={36} />
            <span className="text-lg font-extrabold tracking-tight">Pool League</span>
          </NavLink>
          <div className="flex items-center gap-1.5 text-sm">
            {session &&
              links.map((link) => (
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
            <AccountMenu />
          </div>
        </div>
      </nav>
    </header>
  );
}
