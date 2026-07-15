// web/src/lib/playerProfileMatches.test.ts
import { describe, it, expect } from 'vitest';
import { toPlayerProfileMatches } from './playerProfileMatches';
import type { MatchRow, RatingEvent } from './types';

const match: MatchRow = {
  id: 'm1',
  season_id: 's1',
  match_date: '2026-01-22',
  player_a_id: 'p1',
  player_b_id: 'p2',
  frames_a: 5,
  frames_b: 2,
  winner_id: 'p1',
  is_voided: false,
  is_period_closed: false,
  player_a: { id: 'p1', full_name: 'Alex Testplayer' },
  player_b: { id: 'p2', full_name: 'Jordan Testplayer' },
};

const instantEvent: RatingEvent = {
  id: 'e1',
  match_id: 'm1',
  player_id: 'p1',
  season_id: 's1',
  rating_before: 1754,
  rating_after: 1768.2,
  delta: 14.2,
  event_type: 'instant',
  created_at: '2026-01-22T18:00:00Z',
};

describe('toPlayerProfileMatches', () => {
  it('resolves the opponent as the other player when the target is player A', () => {
    const [result] = toPlayerProfileMatches('p1', [match], [instantEvent]);
    expect(result.opponent_id).toBe('p2');
    expect(result.opponent_name).toBe('Jordan Testplayer');
    expect(result.frames_for).toBe(5);
    expect(result.frames_against).toBe(2);
    expect(result.won).toBe(true);
  });

  it('resolves the opponent as player A when the target is player B, and flips frames/won', () => {
    const [result] = toPlayerProfileMatches('p2', [match], [instantEvent]);
    expect(result.opponent_id).toBe('p1');
    expect(result.opponent_name).toBe('Alex Testplayer');
    expect(result.frames_for).toBe(2);
    expect(result.frames_against).toBe(5);
    expect(result.won).toBe(false);
  });

  it('attaches the instant rating_events delta for the matching match_id', () => {
    const [result] = toPlayerProfileMatches('p1', [match], [instantEvent]);
    expect(result.rating_delta).toBe(14.2);
  });

  it('leaves rating_delta null when no instant event exists for that match', () => {
    const [result] = toPlayerProfileMatches('p1', [match], []);
    expect(result.rating_delta).toBeNull();
  });

  it('sorts matches most-recent-first', () => {
    const older: MatchRow = { ...match, id: 'm0', match_date: '2026-01-15' };
    const results = toPlayerProfileMatches('p1', [older, match], []);
    expect(results.map((r) => r.id)).toEqual(['m1', 'm0']);
  });
});
