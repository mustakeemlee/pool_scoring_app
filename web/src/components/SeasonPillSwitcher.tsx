import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Season } from '@/lib/types';

export interface SeasonPillSwitcherProps {
  selectedSeason: Season | null;
  seasons: Season[];
  onSelectSeason: (seasonId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function SeasonPillSwitcher({
  selectedSeason,
  seasons,
  onSelectSeason,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: SeasonPillSwitcherProps) {
  if (!selectedSeason) return null;

  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        aria-label="Previous season"
        disabled={!hasPrevious}
        onClick={onPrevious}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <Select value={selectedSeason.id} onValueChange={onSelectSeason}>
        <SelectTrigger className="h-auto w-auto gap-2 rounded-full border-border bg-card px-4 py-1.5">
          <SelectValue>
            <span className="flex items-center gap-2 text-sm font-bold">
              {selectedSeason.name}
              {selectedSeason.status === 'active' && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  Active
                </span>
              )}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {seasons.map((season) => (
            <SelectItem key={season.id} value={season.id}>
              {season.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        aria-label="Next season"
        disabled={!hasNext}
        onClick={onNext}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-secondary-foreground disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
