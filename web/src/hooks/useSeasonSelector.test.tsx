import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockUseSeasons = vi.fn();
vi.mock('@/hooks/useSeasons', () => ({ useSeasons: () => mockUseSeasons() }));

import { useSeasonSelector } from './useSeasonSelector';

const SEASONS = [
  { id: 's3', name: 'Season 3', start_date: '2026-06-01', end_date: null, status: 'active' as const },
  { id: 's2', name: 'Season 2', start_date: '2026-03-01', end_date: '2026-05-31', status: 'completed' as const },
  { id: 's1', name: 'Season 1', start_date: '2026-01-01', end_date: '2026-02-28', status: 'completed' as const },
];

describe('useSeasonSelector', () => {
  beforeEach(() => {
    mockUseSeasons.mockReset();
  });

  it('defaults to the most recent season once seasons load', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.selectedSeason?.id).toBe('s3');
    expect(result.current.selectedSeasonId).toBe('s3');
  });

  it('leaves selectedSeasonId unset when there are no seasons at all', () => {
    mockUseSeasons.mockReturnValue({ data: [], isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.selectedSeason).toBeNull();
    expect(result.current.selectedSeasonId).toBeUndefined();
  });

  it('selectSeason switches to an explicit season', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());

    act(() => {
      result.current.selectSeason('s1');
    });

    expect(result.current.selectedSeason?.id).toBe('s1');
  });

  it('selectPrevious/selectNext step chronologically and stop at either end', () => {
    mockUseSeasons.mockReturnValue({ data: SEASONS, isLoading: false, isError: false });
    const { result } = renderHook(() => useSeasonSelector());

    expect(result.current.selectedSeasonId).toBe('s3');
    expect(result.current.hasNext).toBe(false);
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s2');
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrevious).toBe(true);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s1');
    expect(result.current.hasPrevious).toBe(false);

    act(() => {
      result.current.selectPrevious();
    });
    expect(result.current.selectedSeasonId).toBe('s1');

    act(() => {
      result.current.selectNext();
    });
    expect(result.current.selectedSeasonId).toBe('s2');
  });

  it('surfaces loading/error state from useSeasons', () => {
    mockUseSeasons.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { result } = renderHook(() => useSeasonSelector());
    expect(result.current.isLoading).toBe(true);
  });
});
