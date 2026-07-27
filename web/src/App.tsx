import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TopNav } from '@/components/TopNav';
import { IdleLogoutDialog } from '@/components/IdleLogoutDialog';
import { AdminRouteGuard } from '@/components/AdminRouteGuard';
import { AuthRouteGuard } from '@/components/AuthRouteGuard';
import { AdminLayout } from '@/components/AdminLayout';
import { LeaderboardPage } from '@/pages/Leaderboard';
import { PlayerProfilePage } from '@/pages/PlayerProfile';
import { GradeDistributionPage } from '@/pages/GradeDistribution';
import { GradeRosterPage } from '@/pages/GradeRoster';
import { MatchHistoryPage } from '@/pages/MatchHistory';
import { ExplorePage } from '@/pages/Explore';
import { NotFoundPage } from '@/pages/NotFound';
import { DashboardPage } from '@/pages/Dashboard';
import { SettingsPage } from '@/pages/Settings';
import { LoginPage } from '@/pages/Login';
import { SignupPage } from '@/pages/Signup';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { EnterMatchPage } from '@/pages/admin/EnterMatch';
import { CorrectMatchPage } from '@/pages/admin/CorrectMatch';
import { CloseWeekPage } from '@/pages/admin/CloseWeek';
import { StartSeasonPage } from '@/pages/admin/StartSeason';
import { ManagePlayersPage } from '@/pages/admin/ManagePlayers';
import { Analytics } from '@vercel/analytics/react';

export function App() {
  return (
    <BrowserRouter>
      <Analytics />
      <TopNav />
      <IdleLogoutDialog />
      <main className="container py-8">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route element={<AuthRouteGuard />}>
            <Route path="/" element={<LeaderboardPage />} />
            <Route path="/players/:playerId" element={<PlayerProfilePage />} />
            <Route path="/grades" element={<GradeDistributionPage />} />
            <Route path="/grades/:grade" element={<GradeRosterPage />} />
            <Route path="/matches" element={<MatchHistoryPage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
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
