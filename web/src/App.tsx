import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { AdminRouteGuard } from '@/components/AdminRouteGuard';
import { AdminLayout } from '@/components/AdminLayout';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { NotFoundPage } from '@/pages/NotFound';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { EnterMatchPage } from '@/pages/admin/EnterMatch';
import { CorrectMatchPage } from '@/pages/admin/CorrectMatch';
import { CloseWeekPage } from '@/pages/admin/CloseWeek';
import { StartSeasonPage } from '@/pages/admin/StartSeason';
import { ManagePlayersPage } from '@/pages/admin/ManagePlayers';

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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<AdminRouteGuard />}>
            <Route element={<AdminLayout />}>
              <Route path="/admin/enter-match" element={<EnterMatchPage />} />
              <Route path="/admin/correct-match" element={<CorrectMatchPage />} />
              <Route path="/admin/close-week" element={<CloseWeekPage />} />
              <Route path="/admin/start-season" element={<StartSeasonPage />} />
              <Route path="/admin/players" element={<ManagePlayersPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
