/**
 * RequireAdmin — wraps any route that requires admin role.
 *
 * Behaviour:
 *  - While auth/admin check is resolving: minimal loading state.
 *  - If not authenticated: redirects to /login?returnUrl=<current-path>.
 *  - If authenticated but not admin: redirects to /org/dashboard with an
 *    error state (access-denied) so the layout can show a toast.
 *  - If admin: renders <Outlet /> (or `children`).
 *
 * Usage in routes:
 *   <Route element={<RequireAdmin />}>
 *     <Route path="/admin/*" element={<AdminModuleRoutes />} />
 *   </Route>
 *
 * Note: AdminShell already enforces this at the component level as a
 * belt-and-suspenders measure. RequireAdmin stops the route from even
 * mounting the shell + lazy chunks for non-admins.
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { useAuth } from '../../hooks/useAuth';

interface RequireAdminProps {
  children?: React.ReactNode;
}

export function RequireAdmin({ children }: RequireAdminProps) {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminAccess();
  const location = useLocation();

  if (authLoading || adminLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '50vh',
        color: 'var(--text-muted)',
        fontSize: '12px',
      }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/org/dashboard" replace state={{ accessDenied: true }} />;
  }

  return children ? <>{children}</> : <Outlet />;
}
