// web/src/lib/types.ts

export type Grade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D';

export interface LeaderboardEntry {
  player_id: string;
  full_name: string;
  photo_url?: string | null;
  season_id: string;
  rating: number;
  grade: Grade;
  season_points: number;
  rank: number;
}

export interface GradeDistributionEntry {
  season_id: string;
  grade: Grade;
  player_count: number;
}

export interface PlayerSeasonRating {
  id: string;
  player_id: string;
  season_id: string;
  rating: number;
  rd: number;
  volatility: number;
  matches_played: number;
  is_provisional: boolean;
  grade: Grade;
  season_points: number;
}

export interface PlayerStatistics {
  id: string;
  player_id: string;
  season_id: string;
  wins: number;
  losses: number;
  win_pct: number;
  current_streak: number;
  longest_streak: number;
  frames_won: number;
  frames_lost: number;
  avg_opponent_rating: number | null;
  form_5: number | null;
  form_10: number | null;
  form_score: number | null;
}

export type RatingEventType = 'instant' | 'weekly_reconciliation' | 'season_carryover';

export interface RatingEvent {
  id: string;
  match_id: string | null;
  player_id: string;
  season_id: string;
  rating_before: number;
  rating_after: number;
  delta: number;
  event_type: RatingEventType;
  created_at: string;
}

export interface PlayerSummary {
  id: string;
  full_name: string;
  photo_url?: string | null;
}

export interface MatchRow {
  id: string;
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
  winner_id: string;
  is_voided: boolean;
  is_period_closed: boolean;
  player_a: PlayerSummary;
  player_b: PlayerSummary;
}

export interface Season {
  id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  status: 'draft' | 'active' | 'completed';
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected';

export interface PlayerClaim {
  id: string;
  user_id: string;
  player_id: string;
  status: ClaimStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
