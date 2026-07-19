import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <p className="fpl-gradient-text text-7xl font-extrabold">404</p>
      <p>Page not found.</p>
      <Link
        to="/"
        className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground transition-transform hover:scale-105"
      >
        Back to Leaderboard
      </Link>
    </div>
  );
}
