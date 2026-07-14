import {
  BASELINE_RATING,
  SEASON_CARRYOVER_REGRESSION,
  SEASON_CARRYOVER_RD_INCREASE,
  INITIAL_RD,
} from './constants.ts';

export interface CarryoverState {
  rating: number;
  rd: number;
  volatility: number;
}

export function applySeasonCarryover(input: CarryoverState): CarryoverState {
  return {
    rating: BASELINE_RATING + SEASON_CARRYOVER_REGRESSION * (input.rating - BASELINE_RATING),
    rd: Math.min(INITIAL_RD, input.rd + SEASON_CARRYOVER_RD_INCREASE),
    volatility: input.volatility,
  };
}
