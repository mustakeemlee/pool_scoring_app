export interface SeasonPointsInput {
  won: boolean;
  framesFor: number;
  framesAgainst: number;
  ownRating: number;
  opponentRating: number;
}

export function calculateSeasonPoints(input: SeasonPointsInput): number {
  const { won, framesFor, framesAgainst, ownRating, opponentRating } = input;

  const base = won ? 3 : 0;
  const frameBonus = framesFor;
  const upsetBonus = won && opponentRating > ownRating
    ? Math.min(5, Math.round((opponentRating - ownRating) / 100))
    : 0;
  const whitewashBonus = won && framesAgainst === 0 ? 2 : 0;

  return base + frameBonus + upsetBonus + whitewashBonus;
}
