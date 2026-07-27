// web/src/lib/highlightSlides.ts
import type { MatchRow } from '@/lib/types';
import type { RecentActivityPlayer } from '@/hooks/useRecentActivity';
import type { PlayerOfTheWeek } from '@/hooks/usePlayerOfTheWeek';

export const HIGHLIGHTS_LIMIT = 5;

export type HighlightSlide =
  | { kind: 'potw'; playerId: string; fullName: string; photoUrl: string | null; ratingGain: number }
  | { kind: 'season-live'; seasonName: string }
  | { kind: 'match'; matchId: string; description: string }
  | { kind: 'signup'; playerId: string; description: string }
  | { kind: 'welcome' };

export function buildHighlightSlides(args: {
  playerOfTheWeek: PlayerOfTheWeek | null;
  activeSeasonName: string | null;
  recentMatches: MatchRow[];
  recentPlayers: RecentActivityPlayer[];
}): HighlightSlide[] {
  const slides: HighlightSlide[] = [];

  if (args.playerOfTheWeek) {
    slides.push({
      kind: 'potw',
      playerId: args.playerOfTheWeek.player_id,
      fullName: args.playerOfTheWeek.full_name,
      photoUrl: args.playerOfTheWeek.photo_url,
      ratingGain: args.playerOfTheWeek.ratingGain,
    });
  }

  if (args.activeSeasonName) {
    slides.push({ kind: 'season-live', seasonName: args.activeSeasonName });
  }

  for (const match of args.recentMatches) {
    if (slides.length >= HIGHLIGHTS_LIMIT) break;
    const winnerIsA = match.winner_id === match.player_a_id;
    const winner = winnerIsA ? match.player_a : match.player_b;
    const loser = winnerIsA ? match.player_b : match.player_a;
    const winnerFrames = winnerIsA ? match.frames_a : match.frames_b;
    const loserFrames = winnerIsA ? match.frames_b : match.frames_a;
    slides.push({
      kind: 'match',
      matchId: match.id,
      description: `${winner.full_name} beat ${loser.full_name} ${winnerFrames}-${loserFrames}`,
    });
  }

  for (const player of args.recentPlayers) {
    if (slides.length >= HIGHLIGHTS_LIMIT) break;
    if (player.activity !== 'signup') continue;
    slides.push({ kind: 'signup', playerId: player.id, description: `New player: ${player.full_name} joined` });
  }

  if (slides.length === 0) {
    slides.push({ kind: 'welcome' });
  }

  return slides.slice(0, HIGHLIGHTS_LIMIT);
}
