// web/src/lib/playerProfileMatches.ts
import type { MatchRow, RatingEvent } from './types';

export interface PlayerProfileMatch {
  id: string;
  match_date: string;
  opponent_id: string;
  opponent_name: string;
  frames_for: number;
  frames_against: number;
  won: boolean;
  is_voided: boolean;
  rating_delta: number | null;
}

export function toPlayerProfileMatches(
  playerId: string,
  matches: MatchRow[],
  ratingEvents: RatingEvent[],
): PlayerProfileMatch[] {
  const deltaByMatchId = new Map<string, number>();
  for (const event of ratingEvents) {
    if (event.event_type === 'instant' && event.match_id) {
      deltaByMatchId.set(event.match_id, event.delta);
    }
  }

  return matches
    .slice()
    .sort((a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime())
    .map((match) => {
      const isPlayerA = match.player_a_id === playerId;
      const opponent = isPlayerA ? match.player_b : match.player_a;
      return {
        id: match.id,
        match_date: match.match_date,
        opponent_id: isPlayerA ? match.player_b_id : match.player_a_id,
        opponent_name: opponent.full_name,
        frames_for: isPlayerA ? match.frames_a : match.frames_b,
        frames_against: isPlayerA ? match.frames_b : match.frames_a,
        won: match.winner_id === playerId,
        is_voided: match.is_voided,
        rating_delta: deltaByMatchId.get(match.id) ?? null,
      };
    });
}
