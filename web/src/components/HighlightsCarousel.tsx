// web/src/components/HighlightsCarousel.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { useSeasonInFlight } from '@/hooks/useSeasonInFlight';
import { usePlayerOfTheWeek } from '@/hooks/usePlayerOfTheWeek';
import { useRecentActivity } from '@/hooks/useRecentActivity';
import { buildHighlightSlides, type HighlightSlide } from '@/lib/highlightSlides';

const ROTATE_INTERVAL_MS = 6000;

function SlideContent({ slide }: { slide: HighlightSlide }) {
  switch (slide.kind) {
    case 'potw':
      return (
        <div className="flex items-center gap-4">
          <PlayerAvatar name={slide.fullName} photoUrl={slide.photoUrl} size="lg" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-white/80">Player of the Week</p>
            <Link to={`/players/${slide.playerId}`} className="text-xl font-extrabold text-white hover:underline">
              {slide.fullName}
            </Link>
            <p className="text-sm text-white/85">+{slide.ratingGain} rating this week</p>
          </div>
        </div>
      );
    case 'season-live':
      return <p className="text-lg font-bold text-white">Season {slide.seasonName} is live</p>;
    case 'match':
      return <p className="text-lg font-bold text-white">{slide.description}</p>;
    case 'signup':
      return (
        <Link to={`/players/${slide.playerId}`} className="text-lg font-bold text-white hover:underline">
          {slide.description}
        </Link>
      );
    case 'welcome':
      return <p className="text-lg font-bold text-white">Welcome to PoolIQ</p>;
  }
}

export function HighlightsCarousel() {
  const seasonInFlight = useSeasonInFlight();
  const activeSeasonId = seasonInFlight.data?.season?.id;
  const playerOfTheWeek = usePlayerOfTheWeek(activeSeasonId);
  const recentActivity = useRecentActivity();

  const isLoading = seasonInFlight.isLoading || playerOfTheWeek.isLoading || recentActivity.isLoading;
  const isError = seasonInFlight.isError || playerOfTheWeek.isError || recentActivity.isError;

  const slides =
    isLoading || isError
      ? []
      : buildHighlightSlides({
          playerOfTheWeek: playerOfTheWeek.data ?? null,
          activeSeasonName: seasonInFlight.data?.season?.name ?? null,
          recentMatches: recentActivity.data?.recentMatches ?? [],
          recentPlayers: recentActivity.data?.recentPlayers ?? [],
        });

  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    setSlideIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return undefined;
    const interval = setInterval(() => {
      setSlideIndex((current) => (current + 1) % slides.length);
    }, ROTATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [slides.length]);

  if (isLoading) {
    return <Skeleton className="mb-6 h-32 w-full rounded-2xl" />;
  }

  if (isError) {
    return <p className="text-destructive mb-6 text-sm">Couldn't load dashboard highlights. Try refreshing.</p>;
  }

  const currentSlide = slides[slideIndex] ?? slides[0];

  return (
    <div className="fpl-gradient mb-6 rounded-2xl px-6 py-8">
      <SlideContent slide={currentSlide} />
      {slides.length > 1 && (
        <div className="mt-4 flex justify-center gap-1.5">
          {slides.map((slide, index) => (
            <button
              key={`${slide.kind}-${index}`}
              type="button"
              aria-label={`Show slide ${index + 1}`}
              onClick={() => setSlideIndex(index)}
              className={`h-1.5 w-1.5 rounded-full ${index === slideIndex ? 'bg-white' : 'bg-white/30'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
