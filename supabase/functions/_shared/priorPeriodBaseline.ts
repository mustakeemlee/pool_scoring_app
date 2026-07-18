// supabase/functions/_shared/priorPeriodBaseline.ts
import type { TransactionSql } from './dbTransaction.ts';
import { BASELINE_RATING, INITIAL_RD, INITIAL_VOLATILITY } from './rating/constants.ts';

export interface PriorPeriodBaseline {
  rating: number;
  rd: number;
  volatility: number;
}

// The player's rating/rd/volatility as of the end of their last formally
// closed period (weekly_reconciliation or season_carryover) -- i.e. before
// any of the CURRENT open period's instant nudges. If no such event exists
// yet this season, the player has never had a period closed for them, so
// the baseline is simply the season's starting defaults.
export async function getPriorPeriodBaseline(
  sql: TransactionSql,
  playerId: string,
  seasonId: string,
): Promise<PriorPeriodBaseline> {
  const [lastEvent] = await sql`
    select rating_after, rd_after, volatility_after from rating_events
    where player_id = ${playerId} and season_id = ${seasonId}
      and event_type in ('weekly_reconciliation', 'season_carryover')
    order by created_at desc
    limit 1
  `;
  // rating_after/rd_after/volatility_after are `numeric` columns; postgres.js
  // returns numeric as a string (to avoid float precision loss), so each must
  // be coerced to a JS number before any caller does rating arithmetic on it
  // (close-week feeds these straight into reconcilePeriod; correct-match feeds
  // rating/rd into applyInstantNudge). Both reconciliation and carryover
  // events always populate volatility_after (see close-week / start-season),
  // so the coercion never sees a null here.
  return lastEvent
    ? {
        rating: Number(lastEvent.rating_after),
        rd: Number(lastEvent.rd_after),
        volatility: Number(lastEvent.volatility_after),
      }
    : { rating: BASELINE_RATING, rd: INITIAL_RD, volatility: INITIAL_VOLATILITY };
}
