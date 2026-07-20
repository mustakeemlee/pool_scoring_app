// web/src/components/AuthRouteGuard.tsx
import { Navigate, Outlet } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';

export function AuthRouteGuard() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
