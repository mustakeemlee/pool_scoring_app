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
 * All fields below describe player A's perspective only. A caller that also
 * needs to write a rating_events row for player B should derive:
 *   expectedScoreB = 1 - expectedScoreA
 *   actualScoreB   = 1 - actualScoreA
 *   deltaB         = -deltaA
 */
export interface InstantNudgeOutput {
  expectedScoreA: number;
  actualScoreA: number;
  kEffectiveA: number;
  movMultiplier: number;
  deltaA: number;
  newRatingA: number;
  newRatingB: number;
}

export function applyInstantNudge(input: InstantNudgeInput): InstantNudgeOutput {
  const { ratingA, rdA, ratingB, framesA, framesB } = input;
  const expectedScoreA = expectedScore(ratingA, ratingB);
  const actualScoreA = framesA > framesB ? 1 : 0;
  const kEffectiveA = kEffective(rdA);
  const mov = movMultiplier(framesA, framesB);
  const deltaA = kEffectiveA * mov * (actualScoreA - expectedScoreA);

  return {
    expectedScoreA,
    actualScoreA,
    kEffectiveA,
    movMultiplier: mov,
    deltaA,
    newRatingA: ratingA + deltaA,
    newRatingB: ratingB - deltaA,
  };
}
