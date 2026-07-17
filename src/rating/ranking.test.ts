import { describe, it, expect } from 'vitest';
import { computeLeaderboard } from './ranking';

describe('computeLeaderboard', () => {
  it('ranks eligible players by rating descending, starting at 1', () => {
    const players = [
      { playerId: 'a', rating: 1600, matchesPlayed: 5 },
      { playerId: 'b', rating: 1800, matchesPlayed: 10 },
      { playerId: 'c', rating: 1700, matchesPlayed: 3 },
    ];
    expect(computeLeaderboard(players)).toEqual([
      { playerId: 'b', rating: 1800, rank: 1 },
      { playerId: 'c', rating: 1700, rank: 2 },
      { playerId: 'a', rating: 1600, rank: 3 },
    ]);
  });

  it('excludes players below the minimum matches threshold', () => {
    const players = [
      { playerId: 'a', rating: 2000, matchesPlayed: 1 },
      { playerId: 'b', rating: 1500, matchesPlayed: 3 },
    ];
    expect(computeLeaderboard(players)).toEqual([
      { playerId: 'b', rating: 1500, rank: 1 },
    ]);
  });

  it('honors a custom minimum matches override', () => {
    const players = [
      { playerId: 'a', rating: 2000, matchesPlayed: 1 },
    ];
    expect(computeLeaderboard(players, 1)).toEqual([
      { playerId: 'a', rating: 2000, rank: 1 },
    ]);
  });

  it('returns an empty array when no players are eligible', () => {
    const players = [{ playerId: 'a', rating: 2000, matchesPlayed: 0 }];
    expect(computeLeaderboard(players)).toEqual([]);
  });

  it('breaks ties deterministically instead of relying on input order', () => {
    const players = [
      { playerId: 'zzz', rating: 1600, matchesPlayed: 5 },
      { playerId: 'aaa', rating: 1600, matchesPlayed: 5 },
    ];
    const ranked = computeLeaderboard(players, 0);
    expect(ranked[0].playerId).toBe('aaa');
    expect(ranked[1].playerId).toBe('zzz');
  });
});
