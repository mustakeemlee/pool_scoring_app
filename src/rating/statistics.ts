// src/rating/statistics.ts
import { FORM_WEIGHT_LAST5, FORM_WEIGHT_LAST10 } from './constants.js';

export function winPercentage(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return (wins / total) * 100;
}

export function currentStreak(outcomesChronological: boolean[]): number {
  if (outcomesChronological.length === 0) return 0;
  const mostRecent = outcomesChronological[outcomesChronological.length - 1];
  let count = 0;
  for (let i = outcomesChronological.length - 1; i >= 0; i -= 1) {
    if (outcomesChronological[i] === mostRecent) {
      count += 1;
    } else {
      break;
    }
  }
  return mostRecent ? count : -count;
}

export function longestStreak(outcomesChronological: boolean[]): number {
  let longest = 0;
  let current = 0;
  for (const won of outcomesChronological) {
    if (won) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function averageOpponentRating(opponentRatings: number[]): number {
  if (opponentRatings.length === 0) return 0;
  const sum = opponentRatings.reduce((acc, r) => acc + r, 0);
  return sum / opponentRatings.length;
}

export function formPercentage(recentOutcomesChronological: boolean[]): number {
  const wins = recentOutcomesChronological.filter(Boolean).length;
  return winPercentage(wins, recentOutcomesChronological.length - wins);
}

export function formScore(last5: boolean[], last10: boolean[]): number {
  return FORM_WEIGHT_LAST5 * formPercentage(last5) + FORM_WEIGHT_LAST10 * formPercentage(last10);
}
