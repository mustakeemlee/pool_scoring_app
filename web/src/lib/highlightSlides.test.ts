// web/src/lib/highlightSlides.test.ts
import { describe, it, expect } from 'vitest';
import { buildHighlightSlides, HIGHLIGHTS_LIMIT } from './highlightSlides';
import type { MatchRow } from '@/lib/types';
import type { RecentActivityPlayer } from '@/hooks/useRecentActivity';

function makeMatch(overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: 'm1',
    season_id: 's1',
    match_date: '2026-07-25',
    player_a_id: 'p1',
    player_b_id: 'p2',
    frames_a: 4,
    frames_b: 2,
    winner_id: 'p1',
    is_voided: false,
    is_period_closed: false,
    player_a: { id: 'p1', full_name: 'Alex Testplayer', photo_url: null },
    player_b: { id: 'p2', full_name: 'Jordan Testplayer', photo_url: null },
    ...overrides,
  };
}

describe('buildHighlightSlides', () => {
  it('puts Player of the Week first, then the season-live slide, when both are present', () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: { player_id: 'p1', full_name: 'Alex Testplayer', photo_url: null, ratingGain: 42 },
      activeSeasonName: 'Season 2026',
      recentMatches: [],
      recentPlayers: [],
    });

    expect(slides).toEqual([
      { kind: 'potw', playerId: 'p1', fullName: 'Alex Testplayer', photoUrl: null, ratingGain: 42 },
      { kind: 'season-live', seasonName: 'Season 2026' },
    ]);
  });

  it("describes a match slide from the winner's perspective regardless of which side won", () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [makeMatch({ winner_id: 'p2', frames_a: 2, frames_b: 4 })],
      recentPlayers: [],
    });

    expect(slides).toEqual([
      { kind: 'match', matchId: 'm1', description: 'Jordan Testplayer beat Alex Testplayer 4-2' },
    ]);
  });

  it('adds a signup slide for a recently-active player who signed up, but not one whose activity was a match', () => {
    const recentPlayers: RecentActivityPlayer[] = [
      { id: 'p3', full_name: 'Sam Newcomer', photo_url: null, activity: 'signup', activity_date: '2026-07-26' },
      { id: 'p1', full_name: 'Alex Testplayer', photo_url: null, activity: 'match', activity_date: '2026-07-25' },
    ];

    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [],
      recentPlayers,
    });

    expect(slides).toEqual([{ kind: 'signup', playerId: 'p3', description: 'New player: Sam Newcomer joined' }]);
  });

  it('caps the total number of slides at HIGHLIGHTS_LIMIT', () => {
    const recentMatches = Array.from({ length: HIGHLIGHTS_LIMIT + 3 }, (_, i) =>
      makeMatch({ id: `m${i}`, match_date: `2026-07-${20 + i}` }),
    );

    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches,
      recentPlayers: [],
    });

    expect(slides).toHaveLength(HIGHLIGHTS_LIMIT);
  });

  it('falls back to a single welcome slide when there is nothing to show', () => {
    const slides = buildHighlightSlides({
      playerOfTheWeek: null,
      activeSeasonName: null,
      recentMatches: [],
      recentPlayers: [],
    });

    expect(slides).toEqual([{ kind: 'welcome' }]);
  });
});
