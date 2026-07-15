import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { NotFoundPage } from '@/pages/NotFound';

export function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <main className="container py-8">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/grades" element={<GradeDistributionPage />} />
          <Route path="/matches" element={<MatchHistoryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
