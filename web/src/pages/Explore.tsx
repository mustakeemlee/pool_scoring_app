// web/src/pages/Explore.tsx
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { MatchTable } from '@/components/MatchTable';
import { useActiveSeason } from '@/hooks/useActiveSeason';
import { usePlayers } from '@/hooks/usePlayers';
import { useSeasons } from '@/hooks/useSeasons';
import { useAllMatches } from '@/hooks/useAllMatches';

function matches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query);
}

export function ExplorePage() {
  const [query, setQuery] = useState('');
  const activeSeason = useActiveSeason();
  const players = usePlayers(activeSeason.data?.id);
  const seasons = useSeasons();
  const allMatches = useAllMatches();

  const normalizedQuery = query.trim().toLowerCase();

  const matchedPlayers = useMemo(
    () => (players.data ?? []).filter((p) => matches(p.full_name, normalizedQuery)),
    [players.data, normalizedQuery],
  );
  const matchedSeasons = useMemo(
    () => (seasons.data ?? []).filter((s) => matches(s.name, normalizedQuery)),
    [seasons.data, normalizedQuery],
  );
  const matchedMatches = useMemo(
    () =>
      (allMatches.data ?? []).filter(
        (m) => matches(m.player_a.full_name, normalizedQuery) || matches(m.player_b.full_name, normalizedQuery),
      ),
    [allMatches.data, normalizedQuery],
  );

  const isLoading = players.isLoading || seasons.isLoading || allMatches.isLoading;
  const isError = players.isError || seasons.isError || allMatches.isError;

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Search</p>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Explore</h1>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search players, matches, seasons…"
        className="mb-6"
        autoFocus
      />

      {!normalizedQuery ? (
        <p className="text-muted-foreground text-sm">Start typing to search players, matches, and seasons.</p>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : isError ? (
        <p className="text-destructive text-sm">Couldn't load search data. Try refreshing.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
              Players{matchedPlayers.length > 0 && ` (${matchedPlayers.length})`}
            </h2>
            {matchedPlayers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching players.</p>
            ) : (
              <ul className="card-surface overflow-hidden">
                {matchedPlayers.map((player) => (
                  <li key={player.id} className="border-b border-border last:border-0">
                    <Link
                      to={`/players/${player.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5"
                    >
                      <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                      <span className="font-semibold">{player.full_name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
              Seasons{matchedSeasons.length > 0 && ` (${matchedSeasons.length})`}
            </h2>
            {matchedSeasons.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching seasons.</p>
            ) : (
              <ul className="card-surface overflow-hidden">
                {matchedSeasons.map((season) => {
                  const row = (
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="font-semibold">{season.name}</span>
                      <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                        {season.status}
                      </span>
                    </div>
                  );
                  return (
                    <li key={season.id} className="border-b border-border last:border-0">
                      {season.status === 'active' ? (
                        <Link to="/" className="block hover:bg-foreground/5">
                          {row}
                        </Link>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-muted-foreground mb-3 text-sm font-bold uppercase tracking-wider">
              Matches{matchedMatches.length > 0 && ` (${matchedMatches.length})`}
            </h2>
            {matchedMatches.length === 0 ? (
              <p className="text-muted-foreground text-sm">No matching matches.</p>
            ) : (
              <MatchTable matches={matchedMatches} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
