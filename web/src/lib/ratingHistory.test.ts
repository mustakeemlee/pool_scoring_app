// web/src/lib/ratingHistory.test.ts
import { describe, it, expect } from 'vitest';
import { toRatingHistoryPoints } from './ratingHistory';
import type { RatingEvent } from './types';

function event(overrides: Partial<RatingEvent>): RatingEvent {
  return {
    id: 'e1',
    match_id: 'm1',
    player_id: 'p1',
    season_id: 's1',
    rating_before: 1500,
    rating_after: 1500,
    delta: 0,
    event_type: 'instant',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('toRatingHistoryPoints', () => {
  it('maps each event to a { date, rating } point using rating_after', () => {
    const points = toRatingHistoryPoints([event({ created_at: '2026-01-08T10:00:00Z', rating_after: 1514.2 })]);
    expect(points).toEqual([{ date: '2026-01-08', rating: 1514.2 }]);
  });

  it('sorts points chronologically regardless of input order', () => {
    const points = toRatingHistoryPoints([
      event({ created_at: '2026-01-15T10:00:00Z', rating_after: 1530 }),
      event({ created_at: '2026-01-08T10:00:00Z', rating_after: 1514 }),
    ]);
    expect(points.map((p) => p.date)).toEqual(['2026-01-08', '2026-01-15']);
  });

  it('returns an empty array for no events', () => {
    expect(toRatingHistoryPoints([])).toEqual([]);
  });
});
