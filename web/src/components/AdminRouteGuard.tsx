// web/src/components/AdminRouteGuard.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin } from '@/hooks/useIsAdmin';

export function AdminRouteGuard() {
  const { session, isLoading: authLoading } = useAuth();
  const isAdmin = useIsAdmin(session?.user.id);

  if (authLoading || (session && isAdmin.isLoading)) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!session) {
    return <Navigate to="/admin/login" replace />;
  }

  if (isAdmin.isError || isAdmin.data === false) {
    return <p className="text-destructive">This account is not authorized as an admin.</p>;
  }

  return <Outlet />;
}
