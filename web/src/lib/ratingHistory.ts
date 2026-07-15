// web/src/lib/ratingHistory.ts
import type { RatingEvent } from './types';

export interface RatingHistoryPoint {
  date: string;
  rating: number;
}

export function toRatingHistoryPoints(events: RatingEvent[]): RatingHistoryPoint[] {
  return events
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((event) => ({
      date: event.created_at.slice(0, 10),
      rating: event.rating_after,
    }));
}
