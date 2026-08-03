// web/src/components/AdminLayout.tsx
import { Outlet } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

export function AdminLayout() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <AdminSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
