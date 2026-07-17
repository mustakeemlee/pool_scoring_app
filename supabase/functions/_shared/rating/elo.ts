// src/rating/elo.ts
import { RD_MIN_FOR_K, RD_MAX_FOR_K, K_MIN, K_MAX } from './constants.ts';

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, -(ratingA - ratingB) / 400));
}

export function kEffective(rd: number): number {
  const clamped = Math.min(RD_MAX_FOR_K, Math.max(RD_MIN_FOR_K, rd));
  const t = (clamped - RD_MIN_FOR_K) / (RD_MAX_FOR_K - RD_MIN_FOR_K);
  return K_MIN + (K_MAX - K_MIN) * t;
}

export function movMultiplier(framesA: number, framesB: number): number {
  const margin = Math.abs(framesA - framesB);
  const raceLength = Math.max(framesA, framesB);
  if (raceLength <= 1) return 1.0;
  return 1 + 0.5 * (margin - 1) / (raceLength - 1);
}

export interface InstantNudgeInput {
  ratingA: number;
  rdA: number;
  ratingB: number;
  rdB: number;
  framesA: number;
  framesB: number;
}

/**
 * Player A's perspective fields plus player B's independently-computed
 * delta. Each player's rating change is derived from their OWN K-factor
 * (via their own RD), so the update is no longer forced to be zero-sum
 * around a single shared K taken from player A alone. A caller that also
 * needs to write a rating_events row for player B should use `deltaB`
 * directly (not `-deltaA`), along with `expectedScoreB = 1 - expectedScoreA`
 * and `actualScoreB = 1 - actualScoreA`.
 */
export interface InstantNudgeOutput {
  expectedScoreA: number;
  actualScoreA: number;
  kEffectiveA: number;
  movMultiplier: number;
  deltaA: number;
  deltaB: number;
  newRatingA: number;
  newRatingB: number;
}

export function applyInstantNudge(input: InstantNudgeInput): InstantNudgeOutput {
  const { ratingA, rdA, ratingB, rdB, framesA, framesB } = input;

  if (framesA === framesB) {
    throw new Error('applyInstantNudge: framesA and framesB cannot be equal (no tie is possible)');
  }
  if (framesA < 0 || framesB < 0) {
    throw new Error('applyInstantNudge: frame counts cannot be negative');
  }

  const expectedScoreA = expectedScore(ratingA, ratingB);
  const expectedScoreB = 1 - expectedScoreA;
  const actualScoreA = framesA > framesB ? 1 : 0;
  const actualScoreB = 1 - actualScoreA;
  const kEffectiveA = kEffective(rdA);
  const kEffectiveB = kEffective(rdB);
  const mov = movMultiplier(framesA, framesB);
  const deltaA = kEffectiveA * mov * (actualScoreA - expectedScoreA);
  const deltaB = kEffectiveB * mov * (actualScoreB - expectedScoreB);

  return {
    expectedScoreA,
    actualScoreA,
    kEffectiveA,
    movMultiplier: mov,
    deltaA,
    deltaB,
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB + deltaB,
  };
}
