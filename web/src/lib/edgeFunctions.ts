// web/src/lib/edgeFunctions.ts
import { supabase } from './supabaseClient';

export interface EdgeFunctionError extends Error {
  status: number;
}

async function callEdgeFunction<TBody extends object, TResponse>(
  functionName: string,
  method: 'POST' | 'PATCH',
  body: TBody,
): Promise<TResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error('Not signed in.');
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json.error ?? 'Request failed') as EdgeFunctionError;
    error.status = response.status;
    throw error;
  }
  return json as TResponse;
}

export interface EnterMatchBody {
  season_id: string;
  match_date: string;
  player_a_id: string;
  player_b_id: string;
  frames_a: number;
  frames_b: number;
}
export interface EnterMatchResponse {
  match_id: string;
}
export function enterMatch(body: EnterMatchBody) {
  return callEdgeFunction<EnterMatchBody, EnterMatchResponse>('enter-match', 'POST', body);
}

export interface CorrectMatchBody {
  match_id: string;
  match_date?: string;
  frames_a?: number;
  frames_b?: number;
}
export interface CorrectMatchResponse {
  corrected_match_id: string;
}
export function correctMatch(body: CorrectMatchBody) {
  return callEdgeFunction<CorrectMatchBody, CorrectMatchResponse>('correct-match', 'PATCH', body);
}

export interface CloseWeekBody {
  season_id: string;
  week_ending: string;
}
export interface CloseWeekResponse {
  closed_matches: number;
  players_reconciled: number;
}
export function closeWeek(body: CloseWeekBody) {
  return callEdgeFunction<CloseWeekBody, CloseWeekResponse>('close-week', 'POST', body);
}

export interface StartSeasonBody {
  previous_season_id?: string;
  new_season_name: string;
  start_date: string;
}
export interface StartSeasonResponse {
  season_id: string;
}
export function startSeason(body: StartSeasonBody) {
  return callEdgeFunction<StartSeasonBody, StartSeasonResponse>('start-season', 'POST', body);
}

export interface ReviewPlayerClaimBody {
  claim_id: string;
  decision: 'approve' | 'reject';
}
export interface ReviewPlayerClaimResponse {
  claim_id: string;
  status: 'approved' | 'rejected';
}
export function reviewPlayerClaim(body: ReviewPlayerClaimBody) {
  return callEdgeFunction<ReviewPlayerClaimBody, ReviewPlayerClaimResponse>('review-player-claim', 'POST', body);
}
