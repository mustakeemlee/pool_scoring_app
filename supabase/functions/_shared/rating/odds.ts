import { expectedScore } from './elo.ts';

export function winProbability(ratingA: number, ratingB: number): number {
  return expectedScore(ratingA, ratingB);
}

export function impliedDecimalOdds(probability: number): number {
  if (probability <= 0) {
    throw new Error('probability must be greater than 0');
  }
  return 1 / probability;
}
