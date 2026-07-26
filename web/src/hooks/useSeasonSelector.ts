import { useState } from 'react';
import { useSeasons } from '@/hooks/useSeasons';
import type { Season } from '@/lib/types';

export interface UseSeasonSelectorResult {
  selectedSeason: Season | null;
  selectedSeasonId: string | undefined;
  seasons: Season[];
  isLoading: boolean;
  isError: boolean;
  selectSeason: (seasonId: string) => void;
  selectPrevious: () => void;
  selectNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function useSeasonSelector(): UseSeasonSelectorResult {
  const seasonsQuery = useSeasons();
  const [explicitSeasonId, setExplicitSeasonId] = useState<string | undefined>(undefined);

  const seasons = seasonsQuery.data ?? [];
  const selectedSeasonId = explicitSeasonId ?? seasons[0]?.id;
  const selectedIndex = seasons.findIndex((season) => season.id === selectedSeasonId);
  const selectedSeason = selectedIndex === -1 ? null : seasons[selectedIndex];

  function selectSeason(seasonId: string): void {
    setExplicitSeasonId(seasonId);
  }

  function selectPrevious(): void {
    if (selectedIndex === -1 || selectedIndex >= seasons.length - 1) return;
    setExplicitSeasonId(seasons[selectedIndex + 1].id);
  }

  function selectNext(): void {
    if (selectedIndex <= 0) return;
    setExplicitSeasonId(seasons[selectedIndex - 1].id);
  }

  return {
    selectedSeason,
    selectedSeasonId,
    seasons,
    isLoading: seasonsQuery.isLoading,
    isError: seasonsQuery.isError,
    selectSeason,
    selectPrevious,
    selectNext,
    hasPrevious: selectedIndex !== -1 && selectedIndex < seasons.length - 1,
    hasNext: selectedIndex > 0,
  };
}
