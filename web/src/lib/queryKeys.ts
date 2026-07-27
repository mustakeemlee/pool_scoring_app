// web/src/lib/queryKeys.ts
export const queryKeys = {
  leaderboard: (seasonId: string) => ['leaderboard', seasonId] as const,
  gradeDistribution: (seasonId: string) => ['gradeDistribution', seasonId] as const,
  playerProfile: (playerId: string, seasonId: string) => ['playerProfile', playerId, seasonId] as const,
  matchHistory: (seasonId: string) => ['matchHistory', seasonId] as const,
  openMatches: (seasonId: string) => ['openMatches', seasonId] as const,
  allMatches: () => ['allMatches'] as const,
  seasons: () => ['seasons'] as const,
  activeSeason: () => ['activeSeason'] as const,
  players: (seasonId: string) => ['players', seasonId] as const,
  playerRoster: () => ['playerRoster'] as const,
  isAdmin: (userId: string) => ['isAdmin', userId] as const,
  userProfile: (userId: string) => ['userProfile', userId] as const,
  pendingClaims: () => ['pendingClaims'] as const,
};
