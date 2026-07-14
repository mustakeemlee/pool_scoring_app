// src/rating/glicko2.ts
import { GLICKO2_SCALE, GLICKO2_TAU, GLICKO2_CONVERGENCE_EPSILON, RD_FLOOR } from './constants.js';

export interface Glicko2PlayerState {
  rating: number;
  rd: number;
  volatility: number;
}

export interface Glicko2Opponent {
  rating: number;
  rd: number;
  score: 0 | 1;
}

function toScale(rating: number, rd: number): { mu: number; phi: number } {
  return { mu: (rating - 1500) / GLICKO2_SCALE, phi: rd / GLICKO2_SCALE };
}

function fromScale(mu: number, phi: number): { rating: number; rd: number } {
  return { rating: GLICKO2_SCALE * mu + 1500, rd: GLICKO2_SCALE * phi };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedValue(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function solveNewVolatility(delta: number, phi: number, v: number, sigma: number): number {
  const a = Math.log(sigma * sigma);
  const tau = GLICKO2_TAU;

  const f = (x: number): number => {
    const ex = Math.exp(x);
    const numerator = ex * (delta * delta - phi * phi - v - ex);
    const denominator = 2 * Math.pow(phi * phi + v + ex, 2);
    return numerator / denominator - (x - a) / (tau * tau);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    B = a - k * tau;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > GLICKO2_CONVERGENCE_EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

export function reconcilePeriod(
  player: Glicko2PlayerState,
  opponents: Glicko2Opponent[],
): Glicko2PlayerState {
  const { mu, phi } = toScale(player.rating, player.rd);

  if (opponents.length === 0) {
    const phiStar = Math.sqrt(phi * phi + player.volatility * player.volatility);
    const { rd } = fromScale(mu, phiStar);
    return { rating: player.rating, rd: Math.max(RD_FLOOR, rd), volatility: player.volatility };
  }

  let vInverseSum = 0;
  let deltaSum = 0;
  for (const opponent of opponents) {
    const opponentScale = toScale(opponent.rating, opponent.rd);
    const gPhiJ = g(opponentScale.phi);
    const e = expectedValue(mu, opponentScale.mu, opponentScale.phi);
    vInverseSum += gPhiJ * gPhiJ * e * (1 - e);
    deltaSum += gPhiJ * (opponent.score - e);
  }

  const v = 1 / vInverseSum;
  const delta = v * deltaSum;

  const newVolatility = solveNewVolatility(delta, phi, v, player.volatility);

  const phiStar = Math.sqrt(phi * phi + newVolatility * newVolatility);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  const { rating, rd } = fromScale(newMu, newPhi);
  return { rating, rd: Math.max(RD_FLOOR, rd), volatility: newVolatility };
}
