// web/src/pages/GradeRoster.tsx
import { Link, useParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { GradeBadge } from '@/components/GradeBadge';
import { SeasonPillSwitcher } from '@/components/SeasonPillSwitcher';
import { useSeasonSelector } from '@/hooks/useSeasonSelector';
import { useGradeRoster } from '@/hooks/useGradeRoster';
import type { Grade } from '@/lib/types';

export function GradeRosterPage() {
  const { grade } = useParams<{ grade: string }>();
  const seasonSelector = useSeasonSelector();
  const roster = useGradeRoster(seasonSelector.selectedSeasonId, grade as Grade | undefined);

  if (seasonSelector.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (seasonSelector.isError) {
    return <p className="text-destructive">Couldn't load grade roster. Try refreshing.</p>;
  }

  if (!seasonSelector.selectedSeasonId) {
    return <p className="text-muted-foreground">No seasons exist yet.</p>;
  }

  if (roster.isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (roster.isError) {
    return <p className="text-destructive">Couldn't load grade roster. Try refreshing.</p>;
  }

  const players = roster.data ?? [];

  return (
    <div>
      <div className="fpl-gradient-soft mb-6 rounded-2xl border border-border px-6 py-8">
        <div className="mb-3 flex justify-center sm:justify-start">
          <SeasonPillSwitcher
            selectedSeason={seasonSelector.selectedSeason}
            seasons={seasonSelector.seasons}
            onSelectSeason={seasonSelector.selectSeason}
            onPrevious={seasonSelector.selectPrevious}
            onNext={seasonSelector.selectNext}
            hasPrevious={seasonSelector.hasPrevious}
            hasNext={seasonSelector.hasNext}
          />
        </div>
        <div className="flex items-center gap-3">
          <GradeBadge grade={grade as Grade} />
          <h1 className="text-3xl font-extrabold sm:text-4xl">Grade {grade}</h1>
        </div>
      </div>
      {players.length === 0 ? (
        <p className="text-muted-foreground">No players in this grade yet.</p>
      ) : (
        <ul className="card-surface overflow-hidden">
          {players.map((player) => (
            <li key={player.player_id} className="border-b border-border last:border-0">
              <Link
                to={`/players/${player.player_id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/5"
              >
                <PlayerAvatar name={player.full_name} photoUrl={player.photo_url} size="sm" />
                <span className="flex-1 font-semibold">{player.full_name}</span>
                <span className="text-muted-foreground text-sm tabular-nums">{player.rating}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
