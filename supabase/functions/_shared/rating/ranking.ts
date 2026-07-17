import { MIN_MATCHES_FOR_RANKING } from './constants.ts';

export interface RankablePlayer {
  playerId: string;
  rating: number;
  matchesPlayed: number;
}

export interface RankedEntry {
  playerId: string;
  rating: number;
  rank: number;
}

export function computeLeaderboard(
  players: RankablePlayer[],
  minMatches: number = MIN_MATCHES_FOR_RANKING,
): RankedEntry[] {
  return players
    .filter((p) => p.matchesPlayed >= minMatches)
    .sort((a, b) => b.rating - a.rating || b.matchesPlayed - a.matchesPlayed || a.playerId.localeCompare(b.playerId))
    .map((p, index) => ({ playerId: p.playerId, rating: p.rating, rank: index + 1 }));
}
